# Colab Command Center (CC+) — agent notes

## Workspace layout
- pnpm monorepo: `artifacts/api-server` (Express 5), `artifacts/colab-command-center` (React+Vite), `artifacts/mockup-sandbox`, `lib/api-client-react`, `lib/api-zod`, `lib/api-spec`, `scripts`.
- API contract lives in `lib/api-spec/openapi.yaml`. Run `pnpm --filter @workspace/api-spec run codegen` to regenerate both `lib/api-zod` and `lib/api-client-react` (orval + tsc). **Edit the spec, not the generated files.**

## Build / typecheck
- Full build needs env vars: `PORT=10000 BASE_PATH=/ pnpm run build` (mockup-sandbox's vite.config requires both or it hard-errors at config load).
- `pnpm run typecheck` and `pnpm run build` are the green-bar gates.
- `pnpm-workspace.yaml` has `dangerouslyAllowAllBuilds: true` so esbuild/@swc/msw build scripts don't hard-error on approval.

## Backend conventions (api-server)
- Single global runtime session (runtime-store.ts) — not multi-tenant. Occupancy lock (occupancy.ts) enforces single-user; seat owner = connected sessionId.
- Memory layer (memory-store.ts) is session-bound and **cleared on disconnect** by design.
- API keys are server-side only (config.ts pools). Clients never send keys; AssistantInput has `preference` (primary|fast), not provider/model/apiKey.
- persona/prompt.ts: assistant is "CC R2", never reveals provider/model identity, communicates in Bengali by default.
- env.ts walks upward from cwd to find `.env` (works whether launched from repo root or api-server dir).

## Frontend conventions (colab-command-center)
- App.tsx is one large file with many inline components. `noUnusedLocals` is false in tsconfig.base.json, but keep imports tight.
- React Query hooks come from `@workspace/api-client-react` (generated). GETs → `useGet...`, POSTs → `use...` mutations.
- Setup page supports `target: colab|kaggle`; runtime-store generates per-target connector Python.

## Git
- `.env` is gitignored; `.env.example` is committed. Never commit real keys.
