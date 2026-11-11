# Whiteboard — Product & Technical Spec

> **Status:** v2 draft · **Date:** 2026-11-11
> **Sources:** (1) hands-on scan of the reference app (Milanote web app, free account, 3 passes) via browser automation; (2) the reference app's public help center for paid/team features; (3) our own design for everything the reference app doesn't have (marked **[OUR DESIGN]**).
> **Product name:** **Whiteboard** — a visual project-management app. Never reuse the reference app's name, logo or wording.
> **Team:** 1 backend developer + 1 frontend developer — work split in `EXECUTION_PLAN.md`.

## How to read this document
| Section | What it answers |
|---|---|
| §0 | Rules, product goal, users, glossary |
| §1 | What was scanned, coverage, what's left |
| §2–3 | Canvas/board features (observed in the reference app) |
| **§3B** | **Project management layer: projects, tasks, review & approval, roles [OUR DESIGN]** |
| §3C | Teams, plans & billing (from the reference app's public docs + our design) |
| §4–9 | How features connect, architecture, data model, pipelines, API, repo layout |
| §10 | Build roadmap (project-management first) |
| §11–12 | Deploy, security |
| §13 | End-to-end acceptance scenario (the "is it complete?" test) |
| §14 | Open decisions (need the owner's answers) |
| §15 | References |

---

## 0. Ground rules (clean-room)

This document records **what the reference app does** (observable behavior) so we can build **our own** product with equivalent functionality.

| ✅ Allowed | ❌ Not allowed |
|---|---|
| Re-implement features & workflows described here | Copying their code, bundles, CSS, API/protocol |
| Our own UI design, icons, illustrations, colors, fonts | Their logo, name, illustrations, icons, templates, onboarding copy |
| Our own templates, help text and marketing copy | Screenshots of their app in our product or marketing |

Every UI string, visual and template in our app must be written/designed from scratch.

### 0.1 Product goal
A **visual project-management app** for creative teams: a manager creates a project, puts the brief, instructions and files on a visual board, assigns work to approved artists/employees, and the work moves through **submit → review → feedback → approve** inside the app until the project is delivered. The free-form canvas (§3) is where briefs, references and moodboards live; the task & review layer (§3B) is what drives the project.

### 0.2 Users & roles
| Role | Who | Can do |
|---|---|---|
| **Workspace owner / admin** | Agency owner | Everything: billing, members, all projects, roles |
| **Manager** | Project lead | Create projects, write briefs, upload files, assign tasks, review, approve / request changes, invite people |
| **Artist / employee** | Approved team member or freelancer | See only projects they're added to, work on assigned tasks, upload deliverables, submit for review, comment |
| **Client** (optional) | External customer | View shared project/deliverables, comment, optionally approve |
| **Viewer / public link** | Anyone with link | Read-only view of a published board |

### 0.3 Glossary
| Term | Meaning |
|---|---|
| **Workspace** | A company/team account; holds members, projects, billing |
| **Project** | A unit of client work; has a brief, members, tasks, deadline and a root board |
| **Board** | A free-form canvas page; boards can contain boards (nesting) |
| **Card / item** | Anything placed on a board (note, image, file, task card, link…) |
| **Task** | A trackable piece of work with status, assignee, due date, deliverables (lives in the database; may also appear as a card on a board) |
| **Deliverable** | A file an artist submits for a task; has versions v1, v2… |
| **Review** | A manager's decision on a submitted version: Approve or Request changes, with feedback |
| **Pin comment** | Feedback attached to an exact spot on an image/PDF/video frame |

---

## 1. Scan summary

**Covered:** app shell, home board, board creation + template picker, Note, To-do, Link, Column, Line, Comment, Map, the "More" tool palette, contextual toolbars, card & canvas context menus, Share, Export, View/Presentation, Search, Notifications, Unsorted panel, account menu + plan meter, all 7 settings sections, onboarding tips.

**2nd pass (2026-11-11) covered:** Table (cells, formulas, cell types, row/column menu), Color swatch, Document editor, Heading, Sketch editor, Video, Audio, to-do due dates / reminders / assign / labels, reactions picker, Trash panel, element URLs, canvas auto-scroll at edges.

**3rd pass (2026-11-11) covered:** multi-select + align/connect, duplicate placement + sync prompt, posting a comment (thread UI), trash with items + restore, nested board creation + moving a card into a sub-board, breadcrumbs, search results, help menu, keyboard-shortcut reference (categories), presentation mode options, template gallery structure.

**Estimated coverage after 3 passes:** web UI surface ~90% · behaviors/edge cases ~55–60% · whole product (incl. mobile, clipper, desktop, multi-user) ~45%.

**Still not scanned:**
| Item | Why |
|---|---|
| Synced copies actually syncing | "Yes" click on the sync prompt didn't register |
| Draw tool on the canvas itself | Stroke didn't register via automation — check by hand |
| Image/file upload flow | Opens the OS file picker (automation can't drive it safely) |
| Published read-only link as a viewer | Needs publishing the board — not approved |
| Export output files | Needs a download — not approved |
| Copy/paste across boards, comment replies/@mentions, marquee selection | Not reached / marquee drag didn't select |
| Real-time multi-user behavior | Needs a second account |
| Card-quota limit behavior | Would need ~100 cards |
| Mobile app, web clipper, desktop-only features | Separate apps |
| Billing / checkout | Deliberately skipped (payment pages) |
| Team-plan admin screens | Needs a paid Team account — documented from public help center instead (§3C) |

### 1.1 Coverage verdict
- **Reference app (Milanote): not 100% scanned, and won't be.** Items above remain; paid/team screens were taken from public docs, not observed.
- **Our product: specified end to end.** Every part of the target workflow is defined — either observed in the reference app or designed by us (**[OUR DESIGN]**). The remaining gaps above are reference-app details; none of them blocks building. §13 is the end-to-end test that proves completeness.

---

## 2. Information architecture

```
App
├── Top bar
│   ├── Logo → Home
│   ├── Breadcrumbs (Home › Board › Sub-board …)
│   ├── Referral / upgrade CTA
│   ├── Undo / Redo
│   ├── Unsorted-on-mobile counter
│   ├── Help
│   ├── Search
│   ├── Notifications
│   └── Account menu (profile, settings, log out, plan usage meter, upgrade)
├── Board header (inside a board)
│   ├── Save status ("Saving…" / "Saved")
│   ├── Board title (centered, editable)
│   ├── Share · Export · View
├── Left tool rail (switches to a contextual toolbar when something is selected)
├── Canvas (the board)
├── Right panel: "Unsorted" inbox (toggle)
└── Settings modal (/account/*)
    ├── Account · Emails & notifications · Appearance
    ├── Preferences · Localization · Toolbar options · Privacy
```

**URL scheme observed (we design our own):** `/{workspaceId}/home`, `/{boardId}/{board-slug}`, `/account/{section}`.
Our version: `/w/:workspaceId`, `/b/:boardId/:slug`, `/settings/:section`, `/p/:publicToken` (published boards).

---

## 3. Feature catalog

Priority: **P0** = MVP, **P1** = v2, **P2** = v3.

### 3.1 Canvas (P0)
- Free-form 2D surface with a dot grid (grid on/off per board, default in preferences).
- Pan (drag background / scroll), zoom (ctrl/cmd + wheel, View menu slider with %, **Scale to fit**).
- Drag cards from the tool rail onto the canvas at drop position.
- Click to select, shift-click / marquee for multi-select, drag to move, corner handle to resize (width; height auto-grows with content).
- **Prevent overlap** (preference): when a card grows, nearby cards are pushed away.
- Optional "3D tilt" effect while dragging (preference — cosmetic, P2).
- **Double-click empty canvas creates a note** (preference).
- Undo / redo (ctrl+Z / ctrl+shift+Z) + optional on-screen arrows.
- Change board background (canvas context menu).
- Image/file placeholder card (reserve a spot to drop a file later).
- Autosave with visible status indicator.
- **Multi-select** (shift-click; marquee also expected): toolbar switches to Color, Reactions, **Align** (left / center / right / top / middle / bottom), **Connect** (draw lines between the selected cards), more.
- Nudge selected cards with arrow keys; shift while dragging constrains to right angles; hold space + drag to pan.

### 3.2 Card types

| Type | Behavior observed | Contextual toolbar | P |
|---|---|---|---|
| **Note** | Rich-text card, grows as you type | Text style, **B**, *I*, ~~S~~, U, bullet list, numbered list, indent, link, comment, more (inline code) | P0 |
| **To-do** | Checklist; Enter adds item; optional list title ("Add a title?" helper) | Color, Title toggle, Reactions, **Due date**, **Assign**, **Labels**, indent/outdent, comment | P0 |
| **Link** | Paste URL → fetches preview (title, description, image, domain) | Color, Labels, Reactions, Comment, Refresh/Edit, Caption | P0 |
| **Board** | Card that opens a nested board; shows icon + name + card count | Color, Icon, Rename, more | P0 |
| **Column** | Titled vertical container; cards dropped in stack automatically; shows "N cards" | Color, Collapse, more | P0 |
| **Line / Arrow** | Free line; each end can **attach to a card** and follows it when the card moves | Color, Start cap, End cap, Label, Dashed, Weight | P0 |
| **Comment** | Floating, resizable comment thread. Empty: avatar + input + Send. Posted: avatar, author name, relative time ("just now"), body, **Edit**, **Reply**; @mentions | — | P1 |
| **Image** | Upload / drag-drop / paste image | Color, Caption, Comment, Crop?, Download | P0 |
| **File** | Upload any file; preview + download | — | P0 |
| **Table** | Spreadsheet grid (A/B/C columns, numbered rows, shaded header row); `=` formulas (e.g. SUM over a range) recalc live; Enter moves down. See §3.2.3 | Card: Labels, Reactions, Comment, Title, Caption. Cell: Text style, Cell type, Color, Formula, Alignment, Add column, Add row | P1 |
| **Heading** | Large serif text label with no card background — section titles on a board | Text-formatting toolbar | P1 |
| **Color swatch** | Colored block showing the code (e.g. hex) + an auto-generated color name below | Color, Labels, Reactions, Comment, Display (HEX / RGB / HSL / Off), Caption | P1 |
| **Document** | Card shows doc icon + title + word count; opens a centered full-height editor at its own URL. See §3.2.4 | Card: Color, Card view, Rename | P1 |
| **Sketch** | Resizable card ("double-click to draw") that opens a modal drawing editor. See §3.2.5 | — | P2 |
| **Draw** (tool) | Freehand ink directly on the canvas; optional pressure/speed "ink effect" *(not verified)* | — | P2 |
| **Map** | Paste a Google Maps link → interactive map embed | — | P2 |
| **Video** | Paste a YouTube or Vimeo link → embedded player | — | P2 |
| **Audio** | Paste a Spotify or SoundCloud link → embedded player | — | P2 |

**Shared card behaviors:** color, reactions, comment thread attached to a card, labels, "created by / time" metadata, lock position, z-order.

#### Note text styles (P0)
Large heading, normal heading, normal text, small text, code block, callout, quote block, 6 text colors, 6 highlight colors — each with a keyboard shortcut.

#### 3.2.2 To-do details (P1)
- Each item can get a **due date**: month calendar with today highlighted, optional **due time**, and a **reminder** (default: morning of the due day). Set date shows as a chip under the item.
- **Assign** an item: searchable list of people with access to the board → chip under the item → notification + email to the assignee.
- **Labels**: type a name to create a label; reuse across cards (workspace-wide).
- **Reactions** (any card): emoji picker with category tabs (frequently used, smileys, people, nature, food, travel, activities, objects, symbols, flags), skin-tone choice, search.

#### 3.2.3 Table details (P1)
- Cell types: Auto, Number, Currency, Percentage, Text, Date & time, Checkbox (number/currency/date formats follow Localization settings).
- Formulas start with `=`; standard spreadsheet functions and A1 ranges.
- Cell right-click menu: Cut, Copy, Paste, Paste values, Add row above/below, Add column left/right, Clear cell, Delete row, Delete column (with shortcuts).
- Cell styling: text style, background color, alignment.

#### 3.2.4 Document editor (P1)
- Opens as a centered page over the board; URL `/e/{elementId}` (deep-linkable).
- Toolbar: text style, Insert (emoji, divider line, link to a board, @mention), bold, italic, bullet/numbered lists, indent/outdent, alignment, link, comment, more.
- Own **Export**: PDF, Word, Markdown, plain text.

#### 3.2.5 Sketch editor (P2)
- Modal white drawing canvas with a bottom toolbar: Pen, Select, Eraser, Color, Brush size (4 sizes), Undo, Redo, Discard/Cancel, Save.
- Color picker: ~15 preset colors, recently used colors, custom color.
- Saved strokes render inside the sketch card on the board.

#### Canvas extras
- Dragging a card near the viewport edge **auto-scrolls** the canvas.
- Opened elements (documents, sketches) get their own URL `/e/{elementId}`.

#### Smart helpers (preference-controlled, P1)
- On duplicate → offer **"keep copies in sync"** (linked/mirrored cards). Observed: ctrl+D on a card inside a column inserts the copy directly below it in the same column (count updates) and shows an inline Yes / No thanks prompt on the copy.
- Note too long → offer **convert to Document**.
- Multiple to-dos → offer **add a list title**.
- Items checked off → offer **delete completed tasks**.

### 3.3 Context menus (P0)
**Card:** Cut, Copy, Duplicate, Move to board ›, Move to trash, Add image, Copy link address, Lock position, Bring to front, Send to back, created-by footer.
**Canvas:** Undo, Select all, New *(note, link, to-do, line, board, comment, column, table)*, Change board background ›, New image/file placeholder.

### 3.4 Tool rail customization (P1)
Settings → Toolbar options: users choose which tools appear in the main rail (when space allows); upload/image/draw pinned at the bottom; "reset to default".

### 3.5 New-board template picker (P1)
When a board is first opened, a floating picker (bottom-right) offers an empty board, a short list of featured starter templates and "more templates". The full gallery is a **searchable list of categories, each with a template count**, drilling into templates; "Keep example content" checkbox; Continue / close. **We author our own templates and categories.**

### 3.6 Unsorted inbox (P1)
Right-side panel holding items captured from mobile / web clipper / email that haven't been placed on a board yet; drag items from it onto any board. Counter shown in the top bar. Each board has its own Unsorted panel.

**Moving cards into a sub-board (observed):** dragging a card onto a board card highlights the board card; on drop the card disappears from the current board and appears in the **child board's Unsorted panel** (not on its canvas). The board card's count and thumbnail preview update. Also available: card menu → Move to board. Shortcut exists to send a card to Unsorted.

**Breadcrumbs:** Home › Parent › Child, each crumb with the board's color chip; each board has its own URL `/{boardId}/{slug}`.

### 3.7 Sharing (P1)
- **Editors:** invite by email (with send), or toggle an "invite editors with link" URL; notify-me-on-edit toggle.
- **Read-only published link:** toggle on/off, copy link; options: allow comments/reactions/drawing, show download links on files, welcome message, password protection, embed (HTML iframe code); viewer count.
- Viewers need no account for read-only links.

### 3.8 Export (P1)
- Current board layout → PDF (standard / high quality), PNG.
- Convert to linear document (optional include sub-boards) → Word (.docx), Markdown, plain text.
- Download all images & files on the board (zip).

### 3.9 View (P0/P1)
Zoom slider + %, Scale to fit (P0). **Presentation mode** (P1): started from View menu or shortcut; hides tool rail, grid, Share/Export; options: **Focus on selected cards** (default on), **Hide comments**, **Prevent editing**; "Stop presenting" / Esc.

### 3.10 Search (P0 basic, P1 full)
Global search box; filters (last viewed, shared with); "recently viewed" list showing board path + card count.
Results (observed): result count; grouped **by board** (board icon, name, path, contents summary such as "1 board, 11 cards and 1 doc"), with matching card snippets underneath and the search term highlighted. Search state is reflected in the URL (`?filter_context=search`).

### 3.11 Notifications (P1)
In-app bell for activity on shared boards (edits, comments, mentions, assignments).
Channels per event (desktop push / email): invited to board, mentioned, assigned a task, comment on a shared board, task reminders, daily change summary, product news.

### 3.12 Account & settings
| Section | Contents | P |
|---|---|---|
| Account | Name, email (change), password (reset), avatar, delete account | P0 |
| Emails & notifications | Matrix above + enable desktop notifications | P1 |
| Appearance | UI size S/M/L (with shortcut), heading font toggle, light/dark, match system theme | P0 (theme), P1 (size) |
| Preferences | Prevent overlap, drag 3D effect, grid default, template suggestions, helpers ×4, ink effect, double-click to create note, show undo/redo arrows | P1 |
| Localization | Language, number/date format, currency, 12h/24h time | P1 |
| Toolbar options | Choose rail tools | P1 |
| Privacy | Share viewing history with publishers of published boards; cookie preferences | P1 |

### 3.13 Plans & limits (P2)
Free plan with a card quota (usage meter in account menu), upgrade CTA, referral program for extra quota. Paid plan = unlimited.

### 3.14 Trash (P0)
Deleted cards (Delete/Backspace or card menu → Move to trash) go to a trash panel opened from the bottom of the tool rail. Panel groups cards by date ("Today", …) with live card previews, shows "nothing older" at the end, and has an **Empty trash** button. **Restore = drag a card out of the panel onto the canvas** (lands where dropped). Empty state shows an illustration.

### 3.15 Help & keyboard shortcuts (P1)
Help menu (top bar "?"): help center, contact support, keyboard shortcuts, what's new (changelog).
Shortcut reference is a modal with categories: Essentials, Basics, Text formatting, Markdown (typed syntax auto-formats), To-do lists, Drawing, Navigation, Appearance, Zoom.

**Our keymap (P1 — define our own, conventions shown):**
| Action | Binding |
|---|---|
| New note | double-click canvas |
| Add another card of the same kind / next card | Ctrl+Enter |
| Pan | Space + drag |
| Constrain drag to axis | Shift + drag |
| Nudge | Arrow keys |
| Search | Ctrl+F |
| Delete | Delete / Backspace |
| Send to Unsorted | Alt + key |
| Presentation mode | Ctrl+Alt+P |
| Mention | @ while typing |
| Open board in new tab / window | Ctrl + double-click / Ctrl+Alt+click |
| Color eyedropper | I |
| Cut / Copy / Paste / Duplicate / Undo / Redo | Ctrl+X / C / V / D / Z / Shift+Z |

### 3.16 Onboarding (P1)
First-use tip popover per card type (illustration + one-liner, dismissible, shown once per user). **Write our own copy & art.**

---

## 3B. Project management layer [OUR DESIGN]

The reference app only has checklist to-dos inside cards. Everything in this section is our own design and is the core of the product.

### 3B.1 Projects (P0)
- Create project: name, client (optional), description, **brief** (rich text), **instructions**, start date, **deadline**, budget (optional), cover image, color.
- Attach **reference files** (any type, multiple) and links.
- Each project gets a **root board** (canvas) for moodboards, references and notes, created from a project template. **Phase A: projects have no board** — `projects.root_board_id` stays NULL and the UI shows no board tab. **Phase B** creates the root board on demand (first visit) and back-fills existing projects.
- Members: add people with a role (Manager, Artist, Client). Artists see only their projects.
- Project status: `Planning → Active → On hold → Completed → Archived`.
- Project overview page: brief, deadline countdown, progress % (done tasks / total), members, recent activity, files.

### 3B.2 Tasks (P0)
- Fields: title, description/instructions, **assignee(s)**, **due date + time**, **priority** (Low / Medium / High / Urgent), labels, **subtasks** (checklist), attachments, estimate (P2), watchers.
- A task can be **placed on a board as a card**; the card and every list view show the same live task.
- Created from: project page, kanban column, board (drag "Task" tool), or converting a to-do item.

### 3B.3 Review & approval workflow (P0)
```
To do → In progress → Submitted for review → (Changes requested ↺ In progress) → Approved → Done
```
| Step | Who | What happens |
|---|---|---|
| Assign | Manager | Artist notified (in-app + email) |
| Start | Artist | Status → In progress |
| Ask questions | Artist / Manager | Task comments, @mentions |
| Submit | Artist | Uploads deliverable(s) → new **version** (v1, v2…) + note → status **Submitted for review**; manager notified |
| Review | Manager (or Client if enabled) | Views version, adds **pin comments** on the image/PDF/video, then **Approve** or **Request changes** (with summary) |
| Revise | Artist | Sees open pins, fixes, marks pins **resolved**, uploads next version → resubmits |
| Approve | Manager | Version marked **Approved**, task → Approved/Done; approval recorded (who, when, which version) |

Rules: only Manager/Owner (or Client if "client approval" is on) can approve; artists can't approve their own work; every decision is kept in the task's **history**.

### 3B.4 Deliverables & versions (P0)
- Version list per task with uploader, date, note, status (Pending / Changes requested / Approved).
- Preview images, PDFs, video, audio in-app; download originals.
- **Compare** two versions side by side (**P0** — needed for §13 step 10); slider overlay for images (P2).

### 3B.5 Pin feedback (P0)
- Click on an image/PDF page (or video timestamp, P1) to drop a numbered pin with a comment thread.
- Pins carry over to the version they were made on; open/resolved state; filter open pins.

### 3B.6 Views of tasks (P0 → P1)
| View | P | Notes |
|---|---|---|
| **List / table** | P0 | Sort, group by status/assignee/due, inline edit |
| **Kanban** | P0 | Columns = statuses (per project, customizable P1); drag to change status |
| **My tasks** | P0 | Everything assigned to me across projects: Overdue / Today / This week / Later |
| **Review queue** | P0 | For managers: everything "Submitted for review" |
| **Calendar** | P1 | Tasks & deadlines by due date; drag to reschedule |
| **Timeline / Gantt** | P2 | Bars by start–due, dependencies |
| **Canvas** | P0 | Task cards on the project board |

### 3B.7 Notifications for the workflow (P0)
Assigned · due soon (24 h) · overdue · submitted for review · changes requested · approved · new comment / @mention · added to project. Channels: in-app, email, desktop push (P1); per-user settings (see §3.11).

### 3B.8 Dashboard & reporting (P1)
Per project: progress, overdue tasks, tasks per status, review turnaround time. Workspace: active projects, workload per person, upcoming deadlines.

### 3B.9 Later (P2)
Dependencies, recurring tasks, time tracking, custom fields, automations, client portal, Slack/Google Calendar integrations.

---

## 3C. Teams, plans & billing

### 3C.1 What the reference app has (from its public help center — not observed)
- **Free plan:** all features, capped at **100 cards**, smaller upload limit. No separate trial.
- **Pro (individual):** unlimited cards, larger uploads; monthly/annual billing; cancel, downgrade, pause; invoices & VAT; in-app-store subscriptions on iOS.
- **Team plan:** a single **Admin** (the person who upgraded) who adds/removes members, manages payment details, payment history, plan type and billing cycle. Admin change requires contacting support. **Boards stay owned by their creator**, not the team. Mixed sharing when only some people are on paid plans. Enterprise plan on request.
- **Collaboration (all plans):** share boards, real-time editing, comments, @mentions, notifications, see who has access, remove editors, **transfer board ownership**.

### 3C.2 Our design [OUR DESIGN]
- **Workspace owns all projects** (not individual users) — no lost work when someone leaves.
- Multiple admins; roles from §0.2; per-project membership.
- Invite by email or invite link; pending invites list; resend/revoke.
- **Offboarding:** remove member → their tasks reassigned (prompt) → access revoked immediately.
- Ownership transfer of workspace and of projects.
- Plans (P2): Free (limits on projects/storage), Pro (per-seat), Business (SSO, audit log). Stripe Checkout + Customer Portal; invoices; seat-based billing; downgrade rules (read-only above limits).
- Storage quotas per plan; upload size limit per plan.

---

## 4. How the features connect

```
User ─┬─ Workspace ─── Home board
      │                   └── Board (tree: boards contain board-cards → child boards)
      │                          ├── Cards (note, todo, link, image, file, column, table, …)
      │                          │     ├── Column ⟶ ordered child cards
      │                          │     ├── To-do items ⟶ due date ⟶ Reminder job ⟶ Notification
      │                          │     ├── Assignee ⟶ Notification
      │                          │     ├── Comment thread ⟶ @mention ⟶ Notification
      │                          │     ├── Reactions, labels
      │                          │     └── Synced copies ⟶ shared source card
      │                          ├── Lines ⟶ (fromCardId?, toCardId?) — follow card positions
      │                          ├── Shares (editors, invite link, public link + options)
      │                          └── Activity log ⟶ daily digest email
      ├── Unsorted inbox ⟵ mobile / web clipper / email-in
      ├── Settings & preferences
      └── Plan + usage quota
```

Key coupling rules:
- Moving/resizing a card must update attached lines in the same frame.
- Dropping a card into a column changes its parent from board → column (ordered list), not x/y.
- Board card's "N cards" count = live count of the child board's items.
- Every mutation → collaborative doc → persisted → activity log → (notifications, digest, search index).

---

## 5. Architecture & stack

```
┌────────────── Clients ──────────────┐
│ Web (React+Vite)  Desktop (Tauri 2) │  Mobile (Expo, P2)  Web clipper (P2)
└───────┬─────────────────┬───────────┘
        │ HTTPS (REST/tRPC)│ WebSocket (Yjs sync)
┌───────▼───────┐  ┌──────▼─────────┐
│  API service  │  │ Collab service │  Hocuspocus (Yjs)
│  Fastify (TS) │  │  + Redis pubsub│
└───┬───┬───┬───┘  └──────┬─────────┘
    │   │   │             │ snapshots
    │   │   └──► Postgres ◄┘ (Drizzle)
    │   └──────► Cloudflare R2 (files, thumbnails)
    └──────────► Job queue (BullMQ on Redis): unfurl, thumbnails, export, reminders, emails, search index
```

| Layer | Choice |
|---|---|
| Language | TypeScript everywhere |
| Monorepo | pnpm workspaces + Turborepo |
| Web UI | React 19, Vite, Zustand (UI state), TanStack Query (REST data) |
| Canvas | DOM cards absolutely positioned inside a CSS-transformed world layer; SVG overlay for lines; virtualization for 1k+ cards |
| Rich text | TipTap (ProseMirror) + y-prosemirror |
| Realtime / offline | Yjs CRDT, Hocuspocus server, y-indexeddb client cache |
| Drawing | perfect-freehand (ink strokes), stored as stroke JSON in the card |
| Tables | Own grid UI (TanStack Table for model) + `fast-formula-parser` (MIT) for `=` formulas |
| Emoji picker | `emoji-mart` (MIT) for reactions and document insert |
| Embeds | oEmbed for YouTube / Vimeo / Spotify / SoundCloud; Google Maps embed URL |
| API | Fastify + Zod validation (or tRPC) |
| DB | PostgreSQL 16 + Drizzle ORM; Postgres FTS (P0), Meilisearch (P1 if needed) |
| Jobs | BullMQ + Redis |
| Files | Cloudflare R2 (S3 API), presigned uploads, `sharp` thumbnails |
| Link previews | Server-side Open Graph / oEmbed fetcher (SSRF-safe) |
| Export | Playwright (headless Chromium) → PDF/PNG; `docx` lib → Word; custom → Markdown/text |
| Auth | Better Auth (email+password, magic link, Google) |
| Email | Resend (transactional + digest) |
| Desktop | Tauri 2 (WebView2 on Windows), updater plugin, deep links |
| Mobile (P2) | Expo / React Native sharing `packages/core` |
| Payments (P2) | Stripe Billing |
| Observability | Sentry, PostHog, OpenTelemetry → Grafana Cloud |
| Tests | Vitest, Playwright E2E |

---

## 6. Data model (Postgres)

```sql
users(id, email UNIQUE, name, avatar_url, created_at)
workspaces(id, name, owner_id, plan, card_quota)
memberships(workspace_id, user_id, role,                 -- owner|admin|member|guest
            expires_at NULL,                              -- guests (freelancers) only; access ends automatically
            removed_at NULL, removed_by NULL)             -- offboarding (soft delete, keeps history)
boards(id, workspace_id, parent_board_id NULL, title, icon, color,
       background, grid_enabled, ydoc BYTEA, updated_at)
items(id, board_id, parent_item_id NULL,                  -- parent = column
      type, x, y, w, h, z, sort_key, locked,
      content JSONB, color, created_by, created_at, updated_at, deleted_at)
lines(id, board_id, from_item_id NULL, to_item_id NULL,
      x1,y1,x2,y2, start_cap, end_cap, label, dashed, weight, color)
todo_items(id, item_id, text, done, due_at, assignee_id, sort_key)
labels(id, workspace_id, name, color);  item_labels(item_id, label_id)
reactions(item_id, user_id, emoji)
comments(id, item_id NULL, board_id NULL, task_id NULL,   -- exactly one of item_id / task_id is set
         author_id, body, parent_id, created_at, edited_at)
files(id, workspace_id, r2_key, mime, size, width, height, thumb_key)
link_previews(url_hash PK, url, title, description, image_key, fetched_at)
shares(id, board_id, kind, token, role, password_hash, allow_comments,
       allow_downloads, welcome_message, created_by)
inbox_items(id, user_id, payload JSONB, source, created_at)   -- Unsorted
activity(id, board_id, actor_id, verb, item_id, at)
notifications(id, user_id, kind, payload JSONB, read_at, created_at)
user_settings(user_id PK, prefs JSONB)                        -- appearance, prefs, locale, toolbar, notif matrix

-- Project management layer [OUR DESIGN]
projects(id, workspace_id, name, client_name, brief JSONB, instructions JSONB,
         status, start_date, deadline, budget, color, cover_file_id,
         root_board_id, created_by, created_at, archived_at)
project_members(project_id, user_id, role)                   -- manager|artist|client
task_statuses(id, project_id, name, kind, sort_key)          -- kind: todo|doing|review|changes|approved|done
tasks(id, project_id, status_id, title, description JSONB, priority,
      start_at, due_at, estimate_min, created_by, sort_key,
      board_item_id NULL, created_at, updated_at, completed_at)
task_assignees(task_id, user_id)
task_watchers(task_id, user_id)
subtasks(id, task_id, title, done, sort_key)
project_files(project_id, file_id, kind, added_by, added_at) -- kind: reference|brief|other
task_files(task_id, file_id)                                  -- task attachments
deliverables(id, task_id, title)
deliverable_versions(id, deliverable_id, version_no, file_id, note,
                     submitted_by, submitted_at, state)       -- pending|changes|approved
reviews(id, version_id, reviewer_id, decision, summary, created_at)
pins(id, version_id, page, x, y, t_ms NULL, author_id, resolved_at)
pin_comments(id, pin_id, author_id, body, created_at)
task_history(id, task_id, actor_id, event, data JSONB, at)
invites(id, workspace_id, project_id NULL, email, role, token, expires_at, accepted_at)
```

Roles: workspace level in `memberships.role` (`owner|admin|member|guest`); project level in `project_members.role` (`manager|artist|client`). Staff = `member`, freelancers = `guest`.

Default statuses: every new project is seeded with six `task_statuses` (one per `kind`). Custom statuses are P1 but the table supports them from day one.

**`items.content` shape per type (JSON):** note/heading/document → ProseMirror JSON (Yjs-backed) · table → `{ cols, rows, cells: { "A2": { v, f?, type, fmt?, bg?, align? } } }` · sketch → `{ strokes: [{ points, color, size }] }` · swatch → `{ color, display: "hex|rgb|hsl|off", name }` · link/video/audio/map → `{ url, previewId?, embed? }`.

**Source of truth:** the Yjs doc per board (`boards.ydoc`). A debounced projector writes `items`/`lines`/`todo_items` rows for search, counts, notifications, exports and quotas.

---

## 7. Pipelines

1. **Edit → sync:** client mutates Y.Doc → y-indexeddb (offline) → WebSocket → Hocuspocus → Redis fan-out to other editors → debounced snapshot to Postgres → projector updates rows → `activity` row.
2. **Upload:** client requests presigned URL → PUT to R2 → `files` row → job: thumbnail + dimensions → card updated.
3. **Link unfurl:** URL pasted → API enqueues fetch (cache by URL hash, timeout, private-IP blocklist) → store preview + image in R2 → card updated.
4. **Notifications:** activity verbs (mention, assign, comment, invite) → notification rows → in-app bell (WS push) + email per user's channel matrix.
5. **Reminders:** due date set → delayed BullMQ job → notification + email.
6. **Daily digest:** cron → group yesterday's activity on shared boards per user → email.
7. **Export:** job renders board in headless Chromium (PDF/PNG) or walks the tree (docx/md/txt, optional sub-boards) → zip to R2 → signed download link.
8. **Search index:** projector updates `tsvector` columns on items/boards.
9. **Quota:** card count per workspace checked on create (free plan).
10. **Review flow [OUR DESIGN]:** artist uploads → `deliverable_versions` row (state pending) → task status → review → notify managers/watchers → manager creates `reviews` row → decision updates version state + task status → notify artist → `task_history` row.
11. **Deadline watcher:** cron every 15 min → tasks due in 24 h / overdue → notifications (deduplicated).
12. **Invites:** create invite → email with token link → accept → membership + project membership → notify inviter.
13. **Offboarding:** admin removes member → API returns their open tasks → admin picks a new assignee per task (or "unassigned") → in one transaction: tasks reassigned, `project_members` rows deleted, `memberships.removed_at` set, sessions revoked → reassigned people notified → `task_history` rows.
14. **Guest expiry:** daily cron → guests with `expires_at` < now go through the offboarding steps automatically (open tasks become unassigned, managers notified).

---

## 8. API surface (ours)

```
POST   /auth/*                       (Better Auth)
GET    /me                           PATCH /me/settings
GET    /workspaces/:id/home
POST   /boards                       GET/PATCH/DELETE /boards/:id
GET    /boards/:id/children          POST /boards/:id/duplicate
POST   /boards/:id/move              (re-parent)
WS     /collab?board=:id             (Yjs)
POST   /files/presign                POST /files/:id/complete
POST   /unfurl                       { url }
GET    /search?q=&filter=
GET    /notifications                POST /notifications/read
POST   /boards/:id/shares            PATCH/DELETE /shares/:id
GET    /p/:token                     (public read-only board, optional password)
POST   /boards/:id/export            { format, includeSubBoards }
GET    /inbox                        POST /inbox  (clipper/mobile)
GET    /trash                        POST /trash/:itemId/restore

# Workspace members & offboarding [OUR DESIGN]
GET                /workspaces/:id/members                       (list, with role and expiry)
PATCH              /workspaces/:id/members/:userId               { role, expiresAt }
GET                /workspaces/:id/members/:userId/open-tasks    (for the reassignment step)
POST               /workspaces/:id/members/:userId/remove        { reassign: [{ taskId, toUserId|null }] }
GET/POST           /invites                POST /invites/:token/accept   DELETE /invites/:id (revoke)

# Project management [OUR DESIGN]
GET/POST           /projects               GET/PATCH/DELETE /projects/:id
GET/POST           /projects/:id/members   PATCH/DELETE /projects/:id/members/:userId
GET/POST           /projects/:id/files     DELETE /projects/:id/files/:fileId
GET/POST           /projects/:id/statuses  PATCH/DELETE /statuses/:id   (custom statuses P1)
GET/POST           /projects/:id/tasks     GET/PATCH/DELETE /tasks/:id
PUT                /tasks/:id/assignees    { userIds }
GET/POST           /tasks/:id/subtasks     PATCH/DELETE /subtasks/:id
GET/POST           /tasks/:id/files        DELETE /tasks/:id/files/:fileId
GET/POST           /tasks/:id/comments     PATCH/DELETE /comments/:id
GET                /me/tasks               GET /me/review-queue
GET/POST           /tasks/:id/deliverables
GET/POST           /deliverables/:id/versions          (POST = submit for review)
GET                /versions/compare?a=:id&b=:id       (side-by-side data)
POST               /versions/:id/reviews               { decision: approve|changes, summary }
GET/POST           /versions/:id/pins      PATCH /pins/:id (resolve)
GET/POST           /pins/:id/comments
GET                /tasks/:id/history
WS                 /events                             (in-app notifications & live task updates)
```

---

## 9. Repository layout

```
/apps
  web/        React + Vite
  desktop/    Tauri 2 shell (loads web build; native menus, deep links, updater)
  api/        Fastify REST + jobs
  collab/     Hocuspocus server
  mobile/     Expo (P2)
  clipper/    Browser extension (P2)
/packages
  core/       domain types, Yjs schema, geometry, card registry
  canvas/     canvas engine (pan/zoom, selection, drag, lines, overlap push)
  editor/     TipTap config + extensions
  ui/         our design system (tokens, components, icons)
  db/         Drizzle schema + migrations
  config/     eslint, tsconfig, tailwind preset
/infra        Dockerfiles, fly.toml, GitHub Actions
```

---

## 10. Build roadmap (brick by brick)

Project-management first: the workflow in §13 must work end to end by the end of **Phase A**.

**Phase A — MVP: the manager ⇄ artist workflow**
| # | Brick | Done when |
|---|---|---|
| 1 | Monorepo, CI, design tokens, auth, DB | Sign up/login works; CI green |
| 2 | Workspaces, roles, invites, member list, offboarding, guest expiry | Owner invites a staff member and a freelancer; roles enforced; removing a member reassigns their tasks and revokes access; expired guests lose access automatically |
| 3 | Projects (create, brief, files, members, status) | Manager creates a project with brief + files; artist sees only their projects |
| 4 | Files pipeline (R2 upload, previews, download) | Upload/preview images, PDFs, video |
| 5 | Tasks + list view + My tasks | Create/assign/edit tasks; artist sees My tasks |
| 6 | Kanban view + statuses | Drag between statuses; status rules enforced |
| 7 | Deliverables + versions + submit for review | Artist submits v1; manager sees it in Review queue |
| 8 | Reviews + pin feedback + side-by-side version compare | Approve / Request changes with pins; artist resolves pins, submits v2; manager compares v1/v2 |
| 9 | Task comments, @mentions, task history, in-app notifications (bell + WebSocket) | Full audit trail per task; in-app notification for every §3B.7 event |
| 10 | Email notifications + deadline watcher | Every §3B.7 event emails once (per user settings); due-soon and overdue alerts fire |

**Phase B — Visual boards**
| # | Brick | Done when |
|---|---|---|
| 11 | Canvas engine | Pan, zoom, fit, select, multi-select, drag, resize, grid, 60 fps @ 500 cards |
| 12 | Note, image, file, link, column, line cards | §3.2 P0 rows |
| 13 | Task cards on the board | Card ↔ task stay in sync with list/kanban |
| 14 | Persistence, undo/redo, nesting, breadcrumbs, trash, context menus | §3.1, §3.3, §3.6, §3.14 |
| 15 | Realtime collaboration (Yjs) | 2+ users live, presence cursors, no conflicts |

**Phase C — v2**
| # | Brick | Done when |
|---|---|---|
| 16 | Calendar view, filters, saved views, search | §3B.6, §3.10 |
| 17 | Dashboard & reporting | §3B.8 |
| 18 | Sharing: client access, public links | §3.7, client role |
| 19 | Desktop app (Tauri) | Installer, auto-update |
| 20 | Settings (all sections), templates, export | §3.8, §3.12 |
| 21 | Table, Document, Heading, Color, Comment cards | §3.2 P1 rows |

**Phase D — v3**
| # | Brick |
|---|---|
| 22 | Plans, quotas, Stripe billing (§3C.2) |
| 23 | Timeline/Gantt, dependencies, recurring tasks, time tracking |
| 24 | Sketch/Draw, Map, Video, Audio cards |
| 25 | Integrations (Slack, Google Calendar), mobile app, web clipper |

---

## 11. Deploy plan

| Component | Host |
|---|---|
| Web (static) | Cloudflare Pages |
| API + jobs | Fly.io (Docker, 2+ machines, autoscale) |
| Collab (WebSocket) | Fly.io (sticky sessions per board, Redis fan-out) |
| Postgres | Neon (branching for previews) or Supabase |
| Redis | Upstash |
| Files | Cloudflare R2 + CDN custom domain |
| Email | Resend |
| DNS / WAF / rate limiting | Cloudflare |
| Desktop releases | GitHub Releases or R2 + Tauri updater manifest |

**Environments:** local (Docker Compose: Postgres, Redis, MinIO, Mailpit) → preview (per PR) → staging → production.

**CI/CD (GitHub Actions):**
1. PR: install → lint → typecheck → unit tests → build → Playwright E2E against preview → preview deploy (Pages + Neon branch).
2. Merge to `develop`: Drizzle migrations on staging → deploy staging → smoke tests.
3. Release PR `develop` → `main`, tagged `v*`: migrations on production → promote to production → Sentry release + sourcemaps → desktop matrix build (win/mac/linux) → code-sign (Windows: Azure Trusted Signing; macOS: Developer ID + notarization) → publish updater manifest.
4. Health checks; automatic rollback to previous Fly release on failure.

**Backups & DR:** Neon PITR (7–30 days), nightly logical dump to R2, R2 versioning on file bucket.

---

## 12. Security & quality checklist
- Row-level authorization on every board/item access (membership or share token).
- SSRF protection in unfurl/export (block private IP ranges, timeouts, size limits).
- Presigned URLs short-lived; validate MIME & size; virus scan (P1).
- Rate limiting on auth, unfurl, invites, public links.
- Passwords on public links hashed (argon2).
- CSP, secure cookies, CSRF protection.
- Accessibility: keyboard navigation of cards, focus rings, ARIA on toolbar.
- Performance budgets: first board render < 1.5 s, 60 fps pan/zoom at 1,000 cards.
- Role checks on every task/review endpoint (artists can't approve; clients only see shared projects).
- Uploads: max size per plan, allowed types, virus scan before preview (P1).
- Data protection: per-workspace data isolation, delete-account & export-my-data (GDPR), audit log (P2).

---

## 13. End-to-end acceptance scenario (definition of "complete")

The MVP is complete when this runs without errors as an automated Playwright test **and** by hand:

1. **Owner** signs up, creates workspace "Studio", invites **Manager** and **Artist** by email.
2. Both accept the invites; Artist sees no projects yet.
3. Manager creates project "Logo for Client X": brief, instructions, deadline in 7 days, uploads 3 reference images and a PDF.
4. Manager adds Artist to the project and creates task "Logo concepts" (priority High, due in 3 days) assigned to Artist.
5. Artist gets in-app + email notification; opens **My tasks**; sees the brief and files; asks a question in comments with @Manager.
6. Manager replies; Artist moves task to **In progress**.
7. Artist uploads `concepts-v1.png` → **Submit for review**.
8. Manager sees it in **Review queue**, drops 2 pin comments, chooses **Request changes** with a summary.
9. Artist is notified, resolves both pins, uploads `concepts-v2.png` → resubmits.
10. Manager compares v1/v2, chooses **Approve**. Task → Done; project progress updates; history shows every step with who/when.
11. Task due-date reminders and overdue alerts fire correctly (time-shifted test).
12. Artist removed from workspace → loses access immediately; their open tasks prompt reassignment.

---

## 14. Open decisions (owner to answer before/while building)
| # | Question | Default if unanswered |
|---|---|---|
| 1 | Product name & brand | ✅ **Answered: Whiteboard.** Logo, colors and font still to design (Week 0). |
| 2 | Are artists internal staff, freelancers, or both? | ✅ **Answered: both.** Staff = workspace **members** (see all projects they're added to, can be made Managers). Freelancers = workspace **guests** (only the projects they're invited to, never see other projects, members list or billing; access can have an end date). |
| 3 | Do clients log in and approve? | Phase C, off by default |
| 4 | Team size per workspace | Design for up to 50 users |
| 5 | Max upload size | 500 MB per file |
| 6 | Hosting region / data residency | EU or US single region |
| 7 | Languages | English first, i18n-ready |
| 8 | Paid product or internal tool? | Internal first; billing in Phase D |
| 9 | Web first, desktop when? | Web first, desktop in Phase C |

---

## 15. References
- Reference app hands-on scans (2026-11-11, 3 passes, free account).
- Reference app public help center: plan benefits, trial, team admins, help index (`help.milanote.com`).
- Everything marked **[OUR DESIGN]** is original to this project.
