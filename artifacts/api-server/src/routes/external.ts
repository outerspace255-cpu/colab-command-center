import { timingSafeEqual } from "node:crypto";
import { Router, type IRouter } from "express";
import { SendAssistantMessageBody } from "@workspace/api-zod";
import {
  getRuntimeStatus,
  queueCommand,
} from "../lib/runtime-store";
import { routeChat } from "../lib/ai-router";
import { config } from "../lib/config";
import { detectKey, vaultStatus } from "../lib/key-vault";

const router: IRouter = Router();

function providedApiKey(req: Parameters<Parameters<IRouter["get"]>[1]>[0]): string {
  const header = req.get("x-cc-api-key");
  if (header) return header.trim();
  const authorization = req.get("authorization") ?? "";
  return authorization.toLowerCase().startsWith("bearer ")
    ? authorization.slice(7).trim()
    : "";
}

function authorized(req: Parameters<Parameters<IRouter["get"]>[1]>[0], res: Parameters<Parameters<IRouter["get"]>[1]>[1]): boolean {
  if (!config.externalApiKey) {
    res.status(503).json({ error: "External API is not configured." });
    return false;
  }
  const supplied = Buffer.from(providedApiKey(req));
  const expected = Buffer.from(config.externalApiKey);
  const matches =
    supplied.length === expected.length &&
    timingSafeEqual(supplied, expected);
  if (!matches) {
    res.status(401).json({ error: "Invalid external API key." });
    return false;
  }
  return true;
}

router.get("/v1/health", (req, res): void => {
  if (!authorized(req, res)) return;
  res.json({ status: "ok", service: "cc-plus-api" });
});

router.get("/v1/runtime/status", (req, res): void => {
  if (!authorized(req, res)) return;
  res.json(getRuntimeStatus());
});

router.post("/v1/assistant/chat", async (req, res): Promise<void> => {
  if (!authorized(req, res)) return;
  const parsed = SendAssistantMessageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { message, execute, sessionId, preference } = parsed.data;
  const detected = detectKey(message);
  const safeMessage = detected
    ? message.replace(
        /(?:sk-[A-Za-z0-9_\-]{16,}|gh[pousr]_[A-Za-z0-9]{16,}|AIza[A-Za-z0-9_\-]{20,}|nvapi-[A-Za-z0-9_\-]{16,}|[A-Za-z0-9]{32,})/g,
        "[key saved]",
      )
    : message;

  try {
    const result = await routeChat(safeMessage, preference ?? "ensemble");
    let commandId: string | null = null;
    if (execute && result.code && sessionId) {
      const status = getRuntimeStatus();
      if (status.sessionId === sessionId && status.state !== "offline") {
        commandId = queueCommand(result.code, "External CC+ API command").id;
      }
    }
    res.json({
      reply: result.reply,
      code: result.code,
      commandId,
      provider: result.provider,
      model: result.model,
      keyDetected: detected ? { kind: detected.kind, masked: detected.masked } : null,
      vault: vaultStatus(),
    });
  } catch (error) {
    req.log.warn({ err: error }, "External CC+ chat failed");
    res.status(502).json({
      error:
        error instanceof Error
          ? error.message
          : "External CC+ API could not complete that request.",
      keyDetected: detected ? { kind: detected.kind, masked: detected.masked } : null,
      vault: vaultStatus(),
    });
  }
});

export default router;