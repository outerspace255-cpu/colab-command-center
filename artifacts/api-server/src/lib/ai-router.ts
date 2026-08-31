// AI router for CC+. Routes chat completions across three server-side provider
// pools with per-key rate limits and a fallback chain:
//   primary  → b.ai endpoint, model glm-5.2 (code/bug/problem fix)
//   fast     → Gemini (lightweight / quick)
//   fallback → NVIDIA (model chain: deepseek-v4-flash-0731 → gpt-oss-120b → llama-3.1-70b)
//
// All keys live server-side; the client never sees them. The router picks the
// first non-saturated pool/key, and on a 429/rate error it rotates to the next
// key then the next provider in the chain. Returns a unified { reply, code,
// provider, model } shape. The "provider"/"model" returned to the caller is a
// logical role label, NEVER the real provider/model name (see identity rules).

import { config, type PoolConfig } from "./config";
import { KeyPool } from "./key-pool";
import { buildSystemPrompt } from "./prompt";
import { memoryContextBlock, recentChat, addMessage } from "./memory-store";
import { getKey, type VaultKeyKind } from "./key-vault";

export type ChatTurn = { role: "user" | "assistant"; content: string };

export type AiResult = {
  reply: string;
  code: string | null;
  /** Logical role label only — never the real provider/model. */
  provider: string;
  model: string;
};

export type RoutePreference = "primary" | "fast";

type PoolRuntime = {
  pool: KeyPool;
  cfg: PoolConfig;
  /** True when this runtime was built from a user-supplied key. */
  userKey: boolean;
};

/**
 * Build a PoolRuntime from a single user-supplied key. We clone the provider's
 * static config (model / baseUrl / limits) but swap the pool for one that holds
 * just the user's key. The user key always runs first in the chain.
 */
function userKeyRuntime(kind: VaultKeyKind, base: PoolConfig): PoolRuntime | null {
  const key = getKey(kind);
  if (!key) return null;
  const cfg: PoolConfig = { ...base, keys: [key] };
  return { pool: new KeyPool(cfg), cfg, userKey: true };
}

const geminiPool: PoolRuntime = {
  pool: new KeyPool(config.pools.gemini),
  cfg: config.pools.gemini,
  userKey: false,
};
const deepseekPool: PoolRuntime = {
  pool: new KeyPool(config.pools.deepseek),
  cfg: config.pools.deepseek,
  userKey: false,
};
const nvidiaPool: PoolRuntime = {
  pool: new KeyPool(config.pools.nvidia),
  cfg: config.pools.nvidia,
  userKey: false,
};

/**
 * Build the fallback chain honoring precedence:
 *   1. user-supplied key for the preferred role (if any) runs first
 *   2. server-side pool for the preferred role
 *   3. server-side pool for the other role
 *   4. NVIDIA fallback
 * Providers with zero keys (and no user key) are skipped.
 */
function buildChain(preference: RoutePreference): PoolRuntime[] {
  const chain: PoolRuntime[] = [];
  const addIfUsable = (rt: PoolRuntime | null) => {
    if (rt && rt.pool.size > 0) chain.push(rt);
  };

  if (preference === "fast") {
    addIfUsable(userKeyRuntime("gemini", config.pools.gemini));
    addIfUsable(geminiPool);
    addIfUsable(userKeyRuntime("deepseek", config.pools.deepseek));
    addIfUsable(deepseekPool);
    addIfUsable(userKeyRuntime("nvidia", config.pools.nvidia));
    addIfUsable(nvidiaPool);
  } else {
    addIfUsable(userKeyRuntime("deepseek", config.pools.deepseek));
    addIfUsable(deepseekPool);
    addIfUsable(userKeyRuntime("gemini", config.pools.gemini));
    addIfUsable(geminiPool);
    addIfUsable(userKeyRuntime("nvidia", config.pools.nvidia));
    addIfUsable(nvidiaPool);
  }
  return chain;
}

function extractCode(reply: string): string | null {
  const m = reply.match(/```(?:python|py)?\s*([\s\S]*?)```/i);
  return m?.[1] ? m[1].trim() : null;
}

// --- OpenAI-compatible completion (DeepSeek + NVIDIA) ---
async function openaiChat(
  rt: PoolRuntime,
  system: string,
  turns: ChatTurn[],
  modelOverride?: string,
): Promise<{ reply: string; model: string }> {
  const key = rt.pool.acquire();
  if (!key) throw new Error("No API key available in pool.");
  const models = modelOverride
    ? [modelOverride]
    : [rt.cfg.model, ...(rt.cfg.fallbackModels ?? [])].filter(Boolean);
  let lastErr: unknown;
  for (const model of models) {
    const response = await fetch(rt.cfg.baseUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [
          { role: "system", content: system },
          ...turns.map((t) => ({ role: t.role, content: t.content })),
        ],
      }),
    });
    const data = (await response.json().catch(() => null)) as
      | { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } }
      | null;
    if (!response.ok) {
      lastErr = new Error(data?.error?.message ?? "Provider rejected request.");
      // 429 → try next model/key is handled by outer rotation; here just continue.
      continue;
    }
    const reply =
      data?.choices?.[0]?.message?.content?.trim() || "";
    if (reply) return { reply, model };
    lastErr = new Error("Empty provider response.");
  }
  throw lastErr instanceof Error ? lastErr : new Error("Provider request failed.");
}

// --- Gemini generateContent ---
async function geminiChat(
  rt: PoolRuntime,
  system: string,
  turns: ChatTurn[],
): Promise<{ reply: string; model: string }> {
  const key = rt.pool.acquire();
  if (!key) throw new Error("No API key available in pool.");
  const model = rt.cfg.model;
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model,
  )}:generateContent?key=${encodeURIComponent(key)}`;
  // Gemini has no native system role; fold system into first user turn.
  const contents = turns.map((t, i) => ({
    role: t.role === "assistant" ? "model" : "user",
    parts: [{ text: i === 0 && t.role === "user" ? `${system}\n\n${t.content}` : t.content }],
  }));
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents,
      systemInstruction: { parts: [{ text: system }] },
      generationConfig: { temperature: 0.2 },
    }),
  });
  const data = (await response.json().catch(() => null)) as
    | { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>; error?: { message?: string } }
    | null;
  if (!response.ok) {
    throw new Error(data?.error?.message ?? "Gemini rejected request.");
  }
  const reply =
    data?.candidates?.[0]?.content?.parts
      ?.map((p) => p.text || "")
      .join("")
      .trim() || "";
  if (!reply) throw new Error("Empty Gemini response.");
  return { reply, model };
}

async function callPool(
  rt: PoolRuntime,
  system: string,
  turns: ChatTurn[],
): Promise<{ reply: string; model: string }> {
  if (rt.cfg.provider === "gemini") return geminiChat(rt, system, turns);
  return openaiChat(rt, system, turns);
}

/**
 * Run a chat turn through the fallback chain. Records the user + assistant
 * messages into the memory layer. Returns a logical-role-labeled result.
 */
export async function routeChat(
  userMessage: string,
  preference: RoutePreference = "primary",
): Promise<AiResult> {
  const memoryContext = memoryContextBlock();
  const system = buildSystemPrompt(memoryContext);

  addMessage("user", userMessage, null);

  // Build turns from recent memory so the AI recalls within-session context.
  const turns: ChatTurn[] = recentChat(12).map((m) => ({
    role: m.role === "system" ? "assistant" : (m.role as "user" | "assistant"),
    content: m.content,
  }));

  // Order the chain by preference with user-key precedence, ending with nvidia.
  const chain = buildChain(preference);

  let lastErr: unknown;
  for (const rt of chain) {
    try {
      const { reply } = await callPool(rt, system, turns);
      const code = extractCode(reply);
      addMessage("assistant", reply, code);
      // Logical role label — never reveal the real provider/model.
      const roleLabel =
        rt.cfg.provider === "deepseek"
          ? "primary"
          : rt.cfg.provider === "gemini"
            ? "fast"
            : "fallback";
      return { reply, code, provider: roleLabel, model: "cc-r2" };
    } catch (err) {
      lastErr = err;
      // rotate to next provider in chain
      continue;
    }
  }
  const message =
    lastErr instanceof Error ? lastErr.message : "All AI providers failed.";
  addMessage("assistant", `I could not complete that request: ${message}`, null);
  throw new Error(message);
}
