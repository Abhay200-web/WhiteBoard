# Whiteboard — Progress Log

> **Update this file every time a feature is completed.** Tick the box, add the date and PR/commit, and add a line to the Changelog.
> Plan details: [`docs/PHASE_A_PLAN.md`](docs/PHASE_A_PLAN.md) · Spec: [`docs/PRODUCT_SPEC.md`](docs/PRODUCT_SPEC.md) · Schedule: [`docs/EXECUTION_PLAN.md`](docs/EXECUTION_PLAN.md)

**Current phase:** Phase A (MVP) — Part 2 complete except task reassignment (Part 4) — Part 3 next
**Last updated:** 2026-11-12 (Parts 1-2 merged; Part 3 not started)

Legend: `[ ]` todo · `[~]` in progress · `[x]` done

---

## Resume here

**State (2026-11-12):** Phase A Parts 1 and 2 are done and **merged into `develop`** (PR #6; the old branch `feat/phase-a-auth-members` is obsolete and can be deleted). Work for **Part 3** (files pipeline, backups, projects) goes on branch `feat/phase-a-projects-files`, created from `develop`; **Part 3.1 (files pipeline) is merged; 3.3 (backups + restore) is done on branch `feat/phase-a-backups`** (not yet pushed/merged); next is 3.4 Host settings, then 3.2, 3.5-3.7.

**Suggested Part 3 order:** 3.1 files pipeline → 3.3 backups/restore → 3.4 Host settings → 3.2 uploader/previews → 3.5 projects API → 3.6 project files → 3.7 projects UI.

**Before every push (CI runs exactly these, on Linux, Node 22):**
`pnpm format` then `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test`. For UI flows also `pnpm --filter @whiteboard/web e2e`.

**Local environment notes:**

- `pnpm` is not on PATH here; use `npx --yes pnpm@12.18.0 <cmd>` (the pinned version).
- Playwright Chromium is installed. E2E uses a fresh temp data dir each run.
- Server dev: `pnpm --filter @whiteboard/server dev` (port 47800). Web dev: `pnpm --filter @whiteboard/web dev` (port 5173, proxies the Host).
- Writing large files from the Bash tool with heredocs can fail on quoting; use the editor/Write tool.

**Decisions and deviations from the plan:**

- Auth is custom (scrypt password hashes, SHA-256-hashed opaque bearer tokens, 30-day sliding sessions), not Better Auth, so our own `users`/`memberships` tables stay the source of truth.
- IDs are `crypto.randomUUID()` (the spec comment says ULID).
- Removed members are soft-deleted (`memberships.removed_at`); their email stays reserved.
- Admins manage members/guests only; only the owner manages admins; nobody acts on their own account via `/members`.
- Invite codes: 12 symbols, hashed, one-time, 7-day expiry; guests need an end date.
- mDNS announce (`_whiteboard._tcp`) is on the server; the "found on this network" list needs the Tauri desktop bridge (`window.whiteboardDesktop.discoverHosts`), not built yet.
- Dev proxy serves the app (not the Host) for page loads (`Accept: text/html`) on paths shared with the API (`/setup`, `/members`, ...). Add any new API path prefix to `apps/web/vite.config.ts`.
- The permission matrix test (`apps/server/src/plugins/auth.test.ts`) must be extended for every new route.

**Open items carried forward:**

- 2.5 task-reassignment step in the remove-member dialog → wire up in Part 4.
- Week 0 still open: sidecar spike and Tauri shell (needed before real desktop use and for Host discovery).
- Re-invite path for a removed member's email (decide with the owner).

---

## Week 0 — Setup

- [x] Monorepo scaffold (pnpm + Turborepo, lint, format, typecheck, Vitest, CI, CODEOWNERS)
- [x] Server hello-world (Fastify + SQLite + Drizzle + `GET /host/info`)
- [ ] Sidecar spike (Node + native modules in Tauri installer)
- [ ] Tauri shell (first-run screen, start/stop sidecar, tray)
- [x] Web app shell (Vite + React 19, react-router, Tailwind 4, light/dark tokens, base components in `packages/ui`, MSW + Vitest, Playwright config + smoke test, route guards, API client) — 2026-11-12
- [ ] `/setup` contract + wizard started

## Phase A — Manager ⇄ Artist workflow

### Part 1 — Foundation: Host, auth, permissions

- [x] 1.1 Contracts (`/setup`, sign-in, roles) in `packages/core` — 2026-11-12
- [x] 1.2 DB: credentials + sessions tables, migration `0001_auth` — 2026-11-12
- [x] 1.3 `POST /setup` (once-only, transactional) + setup wizard screen — 2026-11-12
- [x] 1.4 Auth API: sign-in/out, `/auth/me`, change password, forced change (own scrypt + hashed bearer tokens, not Better Auth) — 2026-11-12
- [x] 1.5 Login screen + forced password-change screen — 2026-11-12
- [x] 1.6 Permission middleware (`authenticate`, `requireRole`) + role-matrix test — 2026-11-12
- [x] 1.7 Rate limiting (`@fastify/rate-limit` on setup/sign-in/change-password) — 2026-11-12
- [x] 1.8 Settings shell (Account, Connection, admin-only Host sections) + app layout — 2026-11-12

### Part 2 — Members, invites, connection

- [x] 2.1 mDNS announce (`_whiteboard._tcp`) + Connect-to-Host screen (manual address verified against the Host; discovered list appears via the desktop bridge once the Tauri shell exists) + CORS — 2026-11-12
- [x] 2.2 Invite codes API (hashed, one-time, 7-day expiry, role rules) + Join screen — 2026-11-12
- [x] 2.3 Members list API + Members page (invite dialog, pending invites, revoke) — 2026-11-12
- [x] 2.4 Admin password reset (temporary password shown once, forced change, sessions revoked) — 2026-11-12
- [~] 2.5 Offboarding: remove dialog + soft delete + instant session revoke done — **task-reassignment step lands with tasks in Part 4**
- [x] 2.6 Scheduler + `jobs` table (catch-up after downtime) + daily guest-expiry job — 2026-11-12
- [x] 2.7 Settings → Account: display name, change password — 2026-11-12

### Part 3 — Projects, files, backups

- [x] 3.1 Files pipeline (streamed upload, sha256, content check, thumbnails, Range)
- [x] 3.2 Shared file uploader + previews (image, PDF, video)
- [x] 3.3 Backups (daily, Backup now, pre-migration, pruning, stale warning) + restore
- [x] 3.4 Host settings page
- [x] 3.5 Projects API + status flow + project members
- [x] 3.6 Project files
- [ ] 3.7 Projects list, create-project flow (TipTap brief), overview page

### Part 4 — Tasks, kanban, comments, notifications

- [ ] 4.1 Tasks API (statuses, assignees, subtasks, files, priority, due)
- [ ] 4.2 Task list view + detail drawer
- [ ] 4.3 Kanban with drag-to-status
- [ ] 4.4 My tasks + review-queue queries and pages
- [ ] 4.5 Task history + comments + @mentions
- [ ] 4.6 Notifications (rows + `/events` WebSocket) + bell + inbox
- [ ] 4.7 Live task updates over `/events`

### Part 5 — Review flow, pins, desktop, release

- [ ] 5.1 Deliverables + versions + submit-for-review
- [ ] 5.2 Reviews (approve / changes) + review screen + queue page
- [ ] 5.3 Version compare (endpoint + side-by-side UI)
- [ ] 5.4 Pins + pin comments + resolve
- [ ] 5.5 Deadline watcher job (with catch-up)
- [ ] 5.6 Windows desktop notifications, version check, reconnect banner
- [ ] 5.7 Auto-start, minimize-to-tray
- [ ] 5.8 Release workflow (`.msi` on tag)
- [ ] 5.9 Hocuspocus-in-server spike (2 days)
- [ ] 5.10 **§13 end-to-end scenario green** (Playwright in CI + 3 office PCs) → tag `v0.1.0`

---

## Changelog

| Date       | Feature                                                                                                                     | Ref | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------- | --------------------------------------------------------------------------------------------------------------------------- | --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-11-13 | Part 3.2: shared `<FileUploader>` (packages/ui) + previews (image, video, PDF via pdf.js, download fallback)                | —   | 54 web tests green (+13). Uploader: pick/drop, per-file progress, Cancel, Retry, Dismiss, client size limit; app passes the upload function (XHR for progress). Previews fetch with the bearer token and show from a blob URL because media tags cannot send headers; large videos therefore load fully before playing (signed URLs or a cookie are a later improvement)                                                                                                                                                                                   |
| 2026-11-13 | (3.6 API covered in the row above)                                                                                          | —   | Attach only files you can already read; detaching keeps the file on the Host                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 2026-11-13 | Part 3.5 + 3.6: projects API (create/list/get/patch, status flow, members, /people) and project files (attach/list/detach)  | —   | 82 server tests green (+11). Tables `projects`, `project_members`, `task_statuses` (6 defaults seeded), `project_files`. Staff create projects and become manager; admins see all; others only their projects (404 otherwise). Freelancers can only be artists. `canAccessFile` now also allows members of a project the file is attached to. UI for files comes with the uploader (3.2) and projects UI (3.7)                                                                                                                                             |
| 2026-11-13 | Part 3.4: Host settings page (Backups card with Backup now + stale warning, Storage form, Restore help)                     | —   | 71 server (+3) + 41 web (+7) tests green. `GET/PATCH /host/settings` owner-only (backup folder must be absolute + writable; upload limit 1 MB-100 GB). Restore stays a CLI step (Host must be stopped), the page shows the command. Admins see a note that only the owner manages backups                                                                                                                                                                                                                                                                  |
| 2026-11-13 | Part 3.3: backups (daily job, Backup now, pre-migration, pruning, stale status) + restore CLI                               | —   | 68 server tests green (+14). `GET/POST /backups` owner-only. Backup = SQLite online backup + copy of `files/` + manifest, built in `.partial` then renamed. Retention: newest per day for 7 days + newest per week for 4 weeks, pre-migration kept 30 days, newest never deleted. Stale after 36 h. Restore: `pnpm --filter @whiteboard/server restore <folder> [--data-dir d] [--replace]` (Host stopped); verified by restoring into a second Host in a test. Backup folder from host setting `backupDir` (default `<dataDir>/backups`); 3.4 adds the UI |
| 2026-11-13 | Part 3.1: files pipeline (`POST /files`, `GET /files/:id`, `/content` with Range, `/thumbnail`)                             | —   | 54 server tests green (+14). Streamed to disk + sha256, content sniffed with `file-type` (allowlist; exe renamed .jpg refused), `sharp` 320px webp thumbnails, max size from host setting `maxUploadBytes` (default 2 GiB). Access is uploader + admins only until 3.6 adds project membership in `canAccessFile`                                                                                                                                                                                                                                          |
| 2026-11-12 | Part 2: invites, members, password reset, offboarding, scheduler + guest expiry, mDNS, Connect + Join screens, account name | —   | 40 server + 34 web + 4 E2E tests green (invite -> join from a 2nd browser -> reuse refused -> removal kills session). Removed members' emails stay reserved (no re-invite with same email yet)                                                                                                                                                                                                                                                                                                                                                             |
| 2026-11-12 | Part 1 UI: setup wizard, login, forced password change, app layout, settings shell                                          | —   | 20 web tests + 3 Playwright E2E (setup -> sign out -> wrong/right password) green against a real Host. Fixed dev proxy so reloading /setup serves the app                                                                                                                                                                                                                                                                                                                                                                                                  |
| 2026-11-12 | Web app shell                                                                                                               | —   | 10 web tests green, `vite build` ok. Pages for setup/login/home/settings are placeholders; guards redirect by Host + session state. Playwright browsers not installed yet (`pnpm exec playwright install chromium`)                                                                                                                                                                                                                                                                                                                                        |
| 2026-11-12 | Part 1 backend: contracts, auth tables, setup, sign-in/out/me/change-password, permission middleware, rate limiting         | —   | 18 server + 6 core tests green; typecheck + lint green. Auth is custom (scrypt + sha256-hashed bearer tokens) instead of Better Auth to keep our own users table                                                                                                                                                                                                                                                                                                                                                                                           |
| 2026-11-12 | Repo cloned, scanned, progress log + Phase A plan created                                                                   | —   | Scaffold state: server `/host/info`, core + db packages; web/desktop/ui/editor are stubs                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
