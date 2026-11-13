# Whiteboard — Master Plan (what it is, what is done, what is left, in order)

> **This is the one document to open when you sit down to work.** It says what the product is, where every piece lives in the code, what is already built, and exactly what to build next, step by step.
> Day-to-day tick boxes live in [`PROGRESS.md`](../PROGRESS.md) (update it after every feature). Deeper background: [`PRODUCT_SPEC.md`](PRODUCT_SPEC.md) (what and why), [`EXECUTION_PLAN.md`](EXECUTION_PLAN.md) (team and schedule), [`PHASE_A_PLAN.md`](PHASE_A_PLAN.md) (the original 5-part plan for the MVP).
> Last updated: **2026-11-13** (end of day 2 of building).

---

## 1. What this project is

**Whiteboard** is an internal **visual project-management app for a creative team** (a design / video / agency studio). It runs entirely on the office network. Nothing is hosted in the cloud and nothing costs money per month.

**The problem it solves:** a manager has a client job. They need to put the brief and reference files in one place, hand work to staff and freelancers, see who is doing what, get the work back, give precise feedback ("this logo is too tight, here"), ask for changes, compare version 1 with version 2, and finally approve it. Today that happens across chat, email and shared folders, and things get lost.

**The core loop (this is what "done" means for the MVP):**

```
Manager creates a project (brief, files, deadline)
   -> adds an artist -> creates a task and assigns it
      -> artist is notified, works, asks questions in comments
         -> artist uploads a deliverable (version 1) and submits it for review
            -> manager reviews: drops pins on the image, chooses "Request changes" or "Approve"
               -> artist fixes, uploads version 2, resubmits
                  -> manager compares v1 / v2 and approves -> task done, everything recorded
```

**Who uses it**

| Person | Account type | What they can do |
|---|---|---|
| Owner | `owner` | Everything. Sets up the Host, manages admins, backups, Host settings |
| Admin | `admin` | Sees all projects, manages members and freelancers |
| Staff | `member` | Creates projects (becomes that project's manager), works on projects they are on |
| Freelancer | `guest` | Sees only projects they were added to. Access ends automatically on an end date |
| Client | — | Not a user. Clients receive exported files; they never log in |

**How it runs (the "Host" idea).** One always-on office PC is the **Host**. It runs the server, the database (SQLite) and stores all files. Every other PC runs the same desktop app as a **client** and connects to the Host over the office network. Backups go to a separate drive. Details: `docs/adr/0001-local-desktop-host.md`.

**Tech stack (already chosen and in use)**

| Layer | Choice |
|---|---|
| Desktop shell | Tauri (Windows installer `.msi`) — **not built yet** |
| UI | React 19 + Vite + Tailwind 4, react-router, TanStack Query, TipTap (rich text), pdf.js |
| Server (the Host) | Node + Fastify 5, SQLite (better-sqlite3) + Drizzle ORM, `sharp` for thumbnails |
| Shared code | `packages/core` (Zod schemas = the API contract), `packages/db`, `packages/ui`, `packages/editor` |
| Tests | Vitest + Testing Library + MSW (unit/UI), temp-SQLite API tests, Playwright (end-to-end) |
| Tooling | pnpm + Turborepo, ESLint, Prettier, GitHub Actions CI |

**Product phases**

| Phase | Goal | Status |
|---|---|---|
| **A — MVP** | The manager and artist workflow above, shipped as an installer | **About 60% done** (Parts 1-3 of 5 built) |
| B — Visual boards | A free-form canvas per project (moodboards, notes, images, task cards), live collaboration | Not started |
| C — v2 | Calendar, dashboard, search, export, Windows-service Host, encrypted LAN, more card types | Not started |
| D — v3 | Timeline/Gantt, dependencies, recurring tasks, time tracking, sketch/map/audio cards, optional email | Not started |

---

## 2. Where things live (so you always know where to put new code)

```
D:\WhiteBoard
  PROGRESS.md                  tick boxes, changelog, "Resume here"
  docs/                        this plan, the spec, execution plan, ADRs
  packages/
    core/src/                  THE CONTRACT: Zod schemas + types, one file per area
                               (auth, members, files, projects, backups, host ...)
    db/src/schema.ts           ALL tables (Drizzle). db/migrations/ = generated SQL (never hand-edit)
    ui/src/                    design system: Button, Card, Field, Input, Modal, Select, Spinner, FileUploader
    editor/src/                rich-text (TipTap) components
  apps/
    server/src/                the Host
      routes/<area>.ts         one Fastify plugin per area (+ <area>.test.ts beside it)
      plugins/auth.ts          authenticate + requireRole (permission middleware)
      auth/ files/ backups/ projects/ jobs/   area helpers
      scheduler.ts + jobs/     in-process job runner with catch-up after downtime
      app.ts                   registers every route plugin;  index.ts = process entry
    web/src/                   the React app
      routes.tsx               the route table (add a page here)
      pages/<area>/            screens;  components/ = shared pieces;  lib/api.ts = API client
      test/                    render helper, MSW server
    web/e2e/                   Playwright specs (run in order: smoke.spec.ts, then smoke2-*.spec.ts ...)
    desktop/                   Tauri shell (placeholder only so far)
```

**Rules that keep it tidy**
1. **Contract first:** a new endpoint starts as Zod schemas in `packages/core`.
2. **One migration per change:** edit `packages/db/src/schema.ts`, run `pnpm --filter @whiteboard/db db:generate --name <name>`.
3. **Every route goes behind `authenticate` + `requireRole`** and, for project data, the checks in `apps/server/src/projects/access.ts`. A non-member gets **404**, not 403, so ids cannot be probed.
4. **Every new API path prefix must be added to the dev proxy** in `apps/web/vite.config.ts`.
5. **Every feature ends with:** tests for success, validation, and each role; `PROGRESS.md` ticked and a changelog row added.
6. **Before every push:** `pnpm format`, then `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test` (and `pnpm --filter @whiteboard/web e2e` when a screen changed). Use `npx --yes pnpm@12.18.0 ...` on this PC.
7. **Branching:** branch from `develop` (`feat/phase-a-<topic>`), PR into `develop`, never push to `main`/`develop` directly.

---

## 3. What is DONE (as of 2026-11-13)

All of this is merged into `develop`, tested, and recorded in `PROGRESS.md`.

| Area | What exists |
|---|---|
| Foundation | Monorepo, CI, Fastify server, SQLite + migrations, web shell, design system, MSW + Playwright |
| **Part 1** Auth | One-time `/setup` wizard, sign-in/out, change password, forced password change, role middleware + permission matrix test, rate limiting, settings shell |
| **Part 2** Members | Invite codes (hashed, one-time, 7-day), Join screen, members list, admin password reset, offboarding (soft delete + instant session kill), scheduler + guest-expiry job, mDNS announce, Connect-to-Host screen, account settings |
| **Part 3** Projects, files, backups | Files pipeline (streamed upload, sha256, content check, thumbnails, Range), shared `<FileUploader>` + image/PDF/video previews, daily/manual/pre-migration backups with pruning, stale warning and a restore command, Host settings page, projects API (status flow, members, 6 default task statuses seeded), project files with member-only access, projects list / create flow with rich-text brief / overview page |
| Tests | 82 server + 66 web + 6 core unit/API tests, 6 Playwright end-to-end tests, all green |

**Small known gaps in finished work (do when convenient, none blocks the next step)**

| Gap | Where to fix | Suggested time |
|---|---|---|
| Cannot edit a project's brief/name/dates after creating it (API `PATCH /projects/:id` exists; no screen) | `pages/projects/` add an Edit dialog | Part 4, day 1 (30-60 min) |
| Project cover image and colour picker not in the UI | create flow + overview | Phase C, or earlier if wanted |
| A removed member's e-mail stays reserved (cannot re-invite the same address) | decide with the owner; either "restore member" or free the address | Before release |
| Previews load whole files into memory (large videos are slow) | add short-lived signed file URLs on the server | Part 5, with the desktop work |
| Restore is a command, not a button (Host must be stopped) | desktop shell can stop/start the server and offer a button | Step T below |
| Backups copy all files every time | incremental copy | Phase C |
| Offboarding "reassign open tasks" step | wire in Part 4 (see 4.8) | Part 4 |

---

## 4. What is LEFT — in the exact order to build it

Legend for each step: **Contract** (`packages/core`) · **DB** (`packages/db`) · **API** (`apps/server/src/routes`) · **UI** (`apps/web/src`) · **Tests** · **Done when**.

### PART 4 — Tasks, kanban, comments, notifications (about 2 weeks)

**Outcome (demo):** the manager assigns a task; the artist gets a live notification, sees it in *My tasks*, comments, moves it to *In progress*; the manager sees it change live.

**Permission rules for all of Part 4**
- Create/edit/delete tasks, set assignees, priority, due date: project **manager** or workspace admin.
- Assignees must be members of that project.
- An **artist** may change the status of a task assigned to them between *To do* and *In progress* (and *Changes requested* back to *In progress*). *In review* is set only by "Submit for review" (Part 5); *Approved* and *Done* only by a manager/admin.
- Any project member may read tasks and comment. Non-members get 404.

| Step | What to build | Details |
|---|---|---|
| **4.0** | Project edit dialog (gap above) | UI only: `pages/projects/EditProjectDialog.tsx` using `PATCH /projects/:id`; brief editor reused. |
| **4.1** | **Tasks API** | **Contract:** `core/tasks.ts` — `taskSchema` (id, projectId, statusId, title, description JSON, priority low/medium/high/urgent, dueAt, startAt, sortKey, createdBy, assignees[], subtaskCounts, fileCount), create/update requests. **DB:** `tasks`, `task_assignees`, `task_watchers`, `subtasks`, `task_files` (migration `0005_tasks`). **API:** `GET/POST /projects/:id/tasks`, `GET/PATCH/DELETE /tasks/:id`, `PUT /tasks/:id/assignees`, `GET/POST /tasks/:id/subtasks`, `PATCH/DELETE /subtasks/:id`, `GET/POST /tasks/:id/files` (attach already-uploaded files; reuse `canAccessFile` — extend it so members of the task's project can read task files), `GET /projects/:id/statuses`. Put status-rule logic in `apps/server/src/projects/taskRules.ts`. **Tests:** every role x every route, assignee-must-be-member, status rules, sort order. **Done when:** a manager can create, assign, edit and delete tasks via API and an artist cannot overstep. |
| **4.2** | **Task list + detail drawer** | **UI:** `pages/projects/tasks/TaskList.tsx` (a "Tasks" section on the project overview, grouped by status, sortable), `TaskDrawer.tsx` (slides in: title, description via `RichTextEditor`, assignees, priority, due date/time, subtasks checklist, files with the existing uploader/preview, status select limited by the rules). Inline edit with optimistic update. **Tests:** MSW page tests per role; one Playwright step. |
| **4.3** | **Kanban** | **UI:** `TaskBoard.tsx` — columns = the project's `task_statuses`; drag a card to another column (use `@dnd-kit/core`); optimistic move with rollback if the Host refuses; keyboard-accessible move menu as a fallback. `PATCH /tasks/:id` with `{statusId, sortKey}`. Tab switch List / Board on the overview. **Tests:** drag simulated; refusal rolls back. |
| **4.4** | **My tasks + review-queue queries** | **API:** `GET /me/tasks` (grouped Overdue / Today / This week / Later), `GET /me/review-queue` (tasks whose status kind is `review`, only for managers/admins, only their projects). **UI:** `/my-tasks` page + nav item; review-queue page can be a stub that Part 5 fills. |
| **4.5** | **Task history + comments + @mentions** | **DB:** `task_history`, `comments` (migration `0006`). **API:** `GET/POST /tasks/:id/comments`, `PATCH/DELETE /comments/:id` (author only; manager can delete), `GET /tasks/:id/history`. Every change (status, assignee, due date, priority, file added, comment) writes a `task_history` row **inside the same transaction** (helper `recordHistory(tx, ...)`). Mentions stored as user ids parsed from the comment's rich text. **UI:** comment box in the drawer with `@` autocomplete limited to project members; history timeline. |
| **4.6** | **Notifications** | **DB:** `notifications(id, userId, kind, data JSON, taskId?, projectId?, createdAt, readAt)`. **API:** `GET /notifications`, `POST /notifications/read`. Helper `notify(tx, userIds, kind, data)` called by 4.1/4.5 events: assigned, mentioned, commented, added to project (extend 3.5's add-member), status changed. **Real-time:** add `@fastify/websocket`; route `/events` authenticates with the bearer token (first message or `?token=`; never log it), keeps a map userId -> sockets, pushes `{type:'notification', ...}`. **UI:** `components/NotificationBell.tsx` in the app header (unread count, dropdown inbox, mark read, click opens the task). Add `/events` to the dev proxy (WebSocket). |
| **4.7** | **Live task updates** | Server broadcasts `{type:'task.changed', projectId, taskId}` to all members of that project over `/events`. Web `lib/events.ts`: one socket, auto-reconnect with back-off, on every reconnect refetch (resync), and invalidate the matching TanStack Query keys. "Reconnecting..." banner component (reused in Part 5). |
| **4.8** | **Offboarding wire-up** | `GET /members/:id/open-tasks`; the remove-member dialog gets the reassign step (pick a new assignee per task or "unassigned"); `POST /members/:id/remove` does reassign + remove + revoke **in one transaction**, writes `task_history`, notifies the new assignees. Guest-expiry job does the same automatically (tasks become unassigned, managers notified). Finishes open item 2.5. |

**Part 4 exit check (add as `e2e/smoke3-tasks.spec.ts`):** manager creates the task "Logo concepts" (High, due in 3 days) assigned to the artist; the artist's browser shows a bell notification without reloading; the artist opens *My tasks*, comments with @Manager, drags the card to *In progress*; the manager's board updates live; removing the artist prompts reassignment.

---

### STEP T — Desktop shell and installer spike (about 3-4 days) — do right after Part 4

This was left over from Week 0 and is the biggest technical risk, so do it **before** Part 5 piles on more features.

| # | What | Details |
|---|---|---|
| T.1 | **Sidecar spike** | Prove the Node server (with native modules `better-sqlite3` and `sharp`) starts when bundled inside a Tauri installer on a clean Windows PC. Decide: bundle Node + `node_modules`, or compile with `pkg`/SEA. Record the result as `docs/adr/0002-server-sidecar.md`. |
| T.2 | **Tauri shell** | `apps/desktop`: first-run screen "Be the Host / Connect to a Host"; Host mode starts/stops the server sidecar and restarts it if it crashes; client mode just loads the web app. Tray icon. |
| T.3 | **Discovery bridge** | Expose `window.whiteboardDesktop.discoverHosts()` (mDNS browse) so the Connect screen lists Hosts found on the network (the screen already supports it). |
| T.4 | **Restore button** | Because the shell can stop/start the server, add "Restore from backup" to Settings > Host: pick a backup, the shell stops the server, runs the same restore code, starts it again. |
| T.5 | **Signed file URLs** | Short-lived URLs for `/files/:id/content` so video streams with Range instead of loading fully. |

**Done when:** an installer built on CI installs on a clean PC, runs as a Host, a second PC finds it and signs in.

---

### PART 5 — Review flow, pins, desktop polish, release (about 2 weeks)

**Outcome (demo):** the full submit -> review -> approve loop, shipped as an installer. = the acceptance scenario in `PRODUCT_SPEC.md` section 13.

| Step | What to build | Details |
|---|---|---|
| **5.1** | **Deliverables + versions + submit for review** | **DB:** `deliverables`, `deliverable_versions` (state pending/changes/approved). **API:** `GET/POST /tasks/:id/deliverables`, `GET/POST /deliverables/:id/versions` (POST = submit: attaches an uploaded file, a note; sets the task to *In review*; notifies managers/watchers; history row). Only the assignee can submit; only when status allows. **UI:** "Deliverables" section in the task drawer: version list (uploader, date, note, state), submit dialog using the uploader. |
| **5.2** | **Reviews + review screen + review queue** | **DB:** `reviews`. **API:** `POST /versions/:id/reviews {decision: approve|changes, summary}`. Rules: managers/admins only; **nobody approves their own work**; approve -> version approved + task Approved/Done; changes -> version "changes" + task *Changes requested*; notify the artist; history row. **UI:** `pages/review/ReviewPage.tsx` (large preview, decision buttons, summary box) and the **Review queue** page (replaces the 4.4 stub). |
| **5.3** | **Version compare** | **API:** `GET /versions/compare?a=&b=` (both must be the same deliverable; returns file info for both). **UI:** side-by-side viewer for images and PDFs (synced zoom/scroll); image slider overlay is optional. |
| **5.4** | **Pins + pin comments** | **DB:** `pins` (version, page, x, y as fractions 0-1, optional video time), `pin_comments`. **API:** `GET/POST /versions/:id/pins`, `PATCH /pins/:id` (resolve/unresolve), `GET/POST /pins/:id/comments`. **UI:** click on the preview to drop a numbered pin, thread in a side panel, open/resolved filter; pins stay attached to the version they were made on. Artists resolve, managers reopen. |
| **5.5** | **Deadline watcher job** | Job `deadlines` every 15 minutes: tasks due within 24 h -> "due soon", past due -> "overdue", **deduplicated** (store what was already sent), with catch-up after Host downtime (the scheduler already does this). Test with a fake clock. |
| **5.6** | **Windows notifications, version check, reconnect banner** | Tauri notification plugin shows each notification once (when the app is open or in the tray); client compares its version with `/host/info` and shows "update needed" when incompatible; reuse the Reconnecting banner from 4.7 and make sure unsent comment drafts survive a reconnect. |
| **5.7** | **Auto-start + tray** | Start with Windows (Host PC especially), close-to-tray. |
| **5.8** | **Release workflow** | GitHub Actions: on a `v*` tag build the `.msi`, attach to the GitHub release; install-tested on a clean PC. |
| **5.9** | **Hocuspocus spike (2 days)** | Prove Yjs collaboration can run inside the Host server (de-risks Phase B). Write findings in `docs/adr/0003-realtime-boards.md`. No product code merged. |
| **5.10** | **ACCEPTANCE** | Turn spec section 13 (14 steps) into `e2e/acceptance.spec.ts`, green in CI; then run it **by hand on 3 real PCs** (1 Host + 2 clients); tag **`v0.1.0`**; install on the real Host PC; confirm daily backups for a week; restore once onto a spare PC. |

**Phase A is finished when:** section 13 passes automatically and by hand, `v0.1.0` is installed on the real Host, and the team runs one real project on it.

---

### PHASE B — Visual boards (about 6 weeks, after MVP is in real use)

Goal: each project gets a free-form canvas for moodboards, references and notes, with live editing by several people.

| Step | What to build |
|---|---|
| B1 | **Canvas engine** (pan, zoom, fit, select, multi-select, drag, resize, snap grid, 60 fps with 500 cards) in a new `packages/canvas`. |
| B2 | **Boards API**: `boards`, `board_items`, nesting (a board can hold boards) with breadcrumbs, one root board per project created on first visit (back-fill existing projects), trash + restore. |
| B3 | **Realtime**: Hocuspocus (Yjs) inside the Host server, persistence to SQLite, a "projector" that writes searchable rows, presence cursors, offline cache. |
| B4 | **Cards**: note, image, file, link (with preview fetch job and private-IP blocklist), column, line/arrow; undo/redo; context menus. |
| B5 | **Task cards**: drag a "Task" onto the board; the card and the list/kanban stay in sync both ways. |

Exit: two people edit one board live over the LAN; a task card moved on the board updates the kanban.

### PHASE C — v2 (about 6 weeks)

Calendar view and saved filters; full search (SQLite FTS5); dashboard and reporting (progress, overdue, workload, review turnaround); **Host hardening** (run the server as a Windows service so it works with nobody logged in, encrypted LAN traffic, in-app updates served by the Host); export (PDF/PNG/Word/Markdown/zip); full settings and board templates; more card types (table, document, heading, colour, comment); custom task statuses; per-user notification settings and a daily summary; incremental backups; project cover images.

### PHASE D — v3

Timeline/Gantt with dependencies, recurring tasks, time tracking, sketch / map / video / audio cards, `.ics` calendar export, optional e-mail through the company's own SMTP account.

**Deliberately never built (local app, no paid services):** plans and billing, client portal and public links, mobile app, web clipper, Slack/Google integrations.

---

## 5. Order and rough calendar (one developer, about 5 hours a day)

| When | Work |
|---|---|
| Day 3 (next session) | 4.0 project edit dialog, 4.1 Tasks API |
| Days 4-5 | 4.2 list + drawer, 4.3 kanban |
| Days 6-7 | 4.4 queries, 4.5 history + comments |
| Days 8-9 | 4.6 notifications + `/events`, 4.7 live updates |
| Day 10 | 4.8 offboarding wire-up, Part 4 e2e, PR |
| Days 11-14 | Step T (sidecar, Tauri shell, discovery, restore button, signed URLs) |
| Days 15-17 | 5.1 deliverables, 5.2 reviews |
| Days 18-19 | 5.3 compare, 5.4 pins |
| Days 20-21 | 5.5 deadlines, 5.6 desktop notifications / version check |
| Days 22-23 | 5.7 auto-start, 5.8 release workflow, 5.9 spike |
| Days 24-26 | 5.10 acceptance test, real-PC trial, tag `v0.1.0` |
| After | Use it for real for 1-2 weeks, collect feedback, then Phase B |

Re-plan after each part's demo; the estimates will move.

---

## 6. Decisions still needed from the owner

| # | Question | Needed by | Default if not answered |
|---|---|---|---|
| 1 | Which PC is the Host, and which drive holds backups? (an always-on PC + an external drive/NAS) | Step T | Use the developer PC; backups beside the data (not safe, only for testing) |
| 2 | Max upload size | Part 5 | 2 GB (changeable in Settings > Host) |
| 3 | Re-inviting a removed person's e-mail address | Before release | Add "restore member" later |
| 4 | Product logo, colours, font | Before release | Current neutral theme |
| 5 | Review rule: may a manager approve a task they created and also worked on? | 5.2 | No: nobody approves their own submitted work |

## 7. Risks to watch

| Risk | Why it matters | Handled by |
|---|---|---|
| Native modules (`better-sqlite3`, `sharp`) inside the installer | Could block the whole release | Step T spike before Part 5 |
| Data loss if the Host PC dies | The only copy of everything | Daily backups (done), stale warning (done), restore tested (done in tests), real restore drill in 5.10 |
| WebSocket reconnect losing work | Comments or drags lost during a Host restart | 4.7 resync + draft saving in 5.6 |
| Permission mistakes (someone sees a project they should not) | Freelancers must never see other projects | A test per role per route; 404 for non-members; matrix test extended every step |
| Scope creep into Phase B before the MVP is used | Delays real feedback | Finish `v0.1.0` and use it first |

---

## 8. How to resume tomorrow (3 steps)

1. Open this file and `PROGRESS.md` ("Resume here").
2. `git checkout develop && git pull`, then `git checkout -b feat/phase-a-tasks`.
3. Tell Claude: "start 4.0 and 4.1". It will explain what it builds, wait for your approval, then build, test, update `PROGRESS.md` and commit; push and PR only when you say so.
