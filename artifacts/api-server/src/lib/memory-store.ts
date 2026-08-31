// In-memory memory layer for CC+. Lives while a Colab/Kaggle runtime is
// connected AND the app process is running. Cleared on runtime disconnect.
//
// Stores: chat messages, plan, decisions, status snapshots, important points,
// and project task metadata. Everything is keyed to the active session so the
// AI can recall prior context ("what did we decide yesterday") within a
// session, but it is gone after disconnect (by design — ephemeral privacy).

export type ChatRole = "user" | "assistant" | "system";

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  /** Extracted code block, if any, from an assistant turn. */
  code: string | null;
  createdAt: string;
};

export type PlanItem = {
  id: string;
  text: string;
  done: boolean;
  createdAt: string;
};

export type Decision = {
  id: string;
  text: string;
  createdAt: string;
};

export type ImportantPoint = {
  id: string;
  text: string;
  createdAt: string;
};

export type StatusSnapshot = {
  id: string;
  text: string;
  createdAt: string;
};

export type ProjectTask = {
  id: string;
  name: string;
  githubRepo: string | null; // "owner/name" once pushed
  createdAt: string;
  updatedAt: string;
  /** Snapshot of plan/points/chat stored for reload next session. */
  snapshot: {
    plan: PlanItem[];
    points: ImportantPoint[];
    decisions: Decision[];
    chat: ChatMessage[];
  };
};

export type MemoryStore = {
  messages: ChatMessage[];
  plan: PlanItem[];
  decisions: Decision[];
  points: ImportantPoint[];
  statuses: StatusSnapshot[];
  tasks: ProjectTask[];
};

const empty = (): MemoryStore => ({
  messages: [],
  plan: [],
  decisions: [],
  points: [],
  statuses: [],
  tasks: [],
});

let memory: MemoryStore = empty();
let currentSessionId: string | null = null;

const now = () => new Date().toISOString();
const uid = () =>
  (globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(36).slice(2)}`);

export function getMemory(): MemoryStore {
  return memory;
}

export function bindMemory(sessionId: string | null): void {
  // When a new session is created (or runtime disconnects) we reset memory.
  if (sessionId !== currentSessionId) {
    currentSessionId = sessionId;
    memory = empty();
  }
}

export function clearMemory(): void {
  currentSessionId = null;
  memory = empty();
}

// --- chat ---
export function addMessage(role: ChatRole, content: string, code: string | null) {
  const msg: ChatMessage = {
    id: uid(),
    role,
    content,
    code,
    createdAt: now(),
  };
  memory.messages.push(msg);
  // Cap the in-memory thread to keep responses cheap.
  if (memory.messages.length > 200) memory.messages.shift();
  return msg;
}

export function getMessages(): ChatMessage[] {
  return memory.messages;
}

// --- plan ---
export function addPlanItem(text: string) {
  const item: PlanItem = { id: uid(), text, done: false, createdAt: now() };
  memory.plan.push(item);
  return item;
}
export function togglePlanItem(id: string) {
  const item = memory.plan.find((p) => p.id === id);
  if (item) item.done = !item.done;
  return item;
}
export function getPlan() {
  return memory.plan;
}

// --- decisions ---
export function addDecision(text: string) {
  const d: Decision = { id: uid(), text, createdAt: now() };
  memory.decisions.push(d);
  return d;
}
export function getDecisions() {
  return memory.decisions;
}

// --- important points ---
export function addPoint(text: string) {
  const p: ImportantPoint = { id: uid(), text, createdAt: now() };
  memory.points.push(p);
  return p;
}
export function getPoints() {
  return memory.points;
}

// --- status ---
export function addStatus(text: string) {
  const s: StatusSnapshot = { id: uid(), text, createdAt: now() };
  memory.statuses.push(s);
  if (memory.statuses.length > 100) memory.statuses.shift();
  return s;
}
export function getStatuses() {
  return memory.statuses;
}

// --- project tasks (github save) ---
export function addTask(name: string) {
  const t: ProjectTask = {
    id: uid(),
    name,
    githubRepo: null,
    createdAt: now(),
    updatedAt: now(),
    snapshot: {
      plan: memory.plan.map((p) => ({ ...p })),
      points: memory.points.map((p) => ({ ...p })),
      decisions: memory.decisions.map((d) => ({ ...d })),
      chat: memory.messages.map((m) => ({ ...m })),
    },
  };
  memory.tasks.push(t);
  return t;
}
export function updateTaskGithub(id: string, repo: string) {
  const t = memory.tasks.find((x) => x.id === id);
  if (t) {
    t.githubRepo = repo;
    t.updatedAt = now();
  }
  return t;
}
export function getTasks() {
  return memory.tasks;
}

/** A compact textual context bundle injected into the AI system prompt. */
export function memoryContextBlock(): string {
  const parts: string[] = [];
  if (memory.plan.length) {
    parts.push(
      "Current plan:\n" +
        memory.plan.map((p) => `- [${p.done ? "x" : " "}] ${p.text}`).join("\n"),
    );
  }
  if (memory.decisions.length) {
    parts.push(
      "Decisions made:\n" +
        memory.decisions.map((d) => `- ${d.text}`).join("\n"),
    );
  }
  if (memory.points.length) {
    parts.push(
      "Important points:\n" + memory.points.map((p) => `- ${p.text}`).join("\n"),
    );
  }
  if (memory.statuses.length) {
    const recent = memory.statuses.slice(-5);
    parts.push(
      "Recent status:\n" + recent.map((s) => `- ${s.text}`).join("\n"),
    );
  }
  const tasks = memory.tasks.filter((t) => t.githubRepo);
  if (tasks.length) {
    parts.push(
      "Saved projects on GitHub:\n" +
        tasks.map((t) => `- ${t.name} → ${t.githubRepo}`).join("\n"),
    );
  }
  return parts.length
    ? `\n\n--- Session memory (recall this when relevant) ---\n${parts.join("\n\n")}`
    : "";
}

/** Recent chat history for the AI context window. */
export function recentChat(maxTurns = 12): ChatMessage[] {
  return memory.messages.slice(-maxTurns * 2);
}
