# Whiteboard — Execution Plan

> Companion to `PRODUCT_SPEC.md` · Date: 2026-11-11
> Team: **1 Backend developer** + **1 Frontend developer** (+ the owner for product decisions).
> Section numbers like §3B refer to `PRODUCT_SPEC.md`.

---

## 1. Team & ownership

Each developer stays in their lane. They review each other's PRs only where the two areas meet (API contracts, shared types).

| | **Backend developer** | **Frontend developer** |
|---|---|---|
| Owns | `apps/api`, `apps/collab`, `packages/db`, `packages/core` (schemas & types), `infra/`, CI/CD, hosting | `apps/web`, `apps/desktop`, `packages/ui`, `packages/canvas`, `packages/editor` |
| Responsible for | Database, auth & permissions, REST/WebSocket APIs, file storage, background jobs, emails, notifications delivery, realtime server, security, backups, deploys | Every screen, design system, UX, kanban, review & pin UI, canvas, notifications UI, desktop app, accessibility |
| Tests | Unit + API integration tests; permission tests per role | Component tests + Playwright UI/E2E tests |
| Phase A | Auth, roles, invites, projects/tasks/reviews APIs, files pipeline, notifications, jobs | App shell, design system, project & task screens, kanban, review screen, notification bell |
| Phase B | Yjs collab server, persistence/projector, realtime events | Canvas engine, cards, task cards on board |

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
| Branches | **`main`** = production (released code only) · **`develop`** = integration branch, auto-deploys to staging · feature branches `feat/<issue#>-short-name` (and `fix/…`, `chore/…`) **created from `develop`** · hotfixes `hotfix/…` from `main`. Both `main` and `develop` are protected (no direct pushes) |
| Merging | Feature → `develop`: squash-merge via PR · `develop` → `main`: release PR at the end of each sprint/phase (merge commit, tagged `vX.Y.Z`) · hotfix → `main`, then merge `main` back into `develop` |
| Pull requests | Target **`develop`** by default. Small (< 400 lines ideal), CI green, linked issue. Reviewer: the other developer for `contract` PRs; otherwise self-merge allowed after CI + 24 h or a review. Release PRs into `main` are approved by the owner |
| CODEOWNERS | `apps/api`, `apps/collab`, `packages/db`, `infra` → backend · `apps/web`, `apps/desktop`, `packages/ui`, `packages/canvas`, `packages/editor` → frontend · `packages/core` → both |
| Commits | Conventional commits (`feat:`, `fix:`, `chore:`…) |
| Tracking | GitHub Projects board: Backlog → Ready → In progress → In review → Done; labels `backend` / `frontend` / `contract`; estimate S/M/L |
| Sprints | 2 weeks. Monday: plan (30 min). Daily: async standup message (yesterday / today / blocked). Friday of week 2: demo to owner + retro (45 min) |
| Definition of Done | Code + tests + types pass + reviewed (if required) + deployed to staging + issue updated |
| Decisions | Anything hard to reverse (library, data model, auth) → short ADR in `docs/adr/` |
| Secrets | Never in git; `.env.example` lists keys; real values in GitHub Actions secrets / Fly / Cloudflare |
| Pairing | 1 h/week on the integration-heavy pieces (review flow, realtime canvas) |

---

## 4. Week 0 — setup (3–5 days)

| Task | Owner |
|---|---|
| Create GitHub repo `whiteboard` with `main` + `develop` (✅ done), invite both developers, branch protection on `main` and `develop`, set `develop` as the default branch for PRs | Owner |
| Copy `PRODUCT_SPEC.md` + `EXECUTION_PLAN.md` into `docs/` | Owner |
| Monorepo scaffold, lint/format/typecheck, Vitest, CI pipeline, CODEOWNERS | Backend |
| Docker Compose: Postgres, Redis, MinIO, Mailpit; `.env.example` | Backend |
| Staging environment (Fly.io, Neon, R2, Cloudflare Pages) with hello-world deploy | Backend |
| Vite + React app shell, routing, Tailwind, design tokens (light/dark), base components, Playwright setup | Frontend |
| Brand basics: Whiteboard logo placeholder, color palette, font | Frontend + owner |
| Create Phase A issues on the board | Both |

**Exit:** both developers can clone, run `pnpm dev`, see the app shell, and every PR auto-deploys a preview.

---

## 5. Phase A — the manager ⇄ artist workflow (≈ 8 weeks, 4 sprints)

| Sprint | Backend developer | Frontend developer | Sprint demo |
|---|---|---|---|
| **A1** (wk 1–2) | Auth (Better Auth: email + Google), workspaces, roles (owner/admin/member/guest), invites + emails, permission middleware | Sign up / login / invite-accept screens, workspace switcher, members & invites page, settings shell | Owner invites a staff member and a freelancer; both log in; freelancer (guest) sees nothing yet |
| **A2** (wk 3–4) | Projects API, project members, files pipeline (presigned R2 upload, thumbnails, previews, download) | Projects list, create-project flow (brief editor with TipTap, files, deadline), project overview page, file uploader + previews | Manager creates a project with brief + files and adds the freelancer |
| **A3** (wk 5–6) | Tasks API (statuses, assignees, subtasks, priority, due), My tasks + review-queue queries, task history, comments + @mentions | Task list view, task detail drawer, **kanban** with drag-to-status, My tasks page, comments with mentions | Manager assigns a task; artist sees it in My tasks, comments, moves to In progress |
| **A4** (wk 7–8) | Deliverables & versions, reviews (approve/changes), pins API, notifications (in-app via WebSocket + email), deadline watcher job, 2-day Yjs spike | Submit-for-review flow, **review screen** with pin comments, version list & compare, notification bell + inbox, email templates | **Full §13 scenario passes as a Playwright test on staging** |

**Phase A exit = MVP:** the §13 end-to-end scenario runs green; the team uses staging for a real internal project.

---

## 6. Phase B — visual boards (≈ 6 weeks, 3 sprints)

| Sprint | Backend developer | Frontend developer | Demo |
|---|---|---|---|
| **B1** | Boards API, nesting, trash, Yjs collab server (Hocuspocus) + persistence | Canvas engine: pan/zoom/fit, select/multi-select, drag/resize, grid | Board per project; move cards around |
| **B2** | Snapshot projector (items/lines rows), link-unfurl job, search index | Note, image, file, link, column, line cards; context menus; undo/redo | Moodboard with notes, images, columns, arrows |
| **B3** | Task ↔ card sync, realtime events, presence | Task cards on board, live cursors, breadcrumbs, trash panel | Two users edit one board live; task card updates kanban |

---

## 7. Phase C & D — outline

| Phase | Backend developer | Frontend developer | Length |
|---|---|---|---|
| **C (v2)** | Calendar/filter queries, saved views, dashboard data, client role & public links, export jobs, desktop auto-update server | Calendar view, filters, dashboard, client portal UI, Tauri desktop app, settings, templates, table/doc cards | ≈ 8 weeks |
| **D (v3)** | Stripe billing, quotas, dependencies/recurring/time tracking, integrations | Gantt/timeline, sketch/draw, embeds, mobile app (Expo) start | ≈ 10+ weeks |

---

## 8. Milestones

| Milestone | Target (from start of Week 1) |
|---|---|
| Week 0 setup done | Week 0 |
| First internal login on staging | End of A1 (week 2) |
| **MVP: §13 scenario green** | **End of A4 (week 8)** |
| Visual boards live | End of B3 (week 14) |
| v2 (calendar, dashboard, client access, desktop) | ~Week 22 |

Estimates assume both developers full-time; add ~25% buffer. Re-plan at every retro.

---

## 9. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Canvas + realtime is the hardest part | Kept out of the MVP; backend spikes Yjs in A4 before Phase B |
| Backend and frontend blocking each other | Contract-first schemas + MSW mocks (§2) |
| Scope creep from the reference app | Build only what's in the current phase; new ideas go to Backlog |
| File storage costs / large uploads | Per-plan limits, R2 (no egress fees), thumbnails |
| Permission bugs (freelancers seeing other projects) | Central permission middleware + tests for every role on every endpoint |
| One developer unavailable | `contract` PRs reviewed by both, ADRs for decisions, README per app |
| Generic product name ("Whiteboard") is hard to trademark and search for | Pick a distinctive domain/handle; consider a tagline or prefix for marketing |

---

## 10. First actions (in order)

1. ✅ Name: **Whiteboard**.
2. Owner creates the GitHub repo `whiteboard` and invites both developers.
3. Copy `PRODUCT_SPEC.md` and `EXECUTION_PLAN.md` into `docs/`.
4. Week 0 tasks (§4) — scaffold, CI, staging.
5. Create Sprint A1 issues and start.
