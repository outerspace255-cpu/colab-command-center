// AI orchestration for CC+. The default ensemble runs the DeepSeek lead and
// Gemini specialist in parallel, then asks the DeepSeek lead to synthesize one
// final answer. If one provider fails, the healthy provider is used explicitly
// as a fallback so a transient provider error does not block the user.
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

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(
    /(?:AIza[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9_-]{16,}|[A-Za-z0-9_-]{32,})/g,
    "[redacted]",
  );
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
  const models = [
    ...new Set([
      rt.cfg.model,
      ...(rt.cfg.fallbackModels ?? []),
      "gemini-3.6-flash",
    ]),
  ].filter(Boolean);
  let lastErr: unknown;
  const contents = turns.map((t) => ({
    role: t.role === "assistant" ? "model" : "user",
    parts: [{ text: t.content }],
  }));
  for (const model of models) {
    const key = rt.pool.acquire();
    if (!key) {
      lastErr = new Error("No API key available in pool.");
      break;
    }
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      model,
    )}:generateContent?key=${encodeURIComponent(key)}`;
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
      lastErr = new Error(data?.error?.message ?? `Gemini rejected request (${response.status}).`);
      continue;
    }
    const reply =
      data?.candidates?.[0]?.content?.parts
        ?.map((p) => p.text || "")
        .join("")
        .trim() || "";
    if (reply) return { reply, model };
    lastErr = new Error("Empty Gemini response.");
  }
  throw lastErr instanceof Error ? lastErr : new Error("Gemini request failed.");
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
      let result;
      try {
        result = await callPool(runtime, system, turns);
      } catch (primaryError) {
        const fallback = runtimeFor("gemini");
        if (!fallback) throw primaryError;
        console.warn("[ai-router] lead failed; using Gemini fallback", {
          error: safeErrorMessage(primaryError),
        });
        result = await callPool(fallback, system, turns);
        const code = extractCode(result.reply);
        addMessage("assistant", result.reply, code);
        return { reply: result.reply, code, provider: "fallback", model: "cc-r2-fallback" };
      }
      const code = extractCode(result.reply);
      addMessage("assistant", result.reply, code);
      return { reply: result.reply, code, provider: "primary", model: "cc-r2" };
    }

    if (preference === "fast") {
      const runtime = runtimeFor("gemini");
      if (!runtime) throw new Error("The specialist agent is not configured.");
      let result;
      try {
        result = await callPool(runtime, system, turns);
      } catch (fastError) {
        const fallback = runtimeFor("deepseek");
        if (!fallback) throw fastError;
        console.warn("[ai-router] Gemini failed; using lead fallback", {
          error: safeErrorMessage(fastError),
        });
        result = await callPool(fallback, system, turns);
        const code = extractCode(result.reply);
        addMessage("assistant", result.reply, code);
        return { reply: result.reply, code, provider: "fallback", model: "cc-r2-fallback" };
      }
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
      console.warn("[ai-router] synchronized provider failure", {
        lead: lead.status === "rejected" ? safeErrorMessage(lead.reason) : "ok",
        specialist:
          specialist.status === "rejected"
            ? safeErrorMessage(specialist.reason)
            : "ok",
      });
      if (lead.status === "fulfilled" || specialist.status === "fulfilled") {
        const fallback =
          lead.status === "fulfilled"
            ? lead.value
            : specialist.status === "fulfilled"
              ? specialist.value
              : null;
        if (fallback) {
          const code = extractCode(fallback.reply);
          addMessage("assistant", fallback.reply, code);
          return {
            reply: fallback.reply,
            code,
            provider: "fallback",
            model: "cc-r2-fallback",
          };
        }
      }
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
    let final;
    try {
      final = await callPool(deepseek, synthesisSystem, [
        { role: "user", content: synthesisPrompt },
      ]);
    } catch (synthesisError) {
      console.warn("[ai-router] synthesis failed; using specialist fallback", {
        error: safeErrorMessage(synthesisError),
      });
      const fallbackReply = specialist.value.reply || lead.value.reply;
      const code = extractCode(fallbackReply);
      addMessage("assistant", fallbackReply, code);
      return { reply: fallbackReply, code, provider: "fallback", model: "cc-r2-fallback" };
    }
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
