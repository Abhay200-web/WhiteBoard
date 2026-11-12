# Whiteboard

A visual project-management desktop app for our office. One PC runs as the **Host** (server, SQLite database, files); every other PC connects to it over the office LAN. Nothing is hosted online.

- Product spec: [`docs/PRODUCT_SPEC.md`](docs/PRODUCT_SPEC.md)
- Execution plan: [`docs/EXECUTION_PLAN.md`](docs/EXECUTION_PLAN.md)
- Decisions: [`docs/adr/`](docs/adr/)

## Requirements

- Node.js 22 (see `.nvmrc`)
- pnpm via Corepack (version pinned in `package.json`):
  - `corepack enable pnpm` (needs an admin terminal on Windows), or without admin:
  - `corepack enable --install-directory "%APPDATA%\npm" pnpm`

No Docker, databases or accounts needed.

## Getting started

```sh
pnpm install
pnpm dev          # run every app in dev mode
pnpm lint         # ESLint
pnpm typecheck    # TypeScript
pnpm test         # Vitest
pnpm format       # Prettier (write)
```

## Layout

```
apps/
  web/        React + Vite UI
  desktop/    Tauri 2 shell (Host/Client mode, server sidecar, tray)
  server/     Fastify REST + WebSocket /events, scheduler, backups
packages/
  core/       Zod schemas & domain types — the API contract
  db/         Drizzle schema (SQLite) + migrations
  ui/         design system
  editor/     TipTap config
  config/     shared ESLint, Prettier and tsconfig
```

## Workflow

Branch from `develop` (`feat/<issue#>-name`, `fix/…`, `chore/…`), open a PR into `develop`, conventional commits. See `docs/EXECUTION_PLAN.md` §3.
