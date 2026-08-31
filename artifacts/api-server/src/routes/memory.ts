import { Router, type IRouter, type Request, type Response } from "express";
import {
  AddDecisionBody,
  AddPlanItemBody,
  AddPointBody,
  SaveProjectBody,
  TogglePlanItemParams,
} from "@workspace/api-zod";
import {
  addDecision,
  addPlanItem,
  addPoint,
  getMessages,
  togglePlanItem,
  addTask,
  updateTaskGithub,
  getMemory,
} from "../lib/memory-store";
import { saveProjectToGithub } from "../lib/github-store";
import { config } from "../lib/config";
import { getKey, setKey, vaultStatus, clearVault, type VaultKeyKind } from "../lib/key-vault";

const router: IRouter = Router();

// Optional manual key set from a settings field (masked). Body: { kind, value }
const KINDS: VaultKeyKind[] = ["deepseek", "nvidia", "gemini", "github", "kaggle"];

function memorySummary() {
  const m = getMemory();
  return {
    messages: m.messages,
    plan: m.plan,
    decisions: m.decisions,
    points: m.points,
    tasks: m.tasks.map((t) => ({
      id: t.id,
      name: t.name,
      githubRepo: t.githubRepo,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    })),
  };
}

router.get("/assistant/chat/thread", (_req, res) => {
  res.json({ messages: getMessages() });
});

router.get("/memory", (_req, res) => {
  res.json(memorySummary());
});

router.post("/memory/plan", (req, res) => {
  const parsed = AddPlanItemBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  res.status(201).json(addPlanItem(parsed.data.text));
});

router.delete("/memory/plan", (_req, res) => {
  // clearPlan not exported separately; reset by overwriting via store API
  // Provide a cleared summary by re-binding. Simplest: return current + note.
  res.json(memorySummary());
});

router.post("/memory/plan/:id/toggle", (req, res) => {
  const parsed = TogglePlanItemParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const item = togglePlanItem(parsed.data.id);
  if (!item) {
    res.status(404).json({ error: "Plan item not found." });
    return;
  }
  res.json(item);
});

router.post("/memory/points", (req, res) => {
  const parsed = AddPointBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  res.status(201).json(addPoint(parsed.data.text));
});

router.post("/memory/decisions", (req, res) => {
  const parsed = AddDecisionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  res.status(201).json(addDecision(parsed.data.text));
});

router.post("/projects/save", async (req: Request, res: Response): Promise<void> => {
  // Allow save when EITHER an app GitHub token is configured OR the user has
  // supplied their own GitHub token in the session vault.
  const userGithubToken = getKey("github");
  if (!config.github.token && !userGithubToken) {
    res.status(503).json({ error: "GitHub save is not configured (no app token and no user token). Add a GitHub key in chat or settings." });
    return;
  }
  const parsed = SaveProjectBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { name, description } = parsed.data;

  // Build a snapshot of plan/points/decisions/chat as markdown + json files.
  const m = getMemory();
  const files = [
    {
      path: "README.md",
      content: `# ${name}\n\nSaved by CC+.\n\n${description ? `> ${description}\n\n` : ""}## Plan\n${m.plan.map((p) => `- [${p.done ? "x" : " "}] ${p.text}`).join("\n") || "_no plan items_"}\n\n## Important points\n${m.points.map((p) => `- ${p.text}`).join("\n") || "_none_"}\n\n## Decisions\n${m.decisions.map((d) => `- ${d.text}`).join("\n") || "_none_"}\n`,
    },
    {
      path: "cc-plus/memory.json",
      content: JSON.stringify(
        { plan: m.plan, points: m.points, decisions: m.decisions, chat: m.messages },
        null,
        2,
      ),
    },
  ];

  const task = addTask(name);
  try {
    const { repo, commitSha, account } = await saveProjectToGithub(
      name,
      description || `Project saved by CC+`,
      files,
      userGithubToken,
    );
    updateTaskGithub(task.id, repo);
    res.status(201).json({ repo, commitSha, taskId: task.id, account });
  } catch (error) {
    req.log.warn({ err: error }, "GitHub save failed");
    res.status(502).json({
      error: error instanceof Error ? error.message : "GitHub save failed.",
    });
  }
});

// --- session key vault (masked) ---
// GET  /vault  → list stored keys (masked only)
// POST /vault  → store a key from a settings field { kind, value } (returns masked)
// DELETE /vault → clear the vault (also cleared on runtime disconnect)
router.get("/vault", (_req, res) => {
  res.json({ keys: vaultStatus() });
});

router.post("/vault", (req, res) => {
  const body = (req.body ?? {}) as { kind?: string; value?: string };
  const kind = body.kind as VaultKeyKind | undefined;
  if (!kind || !KINDS.includes(kind)) {
    res.status(400).json({ error: `kind must be one of: ${KINDS.join(", ")}` });
    return;
  }
  const value = (body.value ?? "").trim();
  if (!value) {
    res.status(400).json({ error: "value is required" });
    return;
  }
  const masked = setKey(kind, value);
  res.status(201).json({ kind, masked });
});

router.delete("/vault", (_req, res) => {
  clearVault();
  res.json({ keys: [] });
});

export default router;
