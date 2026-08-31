import { Router, type IRouter } from "express";
import {
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
import { canEnter, claimSeat, getClientId, getOccupancy } from "../lib/occupancy";
import { routeChat } from "../lib/ai-router";
import { config } from "../lib/config";
import { detectKey, vaultStatus } from "../lib/key-vault";

const router: IRouter = Router();

function invalid(res: Parameters<Parameters<IRouter["post"]>[1]>[1], message: string) {
  res.status(400).json({ error: message });
}

// Single-user occupancy guard: rejects callers that don't own the seat.
function requireSeat(req: Parameters<Parameters<IRouter["post"]>[1]>[0], res: Parameters<Parameters<IRouter["post"]>[1]>[1]): boolean {
  if (!config.occupancyLock) return true;
  const sessionId =
    (typeof req.body === "object" && req.body?.sessionId) || undefined;
  if (canEnter(sessionId)) return true;
  res.status(503).json({ error: "system is currently busy. please try again later." });
  return false;
}

router.get("/runtime/status", (_req, res): void => {
  res.json(getRuntimeStatus());
});

router.get("/occupancy", (req, res): void => {
  const clientId = getClientId(req, res);
  claimSeat(clientId);
  res.set("Cache-Control", "no-store");
  res.json(getOccupancy(clientId));
});

router.post("/runtime/bootstrap", (req, res): void => {
  const parsed = CreateRuntimeBootstrapBody.safeParse(req.body);
  if (!parsed.success) {
    invalid(res, parsed.error.message);
    return;
  }
  const origin = `${req.protocol}://${req.get("host")}`;
  const target = parsed.data.target ?? "colab";
  res.status(201).json(createSession(parsed.data.label, origin, target));
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
  if (!requireSeat(req, res)) return;
  const parsed = ExecuteRuntimeCodeBody.safeParse(req.body);
  if (!parsed.success) {
    invalid(res, parsed.error.message);
    return;
  }
  const status = getRuntimeStatus();
  if (status.sessionId !== parsed.data.sessionId || status.state === "offline") {
    res.status(409).json({ error: "Connect a runtime before running code." });
    return;
  }
  const command = queueCommand(parsed.data.code, parsed.data.description ?? null);
  res.status(202).json({
    accepted: true,
    commandId: command.id,
    message: "Code queued for the runtime.",
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
    res.status(409).json({ error: "No connected runtime." });
    return;
  }
  addEvent("system", "Interrupt requested. Stop the running cell in the runtime if it does not stop automatically.", null);
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

// CC R2 assistant chat — keys are server-side; the client never sends an API
// key on purpose. If a user pastes one into chat, we detect it, store it in
// the masked session vault, and never echo the full key back in the thread.
router.post("/assistant/chat", async (req, res): Promise<void> => {
  if (!requireSeat(req, res)) return;
  const parsed = SendAssistantMessageBody.safeParse(req.body);
  if (!parsed.success) {
    invalid(res, parsed.error.message);
    return;
  }
  const { message, execute, sessionId, preference } = parsed.data;

  // Scan for API keys before anything else. If found, save masked and strip the
  // raw key from the message we forward to the AI / store in chat memory.
  const detected = detectKey(message);
  const safeMessage = detected
    ? message.replace(/(?:sk-[A-Za-z0-9_\-]{16,}|gh[pousr]_[A-Za-z0-9]{16,}|AIza[A-Za-z0-9_\-]{20,}|nvapi-[A-Za-z0-9_\-]{16,}|[A-Za-z0-9]{32,})/g, "[key saved]")
    : message;

  let result;
  try {
    result = await routeChat(safeMessage, preference ?? "ensemble");
  } catch (error) {
    req.log.warn({ err: error }, "CC R2 chat failed");
    res
      .status(502)
      .json({
        error: error instanceof Error ? error.message : "CC R2 could not complete that request.",
        // Still tell the client a key was saved even though the AI call failed.
        keyDetected: detected ? { kind: detected.kind, masked: detected.masked } : null,
        vault: vaultStatus(),
      });
    return;
  }
  // Optionally auto-queue the generated code to the runtime (when not in safe mode).
  let commandId: string | null = null;
  if (execute && result.code && sessionId) {
    const status = getRuntimeStatus();
    if (status.sessionId === sessionId && status.state !== "offline") {
      commandId = queueCommand(result.code, "CC R2-generated command").id;
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
});

export default router;