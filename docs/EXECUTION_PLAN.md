# Whiteboard — Execution Plan

> Companion to `PRODUCT_SPEC.md` · Date: 2026-11-11
> Team: **2 full-stack developers — Dev A and Dev B** (+ the owner for product decisions).
> Section numbers like §3B refer to `PRODUCT_SPEC.md`.

---

## 1. Team & ownership

Both developers work across the whole stack. Work is split **by feature (vertical slice)**, not by layer: the developer who owns a feature builds its contract, database tables, API, screens and tests end to end. Each sprint, each developer owns a coherent area so the two rarely edit the same files.

| | **Dev A** | **Dev B** |
|---|---|---|
| Week 0 | Monorepo scaffold, CI, server hello-world (Fastify + SQLite + `/host/info`), Tauri shell, sidecar bundling | Web app shell, design system tokens & base components, Playwright + MSW, `/setup` + Host setup wizard |
| Phase A areas | Host & auth, files & backups, tasks & kanban, deliverables & review flow | Members & access, projects, comments & notifications, pins, desktop integration & release |
| Phase B areas | Canvas engine, cards, Hocuspocus inside the server, persistence/projector | Boards API, nesting, trash, task ↔ card sync, presence, realtime events |
| Tests (for own features) | Unit + API integration tests (temp SQLite file), permission tests per role, component tests, Playwright E2E | same |

**Shared foundations** (touched by both, changed only via a PR reviewed by the other dev): `packages/core` (Zod contracts & types), `packages/db` (schema & migrations), `packages/ui` (design system), permission middleware, the `/events` WebSocket, CI and the installer build.

**Owner (you):** product decisions, priorities, answering §14 of the spec, sprint demos, acceptance of each phase.

---

## 2. How the two developers avoid blocking each other — contract first

1. For every feature, **its owner first writes the Zod schemas + endpoint signatures in `packages/core`** (≤ 1 day) and merges them.
2. If the other developer's feature needs that API, they build against **mock handlers (MSW)** generated from those schemas — no waiting for the real endpoint.
3. When the real endpoint is merged, mocks are switched off.
4. Migrations: one migration per PR, rebase before merging so migration numbers never clash.
5. Any change to a contract, a shared migration or a shared component = PR labelled `contract`, reviewed by the other developer.

---

## 3. Ways of working

| Topic | Rule |
|---|---|
| Repo | One GitHub monorepo `whiteboard` (pnpm + Turborepo). `docs/` holds `PRODUCT_SPEC.md`, `EXECUTION_PLAN.md`, `docs/adr/` (decision records) |
| Branches | **`main`** = released versions (installed in the office) · **`develop`** = integration branch, installed on the Test Host for demos · feature branches `feat/<issue#>-short-name` (and `fix/…`, `chore/…`) **created from `develop`** · hotfixes `hotfix/…` from `main`. Both `main` and `develop` are protected (no direct pushes) |
| Merging | Feature → `develop`: squash-merge via PR · `develop` → `main`: release PR at the end of each sprint/phase (merge commit, tagged `vX.Y.Z`) · hotfix → `main`, then merge `main` back into `develop` |
| Pull requests | Target **`develop`** by default. Small (< 400 lines ideal), CI green, linked issue. Reviewer: the other developer for `contract` PRs and anything in the shared foundations (§1); otherwise self-merge allowed after CI + 24 h or a review. Release PRs into `main` are approved by the owner |
| CODEOWNERS | Both developers on every path; `packages/core`, `packages/db`, `packages/ui` and `.github` require the other developer's review |
| Commits | Conventional commits (`feat:`, `fix:`, `chore:`…) |
| Tracking | GitHub Projects board: Backlog → Ready → In progress → In review → Done; each issue is one vertical slice assigned to one developer; labels `contract` / `infra` / `ui` / `api`; estimate S/M/L |
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
| Monorepo scaffold (`apps/web`, `apps/desktop`, `apps/server`, `packages/*`), lint/format/typecheck, Vitest, CI pipeline, CODEOWNERS — **first PR, unblocks Dev B** | Dev A |
| `apps/server` hello-world: Fastify + SQLite (better-sqlite3 + Drizzle) + first migration + `GET /host/info`; data folder in `./.data` for dev | Dev A |
| **Sidecar spike:** bundle Node 22 + the server (incl. native modules `better-sqlite3`, `sharp`) into the Tauri installer and start it from the app — proves the hardest packaging risk in week 0 | Dev A + Dev B (pair) |
| Tauri 2 shell: first-run screen (Set up as Host / Connect to Host), start/stop the sidecar, tray icon | Dev A |
| Vite + React app shell, routing, Tailwind, design tokens (light/dark), base components, Playwright + MSW setup | Dev B |
| First contracts (`/setup`, sign-in) in `packages/core`; `POST /setup` + Host setup wizard started | Dev B |
| Brand basics: Whiteboard logo placeholder, color palette, font, app icon | Dev B + owner |
| Owner picks the Host PC and a spare PC for the Test Host; buys/assigns an external backup drive | Owner |
| Create Phase A issues on the board | Both |

**Exit:** both developers can clone and run `pnpm dev` (no Docker, no accounts); `pnpm tauri build` produces an `.msi` that installs on a second PC, starts in Host mode and answers `/host/info` from another PC on the LAN.

---

## 5. Phase A — the manager ⇄ artist workflow (≈ 8 weeks, 4 sprints)

Each cell is a vertical slice: contract + DB + API + screens + tests, built by the same developer.

| Sprint | Dev A | Dev B | Sprint demo |
|---|---|---|---|
| **A1** (wk 1–2) — Host, login, members | **Host & auth:** `/setup` (workspace + owner) + Host setup wizard, Better Auth (email + password, bearer sessions, change password) + login screen + forced password change, **permission middleware** (owner/admin/member/guest) with tests per role, rate limiting, mDNS announce + **Connect to Host** screen (auto-discovered list + manual IP), settings shell incl. Connection | **Members & access:** **invite codes** API + accept-invite screen, member list API + members & invites page (role, guest end date, show code once, revoke), admin password reset, **offboarding** (remove member + reassign open tasks + revoke sessions) + **remove-member dialog with task-reassignment step**, scheduler + `jobs` table, **guest expiry** (`expires_at` + daily job), settings Account section | Owner sets up the Host and creates codes for a staff member and a freelancer (with an end date); both log in from other PCs; freelancer sees nothing yet; removing a member revokes access immediately |
| **A2** (wk 3–4) — Projects, files, backups | **Files & backups:** files pipeline (streamed upload to the Host, sha256, content check, max size, thumbnails, Range downloads) + shared **file uploader** + previews (images, PDF via pdf.js, video), **backups** (daily + Backup now + pre-migration, pruning, stale-backup warning) and **restore**, Host settings page (backup folder, last backup, Backup now, Restore) | **Projects:** projects API + status flow, project members + add-member UI, default task statuses seeded per project, **project files** (`project_files`, using Dev A's uploader), projects list, create-project flow (brief editor with TipTap, files, deadline), project overview page. No board tab in Phase A | Manager creates a project with brief + files and adds the freelancer; owner runs Backup now and restores it on the Test Host |
| **A3** (wk 5–6) — Tasks, kanban, notifications | **Tasks:** tasks API (statuses, assignees, subtasks, task files, priority, due), task list view, task detail drawer, **kanban** with drag-to-status, My tasks query + page, review-queue query | **Comments & notifications:** task history, **task comments** + @mentions (API + UI with autocomplete), **in-app notifications** (`notifications` rows + WebSocket `/events` push) + **notification bell + inbox**, live task updates over `/events` | Manager assigns a task; artist gets an in-app notification, sees it in My tasks, comments, moves to In progress |
| **A4** (wk 7–8) — Review flow, release | **Review flow:** deliverables & versions + submit-for-review flow, reviews (approve/changes) + **review screen** + review queue page, version list + **version compare** endpoint + **side-by-side compare**, 2-day Hocuspocus-in-server spike | **Pins, desktop & release:** pins API + pin comments UI + resolve, deadline watcher job (with catch-up after Host downtime), **Windows desktop notifications**, version-compatibility check, reconnecting banner, auto-start + minimize-to-tray, release workflow (`.msi` on tag) | **Full §13 scenario passes: as a Playwright test in CI (written by both) and by hand on 3 office PCs** |

**Phase A exit = MVP:** the §13 end-to-end scenario runs green; `v0.1.0` is installed on the real office Host and the team runs a real internal project on it, with daily backups verified.

---

## 6. Phase B — visual boards (≈ 6 weeks, 3 sprints)

| Sprint | Dev A | Dev B | Demo |
|---|---|---|---|
| **B1** | **Canvas engine:** pan/zoom/fit, select/multi-select, drag/resize, grid; Hocuspocus inside the Host server + SQLite persistence | **Boards:** boards API, nesting + breadcrumbs, root board per project (+ back-fill), trash API | Board per project; move cards around |
| **B2** | **Cards:** note, image, file, link, column, line cards; undo/redo; snapshot projector (items/lines rows) | Link-unfurl job + link card previews, search index, context menus, trash panel | Moodboard with notes, images, columns, arrows |
| **B3** | Realtime polish: live cursors, presence | **Task cards:** task ↔ card sync, task cards on board, realtime events | Two users edit one board live; task card updates kanban |

---

## 7. Phase C & D — outline

| Phase | Dev A | Dev B | Length |
|---|---|---|---|
| **C (v2)** | Calendar view + filters + saved views, dashboard & reporting, export (PDF/PNG/Word/Markdown/zip) | Host as Windows service, LAN encryption (self-made cert + pinning), Host-served updates + one-click Update, settings, templates, table/doc cards | ≈ 8 weeks |
| **D (v3)** | Gantt/timeline, dependencies, recurring tasks, time tracking | Sketch/draw, embeds, `.ics` export, optional company-SMTP email | ≈ 8 weeks |

Splits for Phases B–D are a starting point; re-assign slices at sprint planning based on who finished what.

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
| Canvas + realtime is the hardest part | Kept out of the MVP; Dev A spikes Yjs/Hocuspocus in A4 before Phase B |
| The two developers blocking each other or editing the same files | Split by feature (§1); contract-first schemas + MSW mocks (§2); shared foundations changed only via reviewed PRs |
| Migration conflicts (both developers add tables in the same sprint) | One migration per PR, rebase on `develop` before merge, CI runs migrations from scratch |
| Scope creep from the reference app | Build only what's in the current phase; new ideas go to Backlog |
| **Host PC fails or is lost (theft, disk death) → all data gone** | Daily automatic backups to a separate drive, weekly off-site copy, monthly restore test, warning in the app when backups are stale (spec §11.2) |
| Host PC is off/asleep → nobody can work | Always-on PC with sleep disabled, start with Windows, tray app; Phase C runs the server as a Windows service |
| Bundling Node + native modules (`better-sqlite3`, `sharp`) into the installer | Sidecar spike in Week 0 before any feature work |
| Large uploads fill the Host disk | Global max upload size, disk-space warning in Host settings, thumbnails instead of full files in lists |
| Clients and Host on different versions after an update | Version check on every request; update the Host first, then clients (spec §11.4) |
| Unencrypted traffic on the office Wi-Fi | Private Wi-Fi password, guest Wi-Fi separate; encryption added in Phase C |
| Permission bugs (freelancers seeing other projects) | Central permission middleware + tests for every role on every endpoint |
| One developer unavailable | Both are full-stack, so the other can pick up any slice; `contract` PRs reviewed by both, ADRs for decisions, README per app |

---

## 10. First actions (in order)

1. ✅ Name: **Whiteboard**.
2. Owner creates the GitHub repo `whiteboard` and invites both developers.
3. Copy `PRODUCT_SPEC.md` and `EXECUTION_PLAN.md` into `docs/`.
4. Week 0 tasks (§4) — scaffold, CI, sidecar spike, pick the Host PC and backup drive.
5. Create Sprint A1 issues and start.
