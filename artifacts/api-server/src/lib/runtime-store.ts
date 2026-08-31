import { randomUUID } from "node:crypto";
import { bindMemory, clearMemory } from "./memory-store";

export type RuntimeStateName =
  | "offline"
  | "waiting"
  | "connected"
  | "busy"
  | "error";

export type RuntimeEventType =
  | "status"
  | "stdout"
  | "stderr"
  | "result"
  | "error"
  | "command"
  | "system";

/** Which notebook platform the connector runs on. */
export type RuntimeTarget = "colab" | "kaggle";

export type RuntimeEvent = {
  id: string;
  type: RuntimeEventType;
  message: string;
  payload: string | null;
  createdAt: string;
};

export type RuntimeCommand = {
  id: string;
  code: string;
  description: string | null;
  createdAt: string;
};

type RuntimeSession = {
  sessionId: string | null;
  token: string | null;
  label: string | null;
  state: RuntimeStateName;
  target: RuntimeTarget;
  connectedAt: string | null;
  lastSeenAt: string | null;
  pythonVersion: string | null;
  commands: RuntimeCommand[];
  events: RuntimeEvent[];
  eventSequence: number;
};

const runtime: RuntimeSession = {
  sessionId: null,
  token: null,
  label: null,
  state: "offline",
  target: "colab",
  connectedAt: null,
  lastSeenAt: null,
  pythonVersion: null,
  commands: [],
  events: [],
  eventSequence: 0,
};

const now = () => new Date().toISOString();

export function getRuntimeStatus() {
  return {
    state: runtime.state,
    sessionId: runtime.sessionId,
    label: runtime.label,
    target: runtime.target,
    connectedAt: runtime.connectedAt,
    lastSeenAt: runtime.lastSeenAt,
    queuedCommands: runtime.commands.length,
    pythonVersion: runtime.pythonVersion,
  };
}

function buildConnectorCode(
  apiOrigin: string,
  sessionId: string,
  token: string,
  target: RuntimeTarget,
): string {
  const baseUrl = `${apiOrigin.replace(/\/$/, "")}/api`;
  const label = target === "kaggle" ? "Kaggle" : "Colab";
  return `# CC+ (${label}) connector
import contextlib, io, json, time, traceback, requests

BASE_URL = ${JSON.stringify(baseUrl)}
SESSION_ID = ${JSON.stringify(sessionId)}
TOKEN = ${JSON.stringify(token)}
POLL_SECONDS = 1.5

def _event(event_type, message, payload=None, command_id=None):
    body = {
        "sessionId": SESSION_ID,
        "token": TOKEN,
        "type": event_type,
        "message": str(message)[:30000],
        "payload": json.dumps(payload) if payload is not None else None,
        "commandId": command_id,
    }
    try:
        requests.post(f"{BASE_URL}/colab/events", json=body, timeout=15)
    except Exception:
        pass

_event("status", "${label} connector is online", {"pythonVersion": __import__("sys").version.split()[0]})
print("Connected to CC+. Keep this cell running.")

while True:
    try:
        response = requests.get(
            f"{BASE_URL}/colab/commands",
            params={"sessionId": SESSION_ID, "token": TOKEN},
            timeout=20,
        )
        commands = response.json().get("commands", []) if response.ok else []
        for command in commands:
            command_id = command["id"]
            stdout_buffer, stderr_buffer = io.StringIO(), io.StringIO()
            _event("status", "Running command", {"commandId": command_id}, command_id)
            try:
                with contextlib.redirect_stdout(stdout_buffer), contextlib.redirect_stderr(stderr_buffer):
                    exec(compile(command["code"], "<cc-command>", "exec"), globals(), globals())
                stdout_text = stdout_buffer.getvalue()
                stderr_text = stderr_buffer.getvalue()
                if stdout_text:
                    _event("stdout", stdout_text, {"commandId": command_id}, command_id)
                if stderr_text:
                    _event("stderr", stderr_text, {"commandId": command_id}, command_id)
                _event("result", "Command completed successfully", {"commandId": command_id}, command_id)
            except Exception as error:
                stdout_text, stderr_text = stdout_buffer.getvalue(), stderr_buffer.getvalue()
                if stdout_text:
                    _event("stdout", stdout_text, {"commandId": command_id}, command_id)
                if stderr_text:
                    _event("stderr", stderr_text, {"commandId": command_id}, command_id)
                _event("error", traceback.format_exc(), {"commandId": command_id}, command_id)
            _event("status", "${label} runtime is ready", {"commandId": command_id}, command_id)
    except Exception as error:
        _event("error", f"Connector polling error: {error}")
    time.sleep(POLL_SECONDS)
`;
}

export function createSession(label: string, appOrigin: string, target: RuntimeTarget = "colab") {
  const sessionId = randomUUID();
  const token = randomUUID().replaceAll("-", "");
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 12).toISOString();

  runtime.sessionId = sessionId;
  runtime.token = token;
  runtime.label = label;
  runtime.state = "waiting";
  runtime.target = target;
  runtime.connectedAt = null;
  runtime.lastSeenAt = null;
  runtime.pythonVersion = null;
  runtime.commands = [];
  runtime.events = [];
  runtime.eventSequence = 0;
  // Bind the memory layer to this new session (resets prior memory).
  bindMemory(sessionId);
  addEvent("system", `Connector session created for ${target}. Run the setup cell in ${target === "kaggle" ? "Kaggle" : "Colab"}.`, null);

  const connectorCode = buildConnectorCode(appOrigin, sessionId, token, target);

  return { sessionId, token, connectorCode, expiresAt };
}

export function isValidSession(sessionId: string, token: string) {
  return runtime.sessionId === sessionId && runtime.token === token;
}

export function connectSession(
  sessionId: string,
  token: string,
  runtimeName?: string,
  pythonVersion?: string,
) {
  if (!isValidSession(sessionId, token)) return null;
  runtime.state = "connected";
  runtime.label = runtimeName || runtime.label;
  runtime.pythonVersion = pythonVersion || runtime.pythonVersion;
  runtime.connectedAt ??= now();
  runtime.lastSeenAt = now();
  // Ensure memory is bound to this session (recall continues across reconnects
  // within the same session id).
  bindMemory(sessionId);
  addEvent("status", `${runtime.target === "kaggle" ? "Kaggle" : "Colab"} runtime connected`, null);
  return getRuntimeStatus();
}

export function disconnectSession(sessionId: string) {
  if (runtime.sessionId !== sessionId) return false;
  runtime.state = "offline";
  runtime.lastSeenAt = now();
  // Clear the ephemeral memory layer on disconnect (by design).
  clearMemory();
  addEvent("system", `${runtime.target === "kaggle" ? "Kaggle" : "Colab"} runtime disconnected`, null);
  return true;
}

export function addEvent(
  type: RuntimeEventType,
  message: string,
  payload: string | null,
) {
  runtime.eventSequence += 1;
  runtime.events.push({
    id: String(runtime.eventSequence),
    type,
    message: message.slice(0, 30000),
    payload,
    createdAt: now(),
  });
  if (runtime.events.length > 250) runtime.events.shift();
  runtime.lastSeenAt = now();
}

export function queueCommand(code: string, description: string | null) {
  const command = {
    id: randomUUID(),
    code,
    description,
    createdAt: now(),
  };
  runtime.commands.push(command);
  runtime.state = "busy";
  addEvent("command", description || "Python command queued", JSON.stringify({ commandId: command.id }));
  return command;
}

export function takeCommands() {
  const commands = runtime.commands.splice(0, runtime.commands.length);
  if (commands.length) runtime.lastSeenAt = now();
  return commands;
}

export function getEvents(cursor?: string) {
  const cursorNumber = cursor ? Number.parseInt(cursor, 10) || 0 : 0;
  const events = runtime.events.filter((event) => Number(event.id) > cursorNumber);
  return {
    events,
    cursor: String(runtime.eventSequence),
  };
}

export function markRuntimeReadyIfConnected(type: RuntimeEventType) {
  if (type === "result" || type === "error" || type === "status") {
    runtime.state = "connected";
  }
}