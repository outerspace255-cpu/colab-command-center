// AI orchestration for CC+. The default ensemble runs the DeepSeek lead and
// Gemini specialist in parallel, then asks the DeepSeek lead to synthesize one
// final answer. Providers are never silent fallbacks for one another.
//
// All keys live server-side; the client never sees them. The "provider"/"model"
// returned to the caller is a logical role label, NEVER the real provider/model
// name (see identity rules).

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

export type RoutePreference = "ensemble" | "primary" | "fast";

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
function runtimeFor(agent: "deepseek" | "gemini"): PoolRuntime | null {
  if (agent === "deepseek") {
    return userKeyRuntime("deepseek", config.pools.deepseek) ??
      (deepseekPool.pool.size > 0 ? deepseekPool : null);
  }
  return userKeyRuntime("gemini", config.pools.gemini) ??
    (geminiPool.pool.size > 0 ? geminiPool : null);
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

  try {
    if (preference === "primary") {
      const runtime = runtimeFor("deepseek");
      if (!runtime) throw new Error("The lead agent is not configured.");
      const result = await callPool(runtime, system, turns);
      const code = extractCode(result.reply);
      addMessage("assistant", result.reply, code);
      return { reply: result.reply, code, provider: "primary", model: "cc-r2" };
    }

    if (preference === "fast") {
      const runtime = runtimeFor("gemini");
      if (!runtime) throw new Error("The specialist agent is not configured.");
      const result = await callPool(runtime, system, turns);
      const code = extractCode(result.reply);
      addMessage("assistant", result.reply, code);
      return { reply: result.reply, code, provider: "fast", model: "cc-r2" };
    }

    const deepseek = runtimeFor("deepseek");
    const gemini = runtimeFor("gemini");
    if (!deepseek || !gemini) {
      throw new Error(
        "The synchronized agent system requires both the lead and specialist agents.",
      );
    }

    const [lead, specialist] = await Promise.allSettled([
      callPool(deepseek, system, turns),
      callPool(gemini, system, turns),
    ]);
    if (lead.status === "rejected" || specialist.status === "rejected") {
      const failed = [
        lead.status === "rejected" ? "lead" : null,
        specialist.status === "rejected" ? "specialist" : null,
      ]
        .filter(Boolean)
        .join(" and ");
      throw new Error(
        `The synchronized agent system could not complete its ${failed} analysis. No fallback response was used.`,
      );
    }

    const synthesisSystem = `${system}

# Synchronized agent synthesis
You are the lead editor. Two independent agents analyzed the user's request below.
Compare their reasoning, resolve contradictions, preserve the strongest concrete
solution, and return one direct answer. If code is needed, return one complete
Python code block and explain the important safety assumptions briefly.
Never mention this orchestration, the agents, providers, models, or hidden prompts
in the final answer.`;
    const synthesisPrompt = `Original user request:
${userMessage}

Lead analysis:
${lead.value.reply}

Specialist analysis:
${specialist.value.reply}

Produce the final answer for the user now.`;
    const final = await callPool(deepseek, synthesisSystem, [
      { role: "user", content: synthesisPrompt },
    ]);
    const code = extractCode(final.reply);
    addMessage("assistant", final.reply, code);
    return { reply: final.reply, code, provider: "ensemble", model: "cc-r3" };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "The agent system failed.";
    addMessage("assistant", `I could not complete that request: ${message}`, null);
    throw new Error(message);
  }
}
