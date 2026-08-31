// Session-only key vault for CC+. Lets the single user supply their own keys
// (DeepSeek / NVIDIA / Gemini / GitHub / Kaggle) inside chat or settings. Keys
// are NEVER echoed in full anywhere — chat, logs, and memory store only a
// masked preview. The vault lives while the runtime session is connected and
// is cleared on disconnect (same lifetime as the memory layer).
//
// Precedence for AI chat: a user-supplied provider key takes priority over the
// server-side shared pool. For GitHub save, a user-supplied token writes to
// the user's own account; otherwise the app's GITHUB_TOKEN is used.

export type VaultKeyKind =
  | "deepseek"
  | "nvidia"
  | "gemini"
  | "github"
  | "kaggle";

type VaultEntry = {
  kind: VaultKeyKind;
  /** Full key — kept only in process memory, never serialized to chat. */
  value: string;
  /** Masked preview, e.g. "sk-…7f3a". Safe to show in UI/logs. */
  masked: string;
  addedAt: string;
};

const vault = new Map<VaultKeyKind, VaultEntry>();

const uid = () =>
  globalThis.crypto?.randomUUID?.() ??
  `${Date.now()}-${Math.random().toString(36).slice(2)}`;

/** Mask a secret, keeping the first 4 and last 4 chars when possible. */
export function maskKey(value: string): string {
  const v = value.trim();
  if (v.length <= 8) return `${v.slice(0, 2)}…${v.slice(-2)}`;
  return `${v.slice(0, 4)}…${v.slice(-4)}`;
}

// Patterns we recognize in user chat. We accept a few common shapes so the user
// can paste "deepseek key: sk-..." or just the raw key with a hint nearby.
const KIND_HINTS: Array<{ kind: VaultKeyKind; re: RegExp }> = [
  // explicit labels (case-insensitive) anywhere in the line
  { kind: "deepseek", re: /deepseek/i },
  { kind: "nvidia", re: /nvidia/i },
  { kind: "gemini", re: /\bgemini\b|google[_\s-]?ai|generativelanguage/i },
  { kind: "github", re: /\bgithub\b|\bghp_|\bgho_|\bghu_/i },
  { kind: "kaggle", re: /\bkaggle\b/i },
];

// Raw key shapes — long hex/alphanumeric tokens, sk- prefixes, ghp_ prefixes,
// AIza (Google API key) prefixes. Must be long enough to avoid matching prose.
const KEY_RE =
  /(?:sk-[A-Za-z0-9_\-]{16,}|gh[pousr]_[A-Za-z0-9]{16,}|AIza[A-Za-z0-9_\-]{20,}|nvapi-[A-Za-z0-9_\-]{16,}|[A-Za-z0-9]{32,})/;

export type DetectedKey = {
  kind: VaultKeyKind;
  masked: string;
};

/**
 * Scan a chat message for API keys + an explicit provider hint. Returns the
 * first detected key. When a key token is found but no hint matches, we leave
 * it to the caller to decide (returns null) so we never mislabel a secret.
 */
export function detectKey(message: string): DetectedKey | null {
  const keyMatch = message.match(KEY_RE);
  if (!keyMatch) return null;
  const value = keyMatch[0];

  // Find the nearest hint within ~40 chars of the key, or anywhere in message.
  const idx = message.indexOf(value);
  const window = message.slice(Math.max(0, idx - 60), idx + value.length + 20);
  let kind: VaultKeyKind | null = null;
  for (const h of KIND_HINTS) {
    if (h.re.test(window) || h.re.test(message)) {
      kind = h.kind;
      break;
    }
  }
  if (!kind) {
    // Best-effort shape heuristics when no explicit label was given.
    if (/^sk-/.test(value)) kind = "deepseek";
    else if (/^gh[pousr]_/.test(value)) kind = "github";
    else if (/^AIza/.test(value)) kind = "gemini";
    else if (/^nvapi-/.test(value)) kind = "nvidia";
  }
  if (!kind) return null;

  vault.set(kind, {
    kind,
    value,
    masked: maskKey(value),
    addedAt: new Date().toISOString(),
  });
  return { kind, masked: maskKey(value) };
}

/** Store a key directly (e.g. from a settings field), masked. */
export function setKey(kind: VaultKeyKind, value: string): string {
  const masked = maskKey(value);
  vault.set(kind, { kind, value, masked, addedAt: new Date().toISOString() });
  return masked;
}

export function getKey(kind: VaultKeyKind): string | undefined {
  return vault.get(kind)?.value;
}

export function hasKey(kind: VaultKeyKind): boolean {
  return vault.has(kind);
}

/** Masked status of all stored keys — safe to return to the client. */
export function vaultStatus(): Array<{
  kind: VaultKeyKind;
  masked: string;
  addedAt: string;
}> {
  return [...vault.values()].map(({ kind, masked, addedAt }) => ({
    kind,
    masked,
    addedAt,
  }));
}

export function clearVault(): void {
  vault.clear();
}

/** Unique id helper reused by memory layer. */
export { uid };
