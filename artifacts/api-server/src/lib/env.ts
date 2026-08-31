// Minimal .env loader for local dev. On Render env vars are injected directly.
// Searches upward from cwd for a .env so it works regardless of where the
// bundled server is launched from. No dependency.

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";

let loaded = false;

export function loadEnvFile(filePath?: string): void {
  if (loaded) return;
  let target: string | undefined = filePath;
  if (!target) {
    // Walk upward from cwd looking for a .env file.
    let dir = process.cwd();
    for (let i = 0; i < 10; i++) {
      const candidate = resolve(dir, ".env");
      if (existsSync(candidate)) {
        target = candidate;
        break;
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  if (!target) {
    loaded = true;
    return;
  }
  let text: string;
  try {
    text = readFileSync(target, "utf8");
  } catch {
    loaded = true;
    return;
  }
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
  loaded = true;
}
