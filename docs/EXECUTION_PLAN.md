# Whiteboard — Execution Plan

> Companion to `PRODUCT_SPEC.md` · Date: 2026-11-11
> Team: **1 Backend developer** + **1 Frontend developer** (+ the owner for product decisions).
> Section numbers like §3B refer to `PRODUCT_SPEC.md`.

---

## 1. Team & ownership

Each developer stays in their lane. They review each other's PRs only where the two areas meet (API contracts, shared types).

| | **Backend developer** | **Frontend developer** |
|---|---|---|
| Owns | `apps/server`, `packages/db`, `packages/core` (schemas & types), `scripts/` (sidecar bundling), CI, installer build | `apps/web`, `apps/desktop`, `packages/ui`, `packages/canvas`, `packages/editor` |
| Responsible for | SQLite schema & migrations, auth & permissions, REST/WebSocket APIs, file storage on the Host, scheduler/jobs, notifications delivery, backups & restore, mDNS announce, realtime server, security, packaging the server into the installer | Every screen, design system, UX, kanban, review & pin UI, canvas, notifications UI (bell + Windows toasts), Tauri shell (Host/Client mode, sidecar start/restart, tray, auto-start, Host discovery), accessibility |
| Tests | Unit + API integration tests (temp SQLite file); permission tests per role; backup/restore tests | Component tests + Playwright UI/E2E tests |
| Phase A | Auth, roles, invite codes, projects/tasks/reviews APIs, files pipeline, notifications, scheduler, backups | Desktop shell, app shell, design system, project & task screens, kanban, review screen, notification bell |
| Phase B | Hocuspocus inside the server, persistence/projector, realtime events | Canvas engine, cards, task cards on board |

**Owner (you):** product decisions, priorities, answering §14 of the spec, sprint demos, acceptance of each phase.

---

## 2. How backend and frontend avoid blocking each other — contract first

1. For every feature, **the backend developer first writes the Zod schemas + endpoint signatures in `packages/core`** (≤ 1 day) and merges them.
2. The frontend developer builds the screens immediately against **mock handlers (MSW)** generated from those schemas.
3. The backend developer implements the real endpoint; once merged, the frontend developer switches off the mock. No waiting.
4. Any change to a contract = PR labelled `contract`, reviewed by both.

---

## 3. Ways of working

| Topic | Rule |
|---|---|
| Repo | One GitHub monorepo `whiteboard` (pnpm + Turborepo). `docs/` holds `PRODUCT_SPEC.md`, `EXECUTION_PLAN.md`, `docs/adr/` (decision records) |
| Branches | **`main`** = released versions (installed in the office) · **`develop`** = integration branch, installed on the Test Host for demos · feature branches `feat/<issue#>-short-name` (and `fix/…`, `chore/…`) **created from `develop`** · hotfixes `hotfix/…` from `main`. Both `main` and `develop` are protected (no direct pushes) |
| Merging | Feature → `develop`: squash-merge via PR · `develop` → `main`: release PR at the end of each sprint/phase (merge commit, tagged `vX.Y.Z`) · hotfix → `main`, then merge `main` back into `develop` |
| Pull requests | Target **`develop`** by default. Small (< 400 lines ideal), CI green, linked issue. Reviewer: the other developer for `contract` PRs; otherwise self-merge allowed after CI + 24 h or a review. Release PRs into `main` are approved by the owner |
| CODEOWNERS | `apps/server`, `packages/db`, `scripts`, `.github` → backend · `apps/web`, `apps/desktop`, `packages/ui`, `packages/canvas`, `packages/editor` → frontend · `packages/core` → both |
| Commits | Conventional commits (`feat:`, `fix:`, `chore:`…) |
| Tracking | GitHub Projects board: Backlog → Ready → In progress → In review → Done; labels `backend` / `frontend` / `contract`; estimate S/M/L |
| Sprints | 2 weeks. Monday: plan (30 min). Daily: async standup message (yesterday / today / blocked). Friday of week 2: demo to owner + retro (45 min) |
| Definition of Done | Code + tests + types pass + reviewed (if required) + works in the desktop app against a Host (dev or Test Host) + issue updated |
| Decisions | Anything hard to reverse (library, data model, auth) → short ADR in `docs/adr/` |
| Secrets | Almost none (no cloud services). Never commit `.data/`, databases, backups or real project files; `.env.example` lists dev settings |
| Cost | **Zero.** Only free/open-source libraries and GitHub's free tier. Anything that needs a paid plan or an online service is out of scope unless the owner approves it |
| Pairing | 1 h/week on the integration-heavy pieces (review flow, realtime canvas) |

---

## 4. Week 0 — setup (3–5 days)

| Task | Owner |
|---|---|
| Create GitHub repo `whiteboard` with `main` + `develop` (✅ done), invite both developers, branch protection on `main` and `develop`, set `develop` as the default branch for PRs | Owner |
| Copy `PRODUCT_SPEC.md` + `EXECUTION_PLAN.md` into `docs/` | Owner |
| Monorepo scaffold (`apps/web`, `apps/desktop`, `apps/server`, `packages/*`), lint/format/typecheck, Vitest, CI pipeline, CODEOWNERS | Backend |
| `apps/server` hello-world: Fastify + SQLite (better-sqlite3 + Drizzle) + first migration + `GET /host/info`; data folder in `./.data` for dev | Backend |
| **Sidecar spike:** bundle Node 22 + the server (incl. native modules `better-sqlite3`, `sharp`) into the Tauri installer and start it from the app — proves the hardest packaging risk in week 0 | Backend + Frontend |
| Tauri 2 shell: first-run screen (Set up as Host / Connect to Host), start/stop the sidecar, tray icon | Frontend |
| Vite + React app shell, routing, Tailwind, design tokens (light/dark), base components, Playwright setup | Frontend |
| Brand basics: Whiteboard logo placeholder, color palette, font, app icon | Frontend + owner |
| Owner picks the Host PC and a spare PC for the Test Host; buys/assigns an external backup drive | Owner |
| Create Phase A issues on the board | Both |

**Exit:** both developers can clone and run `pnpm dev` (no Docker, no accounts); `pnpm tauri build` produces an `.msi` that installs on a second PC, starts in Host mode and answers `/host/info` from another PC on the LAN.

---

## 5. Phase A — the manager ⇄ artist workflow (≈ 8 weeks, 4 sprints)

| Sprint | Backend developer | Frontend developer | Sprint demo |
|---|---|---|---|
| **A1** (wk 1–2) | `/setup` (workspace + owner), Better Auth (email + password, bearer sessions), roles (owner/admin/member/guest), **invite codes**, admin password reset, permission middleware, member list API, **offboarding** (remove member + reassign open tasks + revoke sessions), **guest expiry** (`expires_at` + daily job), scheduler + `jobs` table, mDNS announce | Host setup wizard, **Connect to Host** screen (auto-discovered list + manual IP), login / invite-code screens, members & invites page (role, guest end date, show code once, revoke), **remove-member dialog with task-reassignment step**, settings shell incl. Connection | Owner sets up the Host and creates codes for a staff member and a freelancer (with an end date); both log in from other PCs; freelancer sees nothing yet; removing a member revokes access immediately |
| **A2** (wk 3–4) | Projects API, project members, **project files** (`project_files`), default task statuses seeded per project, files pipeline (streamed upload to the Host, sha256, thumbnails, Range downloads), **backups** (daily + Backup now + pre-migration) and **restore** | Projects list, create-project flow (brief editor with TipTap, files, deadline), project overview page, file uploader + previews (images, PDF via pdf.js, video), Host settings page (backup folder, last backup, Backup now, Restore). No board tab in Phase A | Manager creates a project with brief + files and adds the freelancer; owner runs Backup now and restores it on the Test Host |
| **A3** (wk 5–6) | Tasks API (statuses, assignees, subtasks, task files, priority, due), My tasks + review-queue queries, task history, **task comments** + @mentions, **in-app notifications** (`notifications` rows + WebSocket `/events` push) | Task list view, task detail drawer, **kanban** with drag-to-status, My tasks page, task comments with mentions, **notification bell + inbox** | Manager assigns a task; artist gets an in-app notification, sees it in My tasks, comments, moves to In progress |
| **A4** (wk 7–8) | Deliverables & versions, **version compare** endpoint, reviews (approve/changes), pins API, deadline watcher job (with catch-up after Host downtime), version-compatibility check, release workflow (`.msi` on tag), 2-day Hocuspocus-in-server spike | Submit-for-review flow, **review screen** with pin comments, version list + **side-by-side compare**, **Windows desktop notifications**, reconnecting banner, auto-start + minimize-to-tray | **Full §13 scenario passes: as a Playwright test in CI and by hand on 3 office PCs** |

**Phase A exit = MVP:** the §13 end-to-end scenario runs green; `v0.1.0` is installed on the real office Host and the team runs a real internal project on it, with daily backups verified.

---

## 6. Phase B — visual boards (≈ 6 weeks, 3 sprints)

| Sprint | Backend developer | Frontend developer | Demo |
|---|---|---|---|
| **B1** | Boards API, nesting, trash, Hocuspocus inside the Host server + SQLite persistence | Canvas engine: pan/zoom/fit, select/multi-select, drag/resize, grid | Board per project; move cards around |
| **B2** | Snapshot projector (items/lines rows), link-unfurl job, search index | Note, image, file, link, column, line cards; context menus; undo/redo | Moodboard with notes, images, columns, arrows |
| **B3** | Task ↔ card sync, realtime events, presence | Task cards on board, live cursors, breadcrumbs, trash panel | Two users edit one board live; task card updates kanban |

---

## 7. Phase C & D — outline

| Phase | Backend developer | Frontend developer | Length |
|---|---|---|---|
| **C (v2)** | Calendar/filter queries, saved views, dashboard data, export data, Host as Windows service, LAN encryption (self-made cert + pinning), Host-served updates | Calendar view, filters, dashboard, export (PDF/PNG/Word/Markdown/zip), settings, templates, table/doc cards, one-click Update | ≈ 8 weeks |
| **D (v3)** | Dependencies/recurring/time tracking, `.ics` export, optional company-SMTP email | Gantt/timeline, sketch/draw, embeds | ≈ 8 weeks |

Not planned (local app, no paid services): billing/quotas, client portal & public links, mobile app, web clipper, Slack/Google integrations.

---

## 8. Milestones

| Milestone | Target (from start of Week 1) |
|---|---|
| Week 0 setup done | Week 0 |
| First login from a second PC over the LAN | End of A1 (week 2) |
| **MVP: §13 scenario green** | **End of A4 (week 8)** |
| Visual boards live | End of B3 (week 14) |
| v2 (calendar, dashboard, export, Host as service, in-app updates) | ~Week 22 |

Estimates assume both developers full-time; add ~25% buffer. Re-plan at every retro.

---

## 9. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Canvas + realtime is the hardest part | Kept out of the MVP; backend spikes Yjs in A4 before Phase B |
| Backend and frontend blocking each other | Contract-first schemas + MSW mocks (§2) |
| Scope creep from the reference app | Build only what's in the current phase; new ideas go to Backlog |
| **Host PC fails or is lost (theft, disk death) → all data gone** | Daily automatic backups to a separate drive, weekly off-site copy, monthly restore test, warning in the app when backups are stale (spec §11.2) |
| Host PC is off/asleep → nobody can work | Always-on PC with sleep disabled, start with Windows, tray app; Phase C runs the server as a Windows service |
| Bundling Node + native modules (`better-sqlite3`, `sharp`) into the installer | Sidecar spike in Week 0 before any feature work |
| Large uploads fill the Host disk | Global max upload size, disk-space warning in Host settings, thumbnails instead of full files in lists |
| Clients and Host on different versions after an update | Version check on every request; update the Host first, then clients (spec §11.4) |
| Unencrypted traffic on the office Wi-Fi | Private Wi-Fi password, guest Wi-Fi separate; encryption added in Phase C |
| Permission bugs (freelancers seeing other projects) | Central permission middleware + tests for every role on every endpoint |
| One developer unavailable | `contract` PRs reviewed by both, ADRs for decisions, README per app |

---

## 10. First actions (in order)

1. ✅ Name: **Whiteboard**.
2. Owner creates the GitHub repo `whiteboard` and invites both developers.
3. Copy `PRODUCT_SPEC.md` and `EXECUTION_PLAN.md` into `docs/`.
4. Week 0 tasks (§4) — scaffold, CI, sidecar spike, pick the Host PC and backup drive.
5. Create Sprint A1 issues and start.
