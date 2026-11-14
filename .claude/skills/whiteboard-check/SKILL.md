---
name: whiteboard-check
description: Whiteboard's quality gate and coding rules. Use before every commit or push, after finishing any feature step, or when asked to "check", "verify" or "run the tests". Runs the same checks as CI (format, lint, typecheck, unit tests) plus the Playwright E2E for UI changes, and lists the project rules (no dead code, reuse existing helpers, safe file editing on Windows).
---

# Whiteboard check

## 1. Rules while writing code

- **Build only what this step uses.** No tables, columns, exports, props or helpers "for later". If a later step needs it, that step adds it (migrations are cheap). Note what was left out in `PROGRESS.md`.
- **Reuse before writing.** Look first in:
  - server: `apps/server/src/projects/access.ts` (`canViewProject`, `canManageProject`, `isAdmin`), `plugins/auth.ts` (`authenticate`, `requireRole`, `sendError`), `routes/files.ts` (`canAccessFile`, every file read goes through it)
  - web: `apps/web/src/lib/api.ts` (`api`, `ApiError`), `components/AuthShell.tsx` (`FormError`), `pages/projects/format.ts` (dates, sizes, labels), `pages/projects/ProjectForm.tsx`
  - ui: `packages/ui` (`Button`, `Card`, `Field`, `Input`, `Modal`, `Select`, `FileUploader`, `cn`)
  - contracts: `packages/core` (Zod schemas shared by server and web)
- **Do not reshape unrelated code.** Touch other files only when sharing code removes a real duplicate, and keep their behaviour identical.
- **Server is the authority.** Non-members get 404 (no probing for ids), non-managers 403, anonymous 401. Take the project from the stored row, never from the request.
- **Batch queries** for lists (no query per row).

## 2. Editing files on Windows

Never rewrite files with PowerShell 5.1 `Get-Content` / `Set-Content`: it reads UTF-8 as ANSI (garbles `—`, `·`, `→`) and writes a BOM and CRLF. Use the Edit/Write tools, then Prettier.

`pnpm` is not on PATH here: prefix every command with `npx --yes pnpm@12.18.0`.

## 3. The check loop (run from the repo root, in this order)

```
npx --yes pnpm@12.18.0 format
npx --yes pnpm@12.18.0 format:check
npx --yes pnpm@12.18.0 lint
npx --yes pnpm@12.18.0 typecheck
npx --yes pnpm@12.18.0 test
npx --yes pnpm@12.18.0 --filter @whiteboard/web e2e    # when any UI or API flow changed
```

CI (`.github/workflows/ci.yml`) runs `format:check`, `lint`, `typecheck` and `test` on Linux with Node 22, so all four must pass locally before a push. Report real counts from the output; never estimate them.

Database changes: edit `packages/db/src/schema.ts`, then `cd packages/db && npx --yes pnpm@12.18.0 exec drizzle-kit generate --name <step-name>`, and read the generated SQL.

## 4. Review skills (use the one that fits)

- `/security-review`: any change to auth, permissions, file access or routes.
- `/simplify`: after a feature, to catch duplication and dead code.
- `/code-review`: before opening a PR, for correctness bugs.

## 5. After a step is done

1. Tick the step in `PROGRESS.md`, add a Changelog row (date, what, test counts), and update "Resume here".
2. Commit on the feature branch (never `main` or `develop`) only when the user asks; push only when asked. The user merges PRs.
