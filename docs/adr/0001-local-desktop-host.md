# ADR 0001 — Local desktop app with one office Host, SQLite, no paid services

- **Status:** Accepted
- **Date:** 2026-11-11
- **Deciders:** Owner, backend developer, frontend developer

## Context
Whiteboard is an internal tool used only by our own office. The owner decided:
- it is a **desktop app**, not a hosted web app;
- **nothing is hosted** on the internet and **no paid plans or services** are used;
- several people on different PCs in the same office must share the same projects, tasks and reviews (the manager ⇄ artist workflow in spec §13).

The earlier spec assumed cloud hosting (Fly.io, Neon Postgres, Cloudflare R2, Upstash Redis, Resend email, Sentry).

## Decision
1. **One app, two modes.** Every PC installs the same Tauri 2 app. One office PC runs it in **Host mode**; all others run in **Client mode** and connect to the Host over the office LAN.
2. **The Host runs a bundled Node.js server** (Fastify, sidecar process started and watched by the Tauri shell) on port 47800, found by clients via mDNS or a typed IP.
3. **Database: SQLite** (WAL mode, `better-sqlite3`, Drizzle ORM), one file on the Host, opened only by the server process. Search via FTS5.
4. **Files: a plain folder on the Host**, streamed through the API. No S3/MinIO.
5. **Jobs: in-process scheduler + `jobs` table.** No Redis/BullMQ.
6. **Notifications: in-app bell + Windows desktop notifications.** No email.
7. **Accounts: email + password with invite codes** handed over in person; admins reset forgotten passwords.
8. **Backups are a built-in Host feature** (daily + manual + pre-migration, restore from the app), plus a weekly off-site copy by the owner.
9. **Releases:** Windows `.msi` built by GitHub Actions (free tier) or locally; Host updated first, then clients. No code signing.

## Consequences
- ✅ Zero running cost; all data stays in the office; no Docker or services needed for development.
- ✅ Same UI code as before (React in Tauri); same API design; Drizzle allows a later move to Postgres.
- ⚠️ The Host PC is a single point of failure → mitigated by backups, restore-on-another-PC, and always-on settings (Phase C: Windows service).
- ⚠️ Nobody can work when the Host is off, and nobody outside the office LAN can connect (a free VPN can be added later if that changes).
- ⚠️ LAN traffic is unencrypted until Phase C → keep office Wi-Fi private.
- ⚠️ Packaging Node with native modules inside the installer is a technical risk → spiked in Week 0.
- ❌ Dropped: client portal, public links, email, mobile app, web clipper, billing, third-party integrations.

## Alternatives considered
- **Self-hosted server (Docker: Postgres, MinIO, Redis) on an office machine** — more moving parts and admin work than the team needs; rejected for simplicity.
- **Each PC with its own local database** — people couldn't share projects; breaks the core workflow.
- **SQLite file on a shared network folder** — SQLite over SMB is unsafe (locking/corruption); rejected.
- **Embedded Postgres on the Host** — works, but a larger installer and harder backups than one SQLite file, with no benefit at our size.
