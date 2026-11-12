# Phase A — Detailed Execution Plan (5 Parts)

> Goal: the **MVP** — manager creates a project, assigns work, artist submits, manager reviews/approves, all on a local office Host. Exit = spec §13 scenario green and `v0.1.0` running on the real Host.
> This regroups the four sprints (A1–A4) of `EXECUTION_PLAN.md` §5 into 5 parts. Tick progress in `PROGRESS.md` after every feature.
> Dev A / Dev B labels follow the ownership table in `EXECUTION_PLAN.md`; with one developer, just follow the order.

## How every feature is built (applies to all parts)
1. **Contract first** — Zod schemas + endpoint signature in `packages/core`, merged first.
2. **DB** — one migration per change in `packages/db` (Drizzle), CI runs migrations from scratch.
3. **API** — Fastify route in `apps/server/src/routes`, behind permission middleware.
4. **UI** — `apps/web` screens against MSW mocks, switched to the real API once merged.
5. **Tests** — unit + API integration (temp SQLite) + permission test per role + Playwright where there's a user flow.
6. **Done** = tests/typecheck/lint pass, works in the desktop app against a Host, `PROGRESS.md` updated.

## Prerequisites (finish Week 0 first)
- `pnpm install && pnpm lint && pnpm typecheck && pnpm test` all green on a clean clone.
- Web shell exists (Vite + React + Tailwind + routing + base components + MSW + Playwright).
- Sidecar spike proven (Node + `better-sqlite3` + `sharp` start inside the Tauri installer).
- Decisions needed from owner (spec §14): Host PC, backup drive, roles naming.

---

## Part 1 — Foundation: Host, auth, permissions (≈ 1 week)
**Outcome:** the owner can set up the Host and sign in; every endpoint is protected by role.

| # | Task | Details / acceptance |
|---|---|---|
| 1.1 | Contracts | `setupRequest`, `signInRequest`, `session`, `user`, role enum (owner/admin/member/guest) in `packages/core` |
| 1.2 | DB schema | `workspaces`, `users`, `sessions`, `credentials`; migration `0001`. Guest `expires_at` column included now |
| 1.3 | Setup | `POST /setup` creates workspace + owner, allowed **only once** (409 afterwards); `/host/info.setupDone` flips. Wizard screen in web |
| 1.4 | Auth | Better Auth, email + password, bearer sessions, change password, `must_change_password` flag with forced-change flow |
| 1.5 | Login UI | Login screen, session stored securely, redirect to wizard if `setupDone=false` |
| 1.6 | Permissions | Fastify preHandler: `requireRole(...)`, `requireProjectAccess` stub. **Matrix test**: every route × every role |
| 1.7 | Rate limiting | `@fastify/rate-limit` on login/setup (e.g. 10/min/IP), tested |
| 1.8 | Settings shell | Settings route/layout with empty sections (Account, Connection, Host) |

**Exit check:** fresh DB → run wizard → login → wrong password is rate-limited → a guest token gets 403 on admin routes.

---

## Part 2 — Members, invites, connecting from other PCs (≈ 1 week)
**Outcome:** staff and freelancers join from other PCs; removal revokes access instantly. (= Sprint A1 demo)

| # | Task | Details / acceptance |
|---|---|---|
| 2.1 | Discovery | mDNS announce of the Host (`_whiteboard._tcp`); **Connect to Host** screen with discovered list + manual IP:port; version shown |
| 2.2 | Invite codes | `invites` table; create code with role (+ guest end date); code shown **once**, stored hashed; revoke; accept-invite screen sets password |
| 2.3 | Members | Members list API; page with role, status, guest end date, revoke invite |
| 2.4 | Password reset | Admin resets a member's password → temp password + forced change |
| 2.5 | Offboarding | Remove member → dialog with **reassign open tasks** step → sessions revoked immediately (tasks stubbed until Part 4, wired later) |
| 2.6 | Scheduler | `jobs` table + in-process scheduler with catch-up on startup; **guest expiry** daily job disables expired guests |
| 2.7 | Account settings | Change password, display name, sign out |

**Exit check (demo):** owner invites a staff member + a freelancer (with end date); both log in from other PCs; freelancer sees nothing yet; removing a member kills their session at once.

---

## Part 3 — Projects, files, backups (≈ 2 weeks)
**Outcome:** manager creates a project with brief and files; data is safe and restorable. (= Sprint A2)

| # | Task | Details / acceptance |
|---|---|---|
| 3.1 | Files pipeline | Streamed multipart upload to Host data dir, sha256, MIME/content sniffing, max size setting, thumbnails (`sharp`), Range downloads, access checked per project |
| 3.2 | Uploader + previews | Shared `<FileUploader>` (progress, cancel, retry) in `packages/ui`; previews: images, PDF (pdf.js), video |
| 3.3 | Backups | Daily SQLite online backup + files; **Backup now**; pre-migration backup; pruning policy; stale-backup warning; **restore** flow (tested on a second Host) |
| 3.4 | Host settings | Backup folder, last backup time, disk space, Backup now, Restore |
| 3.5 | Projects API | `projects`, `project_members`; status flow (draft → active → in review → delivered → archived); default task statuses seeded per project; add/remove member |
| 3.6 | Project files | `project_files` using the uploader; permissions: members only |
| 3.7 | Projects UI | List, create-project flow (TipTap brief editor, files, deadline), overview page (no board tab in Phase A) |

**Exit check (demo):** manager creates a project with brief + files and adds the freelancer; owner runs Backup now and restores it on a test Host; a non-member cannot fetch the project's files.

---

## Part 4 — Tasks, kanban, comments, notifications (≈ 2 weeks)
**Outcome:** work is assigned and tracked; people are notified live. (= Sprint A3)

| # | Task | Details / acceptance |
|---|---|---|
| 4.1 | Tasks API | Tasks with status, assignees, subtasks, task files, priority, due date; only project members assignable |
| 4.2 | List + drawer | Task list view, task detail drawer, inline edit |
| 4.3 | Kanban | Columns = project statuses, drag-to-status with optimistic update + rollback |
| 4.4 | Queries | **My tasks** page; **review queue** query (consumed in Part 5) |
| 4.5 | Comments | Task history log, comments, @mentions with autocomplete |
| 4.6 | Notifications | `notifications` table; push via WebSocket `/events`; bell + inbox, mark read |
| 4.7 | Live updates | Task changes broadcast over `/events` to project members; reconnect + resync |
| — | Wire-up | Connect Part 2 offboarding reassignment to real tasks |

**Exit check (demo):** manager assigns a task → artist gets a live notification, sees it in My tasks, comments, moves it to In progress; manager sees it update live.

---

## Part 5 — Review flow, pins, desktop polish, release (≈ 2 weeks)
**Outcome:** the full submit → review → approve loop, shipped as an installer. (= Sprint A4)

| # | Task | Details / acceptance |
|---|---|---|
| 5.1 | Deliverables | Deliverables with versions v1, v2…; **submit for review** moves task to In review and notifies reviewers |
| 5.2 | Reviews | Approve / request changes with feedback; review screen; review queue page |
| 5.3 | Version compare | Compare endpoint + side-by-side view (image/PDF) |
| 5.4 | Pins | Pins on a deliverable, pin comments, resolve/unresolve |
| 5.5 | Deadline watcher | Job that notifies on due/overdue, with catch-up after Host downtime |
| 5.6 | Desktop integration | Windows notifications, client/Host version-compatibility check, "reconnecting" banner |
| 5.7 | Tray/auto-start | Start with Windows, minimize to tray |
| 5.8 | Release | GitHub Actions builds `.msi` on tag; install-tested on a clean PC |
| 5.9 | Spike | 2-day Hocuspocus/Yjs-in-server spike to de-risk Phase B |
| 5.10 | **Acceptance** | Spec §13 scenario as a Playwright test in CI **and** by hand on 3 office PCs; tag `v0.1.0`; install on the real Host; verify daily backups |

**Exit = MVP:** §13 green, `v0.1.0` installed, team runs a real internal project, backups verified.

---

## Summary
| Part | Focus | Est. | Depends on |
|---|---|---|---|
| 1 | Host, auth, permissions | 1 wk | Week 0 |
| 2 | Members, invites, connect | 1 wk | Part 1 |
| 3 | Projects, files, backups | 2 wk | Part 2 |
| 4 | Tasks, kanban, notifications | 2 wk | Part 3 |
| 5 | Review flow, desktop, release | 2 wk | Part 4 |

Total ≈ 8 weeks (+25% buffer). Re-plan after each part's demo.
