# Whiteboard — Progress Log

> **Update this file every time a feature is completed.** Tick the box, add the date and PR/commit, and add a line to the Changelog.
> Plan details: [`docs/PHASE_A_PLAN.md`](docs/PHASE_A_PLAN.md) · Spec: [`docs/PRODUCT_SPEC.md`](docs/PRODUCT_SPEC.md) · Schedule: [`docs/EXECUTION_PLAN.md`](docs/EXECUTION_PLAN.md)

**Current phase:** Phase A (MVP) — Part 2 complete except task reassignment (Part 4) — Part 3 next
**Last updated:** 2026-11-12 (Part 1 done)

Legend: `[ ]` todo · `[~]` in progress · `[x]` done

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
- [ ] 3.1 Files pipeline (streamed upload, sha256, content check, thumbnails, Range)
- [ ] 3.2 Shared file uploader + previews (image, PDF, video)
- [ ] 3.3 Backups (daily, Backup now, pre-migration, pruning, stale warning) + restore
- [ ] 3.4 Host settings page
- [ ] 3.5 Projects API + status flow + project members
- [ ] 3.6 Project files
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
| Date | Feature | Ref | Notes |
|---|---|---|---|
| 2026-11-12 | Part 2: invites, members, password reset, offboarding, scheduler + guest expiry, mDNS, Connect + Join screens, account name | — | 40 server + 34 web + 4 E2E tests green (invite -> join from a 2nd browser -> reuse refused -> removal kills session). Removed members' emails stay reserved (no re-invite with same email yet) |
| 2026-11-12 | Part 1 UI: setup wizard, login, forced password change, app layout, settings shell | — | 20 web tests + 3 Playwright E2E (setup -> sign out -> wrong/right password) green against a real Host. Fixed dev proxy so reloading /setup serves the app |
| 2026-11-12 | Web app shell | — | 10 web tests green, `vite build` ok. Pages for setup/login/home/settings are placeholders; guards redirect by Host + session state. Playwright browsers not installed yet (`pnpm exec playwright install chromium`) |
| 2026-11-12 | Part 1 backend: contracts, auth tables, setup, sign-in/out/me/change-password, permission middleware, rate limiting | — | 18 server + 6 core tests green; typecheck + lint green. Auth is custom (scrypt + sha256-hashed bearer tokens) instead of Better Auth to keep our own users table |
| 2026-11-12 | Repo cloned, scanned, progress log + Phase A plan created | — | Scaffold state: server `/host/info`, core + db packages; web/desktop/ui/editor are stubs |
