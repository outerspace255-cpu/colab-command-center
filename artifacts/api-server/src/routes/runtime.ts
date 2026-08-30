import { Router, type IRouter } from "express";
import {
  BootstrapInput,
  ConnectColabRuntimeBody,
  CreateRuntimeBootstrapBody,
  DisconnectRuntimeBody,
  ExecuteRuntimeCodeBody,
  GetRuntimeEventsQueryParams,
  InterruptRuntimeBody,
  PostColabEventBody,
  SendAssistantMessageBody,
} from "@workspace/api-zod";
import {
  addEvent,
  connectSession,
  createSession,
  disconnectSession,
  getEvents,
  getRuntimeStatus,
  isValidSession,
  markRuntimeReadyIfConnected,
  queueCommand,
  takeCommands,
} from "../lib/runtime-store";

const router: IRouter = Router();

function invalid(res: Parameters<Parameters<IRouter["post"]>[1]>[1], message: string) {
  res.status(400).json({ error: message });
}

router.get("/runtime/status", (_req, res): void => {
  res.json(getRuntimeStatus());
});

router.post("/runtime/bootstrap", (req, res): void => {
  const parsed = CreateRuntimeBootstrapBody.safeParse(req.body);
  if (!parsed.success) {
    invalid(res, parsed.error.message);
    return;
  }
  const origin = `${req.protocol}://${req.get("host")}`;
  res.status(201).json(createSession(parsed.data.label, origin));
});

router.post("/runtime/disconnect", (req, res): void => {
  const parsed = DisconnectRuntimeBody.safeParse(req.body);
  if (!parsed.success) {
    invalid(res, parsed.error.message);
    return;
  }
  disconnectSession(parsed.data.sessionId);
  res.json(getRuntimeStatus());
});

router.post("/runtime/execute", (req, res): void => {
  const parsed = ExecuteRuntimeCodeBody.safeParse(req.body);
  if (!parsed.success) {
    invalid(res, parsed.error.message);
    return;
  }
  const status = getRuntimeStatus();
  if (status.sessionId !== parsed.data.sessionId || status.state === "offline") {
    res.status(409).json({ error: "Connect a Colab runtime before running code." });
    return;
  }
  const command = queueCommand(parsed.data.code, parsed.data.description ?? null);
  res.status(202).json({
    accepted: true,
    commandId: command.id,
    message: "Code queued for the Colab runtime.",
  });
});

router.post("/runtime/interrupt", (req, res): void => {
  const parsed = InterruptRuntimeBody.safeParse(req.body);
  if (!parsed.success) {
    invalid(res, parsed.error.message);
    return;
  }
  const status = getRuntimeStatus();
  if (status.sessionId !== parsed.data.sessionId || status.state === "offline") {
    res.status(409).json({ error: "No connected Colab runtime." });
    return;
  }
  addEvent("system", "Interrupt requested. Stop the running cell in Colab if it does not stop automatically.", null);
  res.status(202).json({
    accepted: true,
    commandId: "interrupt",
    message: "Interrupt request recorded.",
  });
});

router.get("/runtime/events", (req, res): void => {
  const parsed = GetRuntimeEventsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    invalid(res, parsed.error.message);
    return;
  }
  const status = getRuntimeStatus();
  if (status.sessionId !== parsed.data.sessionId) {
    res.status(404).json({ error: "Runtime session not found." });
    return;
  }
  res.json(getEvents(parsed.data.cursor));
});

router.post("/colab/connect", (req, res): void => {
  const parsed = ConnectColabRuntimeBody.safeParse(req.body);
  if (!parsed.success) {
    invalid(res, parsed.error.message);
    return;
  }
  const status = connectSession(
    parsed.data.sessionId,
    parsed.data.token,
    parsed.data.runtimeName,
    parsed.data.pythonVersion,
  );
  if (!status) {
    res.status(401).json({ error: "Invalid or expired connector session." });
    return;
  }
  res.json(status);
});

router.post("/colab/events", (req, res): void => {
  const parsed = PostColabEventBody.safeParse(req.body);
  if (!parsed.success) {
    invalid(res, parsed.error.message);
    return;
  }
  if (!isValidSession(parsed.data.sessionId, parsed.data.token)) {
    res.status(401).json({ error: "Invalid connector session." });
    return;
  }
  addEvent(parsed.data.type, parsed.data.message, parsed.data.payload ?? null);
  markRuntimeReadyIfConnected(parsed.data.type);
  res.status(202).json({ accepted: true, message: "Runtime event accepted." });
});

router.get("/colab/commands", (req, res): void => {
  const sessionId = typeof req.query.sessionId === "string" ? req.query.sessionId : "";
  const token = typeof req.query.token === "string" ? req.query.token : "";
  if (!isValidSession(sessionId, token)) {
    res.status(401).json({ error: "Invalid connector session." });
    return;
  }
  res.json({ commands: takeCommands() });
});

router.post("/assistant/chat", async (req, res): Promise<void> => {
  const parsed = SendAssistantMessageBody.safeParse(req.body);
  if (!parsed.success) {
    invalid(res, parsed.error.message);
    return;
  }

  const { provider, apiKey, model, message, sessionId, execute } = parsed.data;
  const system =
    "You are a careful Python assistant for Google Colab. Reply with a concise explanation and, when code is useful, include exactly one Python code block. Never include shell commands that delete data or expose secrets. Prefer pandas, matplotlib, and standard Python. The user must explicitly confirm before code execution.";
  let reply = "";
  let code: string | null = null;

  try {
    if (provider === "gemini") {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: `${system}\n\n${message}` }] }],
          generationConfig: { temperature: 0.2 },
        }),
      });
      const data = (await response.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
      if (!response.ok) throw new Error("Gemini request was rejected.");
      reply = data.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("") || "";
    } else if (provider === "anthropic") {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: 1800,
          system,
          messages: [{ role: "user", content: message }],
        }),
      });
      const data = (await response.json()) as { content?: Array<{ text?: string }> };
      if (!response.ok) throw new Error("Anthropic request was rejected.");
      reply = data.content?.map((part) => part.text || "").join("") || "";
    } else {
      const endpoint =
        provider === "openrouter"
          ? "https://openrouter.ai/api/v1/chat/completions"
          : "https://api.openai.com/v1/chat/completions";
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          messages: [
            { role: "system", content: system },
            { role: "user", content: message },
          ],
        }),
      });
      const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
      if (!response.ok) throw new Error("AI provider request was rejected.");
      reply = data.choices?.[0]?.message?.content || "";
    }
  } catch (error) {
    req.log.warn({ err: error, provider, model }, "AI provider request failed");
    res.status(502).json({ error: error instanceof Error ? error.message : "AI provider request failed." });
    return;
  }

  const codeMatch = reply.match(/```(?:python|py)?\s*([\s\S]*?)```/i);
  if (codeMatch?.[1]) code = codeMatch[1].trim();
  let commandId: string | null = null;
  if (execute && code && sessionId) {
    const status = getRuntimeStatus();
    if (status.sessionId === sessionId && status.state !== "offline") {
      commandId = queueCommand(code, "AI-generated command").id;
    }
  }
  res.json({ reply, code, commandId, provider, model });
});

export default router;