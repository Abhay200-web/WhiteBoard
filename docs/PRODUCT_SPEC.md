# Whiteboard — Product & Technical Spec

> **Status:** v2 draft · **Date:** 2026-11-11
> **Sources:** (1) hands-on scan of the reference app (Milanote web app, free account, 3 passes) via browser automation; (2) the reference app's public help center for paid/team features; (3) our own design for everything the reference app doesn't have (marked **[OUR DESIGN]**).
> **Product name:** **Whiteboard** — a visual project-management app. Never reuse the reference app's name, logo or wording.
> **Team:** 1 backend developer + 1 frontend developer — work split in `EXECUTION_PLAN.md`.
> **Deployment:** **local desktop app for our own office only** — installed on every office PC, one PC is the **Host** (database + files), the rest connect over the office LAN. No cloud hosting, no paid plans or services. See §5 and `docs/adr/0001-local-desktop-host.md`.

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
| §11–12 | Install, backups & releases (local), security |
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
| **Workspace owner / admin** | Agency owner | Everything: members, all projects, roles, Host settings & backups |
| **Manager** | Project lead | Create projects, write briefs, upload files, assign tasks, review, approve / request changes, invite people |
| **Artist / employee** | Approved team member or freelancer | See only projects they're added to, work on assigned tasks, upload deliverables, submit for review, comment |
| ~~Client~~ | External customer | **Out of scope** (local app — clients can't reach the office LAN). Send them exports (PDF / files) instead |
| ~~Viewer / public link~~ | Anyone with link | **Out of scope** (no public hosting) |

### 0.3 Glossary
| Term | Meaning |
|---|---|
| **Workspace** | The company; holds members and projects. **One workspace per Host** |
| **Host** | The one office PC whose Whiteboard app runs the server, database and file store |
| **Client app** | Whiteboard installed on any other office PC; connects to the Host over the LAN |
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
Our version (in-app routes of the desktop app): `/w/:workspaceId`, `/b/:boardId/:slug`, `/settings/:section`. No public `/p/` links (local app). We don't build the reference app's referral/upgrade CTA or plan usage meter.

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
Right-side panel holding items that haven't been placed on a board yet (in the reference app also fed by mobile / web clipper / email — we have none of those); drag items from it onto any board. Counter shown in the top bar. Each board has its own Unsorted panel.

**Moving cards into a sub-board (observed):** dragging a card onto a board card highlights the board card; on drop the card disappears from the current board and appears in the **child board's Unsorted panel** (not on its canvas). The board card's count and thumbnail preview update. Also available: card menu → Move to board. Shortcut exists to send a card to Unsorted.

**Breadcrumbs:** Home › Parent › Child, each crumb with the board's color chip; each board has its own URL `/{boardId}/{slug}`.

### 3.7 Sharing (P1)
Reference app (observed): editors invited by email or link; read-only published links with password, embed code, viewer count.
**Ours (local app):** access is by **project membership** only (§3B.1) — anyone in the office who is a member of the project sees its boards. No public/published links and no embeds. To show work to someone outside the office, use **Export** (§3.8).

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
Channels per event (**in-app / Windows desktop notification**): added to project, mentioned, assigned a task, comment, task reminders, daily change summary. No email (no paid email service); see §3B.7.

### 3.12 Account & settings
| Section | Contents | P |
|---|---|---|
| Account | Name, email (login name), password (change; admins reset forgotten passwords), avatar | P0 |
| Notifications | Matrix above + enable desktop notifications | P1 |
| Connection | Host address, connection status, app version vs Host version | P0 |
| Host (owner/admin, on the Host PC only) | Data folder, backup folder & schedule, Backup now, Restore, start with Windows | P0 |
| Appearance | UI size S/M/L (with shortcut), heading font toggle, light/dark, match system theme | P0 (theme), P1 (size) |
| Preferences | Prevent overlap, drag 3D effect, grid default, template suggestions, helpers ×4, ink effect, double-click to create note, show undo/redo arrows | P1 |
| Localization | Language, number/date format, currency, 12h/24h time | P1 |
| Toolbar options | Choose rail tools | P1 |
| Privacy | Share viewing history with publishers of published boards; cookie preferences | P1 |

### 3.13 Plans & limits — not built
The reference app has a free-plan card quota and paid upgrades. **We don't build plans, quotas or billing** — this is our own internal tool. The only limits are the Host PC's disk space and the max upload size (§14).

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
- Members: add people with a role (Manager, Artist). Artists see only their projects.
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
| Assign | Manager | Artist notified (in-app + Windows desktop notification) |
| Start | Artist | Status → In progress |
| Ask questions | Artist / Manager | Task comments, @mentions |
| Submit | Artist | Uploads deliverable(s) → new **version** (v1, v2…) + note → status **Submitted for review**; manager notified |
| Review | Manager | Views version, adds **pin comments** on the image/PDF/video, then **Approve** or **Request changes** (with summary) |
| Revise | Artist | Sees open pins, fixes, marks pins **resolved**, uploads next version → resubmits |
| Approve | Manager | Version marked **Approved**, task → Approved/Done; approval recorded (who, when, which version) |

Rules: only Manager/Owner can approve; artists can't approve their own work; every decision is kept in the task's **history**.

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
Assigned · due soon (24 h) · overdue · submitted for review · changes requested · approved · new comment / @mention · added to project. Channels: **in-app bell** (live over WebSocket) + **Windows desktop notification** (Tauri notification plugin, shown when the app is open or minimized to the tray). Missed events wait in the bell inbox until the user next opens the app. Per-user settings (P1, see §3.11). **No email** — it would need a mail service; can be added later with the company's own SMTP account if wanted.

### 3B.8 Dashboard & reporting (P1)
Per project: progress, overdue tasks, tasks per status, review turnaround time. Workspace: active projects, workload per person, upcoming deadlines.

### 3B.9 Later (P2)
Dependencies, recurring tasks, time tracking, custom fields, automations, `.ics` calendar export.

---

## 3C. Teams, plans & billing

### 3C.1 What the reference app has (from its public help center — not observed)
- **Free plan:** all features, capped at **100 cards**, smaller upload limit. No separate trial.
- **Pro (individual):** unlimited cards, larger uploads; monthly/annual billing; cancel, downgrade, pause; invoices & VAT; in-app-store subscriptions on iOS.
- **Team plan:** a single **Admin** (the person who upgraded) who adds/removes members, manages payment details, payment history, plan type and billing cycle. Admin change requires contacting support. **Boards stay owned by their creator**, not the team. Mixed sharing when only some people are on paid plans. Enterprise plan on request.
- **Collaboration (all plans):** share boards, real-time editing, comments, @mentions, notifications, see who has access, remove editors, **transfer board ownership**.

### 3C.2 Our design [OUR DESIGN]
- **Workspace owns all projects** (not individual users) — no lost work when someone leaves.
- One workspace per Host, created on the Host's first run; the person who sets up the Host is the owner.
- Multiple admins; roles from §0.2; per-project membership.
- **Invites without email:** admin creates an invite (name, email as login, role, guest end date) → the app shows a one-time **invite code** (e.g. `WB-7K3P-Q9XD`, valid 7 days) → admin gives it to the person → on their PC they install Whiteboard, pick the Host, enter the code and choose a password. Pending invites list; revoke.
- **Forgotten password:** an admin sets a temporary password from the members page (no reset emails); user must change it at next login.
- **Offboarding:** remove member → their tasks reassigned (prompt) → access revoked immediately.
- Ownership transfer of workspace and of projects.
- **No plans, quotas or billing** (internal tool). One global max upload size (§14).

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
      │                          └── Activity log ⟶ notifications, daily summary in the bell
      ├── Unsorted panel (per board) ⟵ cards moved in from other boards
      └── Settings & preferences
```

Key coupling rules:
- Moving/resizing a card must update attached lines in the same frame.
- Dropping a card into a column changes its parent from board → column (ordered list), not x/y.
- Board card's "N cards" count = live count of the child board's items.
- Every mutation → collaborative doc → persisted → activity log → (notifications, digest, search index).

---

## 5. Architecture & stack

**Model: one desktop app, one Host, many client apps — all on the office LAN.** Nothing is hosted on the internet and nothing is paid. Every PC installs the same Whiteboard app. On first run the app asks: **"Set up this PC as the Host"** or **"Connect to the office Host"**.

```
 Office LAN (Wi-Fi / Ethernet)
 ┌─────────────────────────────┐        ┌───────────────────────────────────────────────┐
 │ Manager PC                  │        │ HOST PC  (Whiteboard app in Host mode)        │
 │ Whiteboard app (client) ────┼─HTTP──►│  Tauri shell ── starts & watches ──┐          │
 └─────────────────────────────┘  +WS   │                                    ▼          │
 ┌─────────────────────────────┐        │  Whiteboard Server (Node.js sidecar, :47800)  │
 │ Artist PC                   │        │   ├─ REST API (Fastify)                       │
 │ Whiteboard app (client) ────┼───────►│   ├─ WebSocket /events  (+ /collab, Phase B)  │
 └─────────────────────────────┘        │   ├─ Job scheduler (reminders, thumbnails…)   │
                                        │   ├─ SQLite database ── whiteboard.db         │
                                        │   ├─ Files folder ───── files/                │
                                        │   └─ Backup job ──────► external drive / NAS  │
                                        │  The Host PC's own user also uses the app UI  │
                                        └───────────────────────────────────────────────┘
```

- **Host PC:** any always-on office PC (Windows 10/11, ≥ 8 GB RAM, SSD, enough disk for files). Give it a **fixed LAN IP** (DHCP reservation in the router). It must be switched on while people work; the app minimizes to the tray and can start with Windows.
- **Client apps** find the Host automatically on the LAN (mDNS), or the user types its address (e.g. `192.168.1.20:47800`).
- **Same code everywhere:** the UI is a React app rendered inside Tauri; the server is a Node.js program bundled inside the installer and only started in Host mode.
- **Version check:** each client sends its app version; the Host refuses mismatched clients with "Update Whiteboard to vX.Y" (§11.4).

| Layer | Choice | Cost |
|---|---|---|
| Language | TypeScript everywhere (+ a little Rust in the Tauri shell) | Free |
| Monorepo | pnpm workspaces + Turborepo | Free |
| Desktop shell | **Tauri 2** (WebView2 on Windows): window, tray, auto-start, OS notifications, file dialogs, Host/Client mode, starts the server sidecar | Free (MIT/Apache) |
| UI | React 19, Vite, Zustand (UI state), TanStack Query (server data), Tailwind | Free |
| Server | **Node.js 22 + Fastify** + Zod validation, `@fastify/websocket` — bundled into the installer as a sidecar | Free |
| Database | **SQLite** (WAL mode) via `better-sqlite3` + **Drizzle ORM**; full-text search with SQLite **FTS5**. Only the Host's server process opens the file — clients never touch it directly | Free, no install |
| Files | Plain folder on the Host (`<data>/files/<yyyy>/<mm>/<id>`); uploads streamed to the API; `sharp` thumbnails; PDF preview with `pdf.js`; video/audio played natively (MP4/WebM) | Free |
| Jobs | In-process scheduler (`croner`) + a durable `jobs` table in SQLite (survives restarts) — replaces Redis/BullMQ | Free |
| Realtime | WebSocket `/events` from the Host (live task updates, notifications) | Free |
| Notifications | In-app bell + Windows notifications via `@tauri-apps/plugin-notification` | Free |
| Auth | **Better Auth** (email + password, SQLite adapter, **bearer-token** sessions stored by the app) | Free |
| Host discovery | mDNS (`bonjour-service` on the Host, browse from the client) + manual address | Free |
| Canvas (Phase B) | DOM cards in a CSS-transformed world layer; SVG overlay for lines; virtualization for 1k+ cards | Free |
| Rich text | TipTap (ProseMirror) + y-prosemirror | Free (MIT core) |
| Realtime boards (Phase B) | Yjs CRDT + Hocuspocus running **inside the Host server** (no Redis needed for one server); y-indexeddb client cache | Free |
| Drawing | perfect-freehand (ink strokes), stored as stroke JSON in the card | Free |
| Tables | Own grid UI (TanStack Table for model) + `fast-formula-parser` (MIT) for `=` formulas | Free |
| Emoji picker | `emoji-mart` (MIT) | Free |
| Embeds / link previews | oEmbed / Open Graph fetched by the Host — **only works when the office has internet**; otherwise the card shows a plain link | Free |
| Export | Hidden Tauri window → print to PDF / PNG; `docx` lib → Word; custom → Markdown/text | Free |
| Logs | Rotating log files in `<data>/logs` (`pino`); "Copy diagnostics" button in Settings | Free |
| Tests | Vitest (unit + API), Playwright E2E (UI in Chromium against a local server) | Free |
| CI | GitHub Actions free minutes (lint, typecheck, tests, Windows installer build on release tags) — or build locally with `pnpm tauri build` | Free |

**Explicitly not used:** cloud hosting (Fly.io, Cloudflare, Neon, Supabase, Upstash), Postgres server, Redis, S3/R2/MinIO, email services, Stripe, Sentry/PostHog/Grafana Cloud, Google login, mobile app, web clipper, code-signing certificates.

**Why SQLite, not Postgres:** a desktop Host needs a database with zero installation and a single file that is easy to back up and restore. SQLite handles an office team (≤ 50 users) easily because only one process (the Host server) writes to it. Drizzle keeps the door open to move to Postgres later if the company ever outgrows it.

---

## 6. Data model (SQLite on the Host)

Column types are written generically. In SQLite via Drizzle: `JSON` = `text({ mode: 'json' })`, `BLOB` = `blob()`, timestamps = integer ms, ids = text (ULID). Search uses FTS5 virtual tables instead of `tsvector`.

```sql
users(id, email UNIQUE, name, avatar_url, must_change_password, created_at)
workspaces(id, name, owner_id, created_at)                    -- exactly one row per Host
memberships(workspace_id, user_id, role,                 -- owner|admin|member|guest
            expires_at NULL,                              -- guests (freelancers) only; access ends automatically
            removed_at NULL, removed_by NULL)             -- offboarding (soft delete, keeps history)
boards(id, workspace_id, parent_board_id NULL, title, icon, color,
       background, grid_enabled, ydoc BLOB, updated_at)
items(id, board_id, parent_item_id NULL,                  -- parent = column
      type, x, y, w, h, z, sort_key, locked,
      content JSON, color, created_by, created_at, updated_at, deleted_at)
lines(id, board_id, from_item_id NULL, to_item_id NULL,
      x1,y1,x2,y2, start_cap, end_cap, label, dashed, weight, color)
todo_items(id, item_id, text, done, due_at, assignee_id, sort_key)
labels(id, workspace_id, name, color);  item_labels(item_id, label_id)
reactions(item_id, user_id, emoji)
comments(id, item_id NULL, board_id NULL, task_id NULL,   -- exactly one of item_id / task_id is set
         author_id, body, parent_id, created_at, edited_at)
files(id, workspace_id, storage_key, original_name, mime, size, sha256,   -- storage_key = path under <data>/files
      width, height, thumb_key, uploaded_by, created_at)
link_previews(url_hash PK, url, title, description, image_key, fetched_at)
activity(id, board_id, actor_id, verb, item_id, at)
notifications(id, user_id, kind, payload JSON, read_at, created_at)
user_settings(user_id PK, prefs JSON)                        -- appearance, prefs, locale, toolbar, notif matrix

-- Host-local tables [OUR DESIGN]
jobs(id, kind, run_at, payload JSON, attempts, locked_at, done_at, last_error)  -- reminders, thumbnails, unfurl, guest expiry
backups(id, started_at, finished_at, kind, path, db_bytes, files_copied, ok, error)  -- kind: scheduled|manual|pre-migration
host_settings(key PK, value JSON)                            -- backup folder & schedule, max upload size, app version

-- Project management layer [OUR DESIGN]
projects(id, workspace_id, name, client_name, brief JSON, instructions JSON,
         status, start_date, deadline, budget, color, cover_file_id,
         root_board_id, created_by, created_at, archived_at)
project_members(project_id, user_id, role)                   -- manager|artist
task_statuses(id, project_id, name, kind, sort_key)          -- kind: todo|doing|review|changes|approved|done
tasks(id, project_id, status_id, title, description JSON, priority,
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
task_history(id, task_id, actor_id, event, data JSON, at)
invites(id, workspace_id, project_id NULL, name, email, role, guest_expires_at NULL,
        code_hash, expires_at, created_by, accepted_at, revoked_at)  -- code shown once to the admin, stored hashed
```

Roles: workspace level in `memberships.role` (`owner|admin|member|guest`); project level in `project_members.role` (`manager|artist`). Staff = `member`, freelancers = `guest`.

Default statuses: every new project is seeded with six `task_statuses` (one per `kind`). Custom statuses are P1 but the table supports them from day one.

**`items.content` shape per type (JSON):** note/heading/document → ProseMirror JSON (Yjs-backed) · table → `{ cols, rows, cells: { "A2": { v, f?, type, fmt?, bg?, align? } } }` · sketch → `{ strokes: [{ points, color, size }] }` · swatch → `{ color, display: "hex|rgb|hsl|off", name }` · link/video/audio/map → `{ url, previewId?, embed? }`.

**Source of truth:** the Yjs doc per board (`boards.ydoc`). A debounced projector writes `items`/`lines`/`todo_items` rows for search, counts, notifications and exports.

**Where it lives on the Host:** `%LOCALAPPDATA%\Whiteboard\host\` by default (changeable in Host settings) →
`whiteboard.db` (+ `-wal`/`-shm`), `files/`, `thumbs/`, `logs/`. Back up this folder and you have everything (§11.2).

---

## 7. Pipelines

1. **Edit → sync (Phase B):** client mutates Y.Doc → y-indexeddb (offline cache) → WebSocket → Hocuspocus inside the Host server → other editors → debounced snapshot to SQLite → projector updates rows → `activity` row.
2. **Upload:** client streams the file (`POST /files`, multipart) to the Host → server checks size/type, writes to `<data>/files/…` under a temp name, computes sha256, renames → `files` row → job: thumbnail + dimensions → client updated over `/events`.
3. **Link unfurl:** URL pasted → Host enqueues fetch (cache by URL hash, timeout, private-IP blocklist, skipped when offline) → preview image saved to the files folder → card updated.
4. **Notifications:** activity verbs (mention, assign, comment, added to project) → `notifications` rows → pushed over `/events` to every open app of that user → in-app bell + Windows desktop notification. Users who are offline see them in the bell next time they open the app.
5. **Reminders:** due date set → `jobs` row with `run_at` → scheduler fires it → notification.
6. **Daily summary (P1):** scheduler at 09:00 → group yesterday's activity per user → one summary notification in the bell.
7. **Export:** client renders the board/project in a hidden window → PDF/PNG, or walks the tree (docx/md/txt, optional sub-boards) → zip → **Save as…** dialog on the user's PC.
8. **Search index:** projector updates SQLite FTS5 tables for items, boards, projects, tasks.
9. **Startup (Host):** Tauri starts the server sidecar → server takes an automatic backup if a migration is pending → runs Drizzle migrations → opens port 47800 → announces itself over mDNS → Tauri restarts the server if it crashes.
10. **Review flow [OUR DESIGN]:** artist uploads → `deliverable_versions` row (state pending) → task status → review → notify managers/watchers → manager creates `reviews` row → decision updates version state + task status → notify artist → `task_history` row.
11. **Deadline watcher:** scheduler every 15 min → tasks due in 24 h / overdue → notifications (deduplicated). Missed runs (Host was off) are caught up at startup.
12. **Invites:** admin creates invite → Host returns a one-time code (stored hashed) → admin hands it over → new user's app connects to the Host, enters code + password → membership + project membership → notify inviter.
13. **Offboarding:** admin removes member → API returns their open tasks → admin picks a new assignee per task (or "unassigned") → in one transaction: tasks reassigned, `project_members` rows deleted, `memberships.removed_at` set, sessions revoked → reassigned people notified → `task_history` rows.
14. **Guest expiry:** daily scheduler run (and at startup) → guests with `expires_at` < now go through the offboarding steps automatically (open tasks become unassigned, managers notified).
15. **Backup:** daily at the configured time (default 13:00, while the Host is surely on) and on **Backup now** → SQLite online backup (`VACUUM INTO`) to `<backup>/db/whiteboard-<date>.db` → copy new/changed files to `<backup>/files/` → prune (keep 14 daily + 8 weekly) → `backups` row → warn owners in the bell if the last good backup is > 2 days old or the backup folder is missing.
16. **Restore:** owner picks a backup in Host settings → server stops accepting requests → current data folder is moved aside (never deleted) → backup copied in → server restarts → clients reconnect.

---

## 8. API surface (ours)

All routes are served by the Host at `http://<host-ip>:47800`. Requests carry `Authorization: Bearer <session>` and `X-App-Version`.

```
GET    /host/info                    (public: workspace name, server version — used by discovery & version check)
POST   /setup                        (first run only: create workspace + owner account)
POST   /auth/*                       (Better Auth: sign-in, sign-out, change password)
GET    /me                           PATCH /me/settings
GET    /workspaces/:id/home
POST   /boards                       GET/PATCH/DELETE /boards/:id
GET    /boards/:id/children          POST /boards/:id/duplicate
POST   /boards/:id/move              (re-parent)
WS     /collab?board=:id             (Yjs, Phase B)
POST   /files                        (multipart stream upload)
GET    /files/:id                    (download / preview; supports Range for video)
GET    /files/:id/thumb
POST   /unfurl                       { url }
GET    /search?q=&filter=
GET    /notifications                POST /notifications/read
GET    /boards/:id/export-data       { includeSubBoards }  (client builds the PDF/PNG/docx locally)
GET    /trash                        POST /trash/:itemId/restore

# Host administration (owner/admin) [OUR DESIGN]
GET/POST           /admin/backups                    (list / Backup now)
POST               /admin/backups/:id/restore
GET/PATCH          /admin/host-settings              (backup folder & time, max upload size)

# Workspace members & offboarding [OUR DESIGN]
GET                /workspaces/:id/members                       (list, with role and expiry)
PATCH              /workspaces/:id/members/:userId               { role, expiresAt }
GET                /workspaces/:id/members/:userId/open-tasks    (for the reassignment step)
POST               /workspaces/:id/members/:userId/remove        { reassign: [{ taskId, toUserId|null }] }
POST               /workspaces/:id/members/:userId/reset-password  → { temporaryPassword }
GET/POST           /invites  (POST → { code }, shown once)   POST /invites/accept { code, password }   DELETE /invites/:id (revoke)

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
  web/        React + Vite UI (runs inside the desktop app; also in a plain browser for dev & E2E tests)
  desktop/    Tauri 2 shell: Host/Client mode, starts & watches the server sidecar, tray, auto-start,
              notifications, mDNS browse, file dialogs, installer config
  server/     Fastify REST + WebSocket /events + scheduler/jobs + backups (+ Hocuspocus in Phase B)
/packages
  core/       domain types, Zod schemas (API contract), Yjs schema, geometry, card registry
  canvas/     canvas engine (pan/zoom, selection, drag, lines, overlap push) — Phase B
  editor/     TipTap config + extensions
  ui/         our design system (tokens, components, icons)
  db/         Drizzle schema (SQLite) + migrations
  config/     eslint, tsconfig, tailwind preset
/scripts      bundle Node runtime + server for the sidecar, release helpers
/.github      GitHub Actions (CI, Windows installer build on tags)
```

---

## 10. Build roadmap (brick by brick)

Project-management first: the workflow in §13 must work end to end by the end of **Phase A**.

**Phase A — MVP: the manager ⇄ artist workflow**
| # | Brick | Done when |
|---|---|---|
| 1 | Monorepo, CI, design tokens, **desktop shell with Host/Client mode**, server sidecar, SQLite + migrations, auth | Host PC sets up the workspace + owner; a second PC finds the Host on the LAN and logs in; CI green |
| 2 | Workspaces, roles, invite codes, member list, admin password reset, offboarding, guest expiry | Owner invites a staff member and a freelancer; roles enforced; removing a member reassigns their tasks and revokes access; expired guests lose access automatically |
| 3 | Projects (create, brief, files, members, status) | Manager creates a project with brief + files; artist sees only their projects |
| 4 | Files pipeline (stream upload to Host, thumbnails, previews, download) + **backups & restore** | Upload/preview images, PDFs, video; nightly backup runs; restore tested |
| 5 | Tasks + list view + My tasks | Create/assign/edit tasks; artist sees My tasks |
| 6 | Kanban view + statuses | Drag between statuses; status rules enforced |
| 7 | Deliverables + versions + submit for review | Artist submits v1; manager sees it in Review queue |
| 8 | Reviews + pin feedback + side-by-side version compare | Approve / Request changes with pins; artist resolves pins, submits v2; manager compares v1/v2 |
| 9 | Task comments, @mentions, task history, in-app notifications (bell + WebSocket) | Full audit trail per task; in-app notification for every §3B.7 event |
| 10 | Windows desktop notifications + deadline watcher + Windows installer | Every §3B.7 event shows a Windows notification once; due-soon and overdue alerts fire; `.msi` installs on a clean office PC |

**Phase B — Visual boards**
| # | Brick | Done when |
|---|---|---|
| 11 | Canvas engine | Pan, zoom, fit, select, multi-select, drag, resize, grid, 60 fps @ 500 cards |
| 12 | Note, image, file, link, column, line cards | §3.2 P0 rows |
| 13 | Task cards on the board | Card ↔ task stay in sync with list/kanban |
| 14 | Persistence, undo/redo, nesting, breadcrumbs, trash, context menus | §3.1, §3.3, §3.6, §3.14 |
| 15 | Realtime collaboration (Yjs via Hocuspocus inside the Host server) | 2+ users live over the LAN, presence cursors, no conflicts |

**Phase C — v2**
| # | Brick | Done when |
|---|---|---|
| 16 | Calendar view, filters, saved views, search | §3B.6, §3.10 |
| 17 | Dashboard & reporting | §3B.8 |
| 18 | Host hardening: run the server as a Windows service (works with nobody logged in), encrypted LAN traffic (§12), in-app updates served by the Host | Host survives reboot without login; clients update from the Host with one click |
| 19 | Export (PDF/PNG/Word/Markdown/zip) | §3.8 |
| 20 | Settings (all sections), templates | §3.12 |
| 21 | Table, Document, Heading, Color, Comment cards | §3.2 P1 rows |

**Phase D — v3**
| # | Brick |
|---|---|
| 22 | Timeline/Gantt, dependencies, recurring tasks, time tracking |
| 23 | Sketch/Draw, Map, Video, Audio cards |
| 24 | `.ics` calendar export, optional email via the company's own SMTP account |

**Removed (local app, no paid services):** plans/quotas/Stripe billing, client portal & public links, mobile app, web clipper, Slack/Google Calendar integrations.

---

## 11. Install, backups & releases (local — nothing hosted)

### 11.1 Installing in the office
1. Pick the **Host PC**: always on during work hours, SSD, enough free disk for all project files (+ the same again for backups on another drive). Reserve a fixed IP for it in the office router.
2. Install `Whiteboard_x.y.z_x64.msi` → choose **Set up this PC as the Host** → enter company name + owner account → choose the **backup folder** (external drive or NAS — not the same disk). Allow Windows Firewall access on **Private** networks only (port 47800).
3. On every other PC: install the same `.msi` → **Connect to the office Host** → the Host appears automatically (or type its IP) → sign in with an invite code.
4. Set the Host app to **Start with Windows** and to minimize to the tray. Disable sleep on the Host PC during work hours.

### 11.2 Backups (the most important part)
- **Automatic daily backup** by the Host (§7 pipeline 15) of the database and the files folder to the backup folder; keeps 14 daily + 8 weekly copies.
- **Backup now** button; **automatic backup before every update/migration**.
- **3-2-1 rule:** besides the automatic backup, once a week copy the backup folder to a second drive that is kept **outside the office** (theft, fire). Free option: rotate two USB drives.
- **Restore test once a month:** restore the latest backup on a spare PC (install Whiteboard → Host → Restore) and open a project. A backup that has never been restored doesn't count.
- If the Host PC dies: install Whiteboard on another PC → **Set up as Host → Restore from backup** → give it the old PC's IP (or clients re-pick the Host).

### 11.3 Environments
| Environment | What | Who |
|---|---|---|
| **Dev** | `pnpm dev` on each developer PC: Vite UI + server with a local SQLite file in `./.data` (no Docker, no services). `pnpm tauri dev` to run inside the desktop shell | Both developers |
| **Test Host** | A spare PC (or a developer PC) running the latest `develop` build in Host mode, with test data; a second PC as client | Team, owner for demos |
| **Office (production)** | The real Host PC + all office PCs, running a released version from `main` | Everyone |

### 11.4 Releases & updates
1. PR → `develop`: GitHub Actions runs install → lint → typecheck → unit + API tests → build → Playwright E2E (UI in Chromium against a local server with a temp SQLite file).
2. Release PR `develop` → `main`, tagged `vX.Y.Z`: GitHub Actions (Windows runner) builds the `.msi` and attaches it to a GitHub Release (private repo). Free tier minutes are enough; it can also be built locally with `pnpm tauri build`.
3. **Updating the office:** run the new installer on the **Host first** (it backs up, then migrates the database on start), then on every client PC. Phase A–B: copy the installer to a shared folder/USB. Phase C: the Host serves the installer and clients get an **Update** button.
4. **Version rule:** client and Host must have the same `major.minor`; otherwise the client shows "Update Whiteboard to vX.Y" and stays read-only/blocked. Patch versions are compatible.
5. **No code signing** (paid). Windows SmartScreen shows "Unknown publisher" on first install → **More info → Run anyway**. Acceptable for an internal app.

---

## 12. Security & quality checklist
- Authorization on every request (project membership + role); freelancers (guests) never see other projects or the members list.
- The Host listens on the LAN only: Windows Firewall rule for **Private** networks, never port-forwarded to the internet.
- **LAN traffic:** Phase A–B use plain HTTP inside the office network (accepted risk: someone on the office Wi-Fi could sniff traffic — keep the Wi-Fi password private and guests on a separate guest network). Phase C adds encryption: the Host creates its own certificate on first run and clients pin its fingerprint when they first connect.
- Passwords hashed (argon2/scrypt via Better Auth); invite codes stored hashed, single-use, expire in 7 days.
- Rate limiting on sign-in and invite acceptance (stops password guessing from another PC).
- Session tokens kept by the desktop app (Tauri store), revoked on sign-out, offboarding and password reset.
- SSRF protection in unfurl (block private IP ranges, timeouts, size limits).
- Uploads: global max size, allowed types checked by content (not just extension), files stored under random names, never executed.
- Data folder is readable only by the Windows user running the Host; backups go to a drive kept physically safe.
- CSP in the desktop app; no remote code loaded; Tauri capabilities limited to what each window needs.
- Accessibility: keyboard navigation of cards, focus rings, ARIA on toolbar.
- Performance budgets: first board render < 1.5 s, 60 fps pan/zoom at 1,000 cards, API p95 < 200 ms on the LAN.
- Role checks on every task/review endpoint (artists can't approve their own work).
- Audit trail: `task_history` and `activity` (P0); full admin audit log (P2).

---

## 13. End-to-end acceptance scenario (definition of "complete")

The MVP is complete when this runs without errors as an automated Playwright test **and** by hand on **real office PCs (one Host + two clients)**:

1. **Owner** installs Whiteboard on the Host PC, sets it up as Host with workspace "Studio", creates invite codes for **Manager** and **Artist**.
2. Manager and Artist install Whiteboard on their own PCs, find the Host on the LAN, accept with their codes; Artist sees no projects yet.
3. Manager creates project "Logo for Client X": brief, instructions, deadline in 7 days, uploads 3 reference images and a PDF.
4. Manager adds Artist to the project and creates task "Logo concepts" (priority High, due in 3 days) assigned to Artist.
5. Artist gets an in-app + Windows desktop notification; opens **My tasks**; sees the brief and files; asks a question in comments with @Manager.
6. Manager replies; Artist moves task to **In progress**.
7. Artist uploads `concepts-v1.png` → **Submit for review**.
8. Manager sees it in **Review queue**, drops 2 pin comments, chooses **Request changes** with a summary.
9. Artist is notified, resolves both pins, uploads `concepts-v2.png` → resubmits.
10. Manager compares v1/v2, chooses **Approve**. Task → Done; project progress updates; history shows every step with who/when.
11. Task due-date reminders and overdue alerts fire correctly (time-shifted test).
12. Artist removed from workspace → loses access immediately; their open tasks prompt reassignment.
13. Owner clicks **Backup now**; the backup is restored on a spare PC set up as a new Host, and the "Logo for Client X" project, its files and full history are all there.
14. The Host PC is restarted; client apps show "Reconnecting…" and recover on their own without losing unsaved comments.

---

## 14. Open decisions (owner to answer before/while building)
| # | Question | Default if unanswered |
|---|---|---|
| 1 | Product name & brand | ✅ **Answered: Whiteboard.** Logo, colors and font still to design (Week 0). |
| 2 | Are artists internal staff, freelancers, or both? | ✅ **Answered: both.** Staff = workspace **members** (see all projects they're added to, can be made Managers). Freelancers = workspace **guests** (only the projects they're invited to, never see other projects, the members list or Host settings; access can have an end date). |
| 3 | Do clients log in and approve? | ✅ **Answered: no.** Local app only; clients receive exports |
| 4 | Team size per workspace | Design for up to 50 users on one Host |
| 5 | Max upload size | 500 MB per file (Host setting) |
| 6 | Hosting region / data residency | ✅ **Answered: nothing hosted.** All data stays on the office Host PC and its backup drives |
| 7 | Languages | English first, i18n-ready |
| 8 | Paid product or internal tool? | ✅ **Answered: internal tool, no paid plans or services** |
| 9 | Web first, desktop when? | ✅ **Answered: desktop only (Tauri), from Phase A.** One PC is the Host, the rest connect over the office LAN |
| 10 | Which PC is the Host, and where do backups go? | Owner picks an always-on PC; backups to an external drive/NAS + a weekly off-site copy |
| 11 | Operating systems in the office | Windows 10/11 only (Tauri can build macOS/Linux later if needed) |
| 12 | Do freelancers ever work from outside the office? | ✅ **Answered: no** — everyone works on the office LAN. If this changes, add a free VPN (Tailscale free plan / WireGuard) |

---

## 15. References
- Reference app hands-on scans (2026-11-11, 3 passes, free account).
- Reference app public help center: plan benefits, trial, team admins, help index (`help.milanote.com`).
- Everything marked **[OUR DESIGN]** is original to this project.
