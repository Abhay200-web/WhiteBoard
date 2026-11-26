# ADR 0003 — Run Yjs real-time collaboration (Hocuspocus) inside the Host server

- **Status:** Accepted as the direction for Phase B. The spike was throwaway; no product code was merged
- **Date:** 2026-11-26
- **Deciders:** Owner, backend developer

## Context
Phase B (boards) needs several people to edit the same board at once, with changes merged automatically. The plan picks Yjs (CRDT) with Hocuspocus as the sync server. The open question (plan step 5.9) was whether Hocuspocus can run inside the Host server, which is one Node process on the Host PC (ADR 0002), listening on one port, with the existing bearer-token sessions. If it cannot, boards would need a second process or a second port.

## What the spike tested (2026-11-26, Windows 11, Node 24 for the driver, pinned Node 22.23.5 for the bundle)
Scratch code only, in the scratchpad folder, not in the repo. Versions: `@hocuspocus/server` 4.9.0, `@hocuspocus/provider` 4.9.0, `yjs` 13.6.33, `fastify` 5.12.8, `better-sqlite3` 13.0.3.

| Check | Result |
| --- | --- |
| Wrong token is refused (`onAuthenticate` throws) | Pass: `authenticationFailed`, reason `permission-denied` |
| Edit from A reaches B, and from B reaches A | Pass: about 7–14 ms on the dev PC over loopback |
| Concurrent edits from both sides converge | Pass |
| Document survives a server restart (stored in SQLite on a debounce, loaded on connect) | Pass |
| Load: 20 clients on 5 boards, 800 edits | Pass: converged in 1.3 s |
| Bundle with esbuild, run on the pinned Node 22.23.5 | Pass, with one banner (see below) |
| `/events` and `/collab` on the same port | Pass only with one manual upgrade router (see below) |

Not measured: server memory use under load, more than 20 clients, a second PC on the LAN, and the production Host's real session check.

## What the spike found
1. **Hocuspocus runs in the same Node process and on the same port as Fastify.** `new Server(...)` gives a `crossws` WebSocket adapter. Its `crossws.handleUpgrade(req, socket, head)` takes an HTTP upgrade request, so the Host can dispatch it from its own `upgrade` listener. Calling `hocuspocus.handleConnection(ws, req)` directly on a plain socket did **not** sync (the adapter does more set-up than that call), so use `handleUpgrade`.
2. **`@fastify/websocket` and Hocuspocus clash on one port.** With the plugin registered, `/events` still worked but `/collab` never synced. Putting our listener first (`prependListener`) broke `/events` as well. The fix that works: **do not register `@fastify/websocket`. Use one `upgrade` listener that routes by path.** `/collab` goes to `crossws.handleUpgrade`; `/events` goes to a plain `ws` `WebSocketServer` in `noServer` mode. The spike ran this router with both paths working.
3. **ESM bundle needs a `createRequire` banner.** The esbuild bundle of Hocuspocus failed on Node 22 with `Dynamic require of "node:events" is not supported`. Adding `--banner:js="import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);"` fixed it. `better-sqlite3` stays external as before. The sidecar build script (`apps/desktop/scripts/build-sidecar.ts`) needs the same banner when Phase B adds Hocuspocus.
4. **Auth hook.** `onAuthenticate` receives the token the provider sends and the document name. The spike checked a fixed token. The product must check the real session (the hashed bearer-token lookup in the auth module) and the document's project membership.
5. **Persistence.** The spike stored the whole Yjs state as one row per document, replaced on each debounced store. That is simple and correct for the test, but it does not scale: Phase B needs incremental updates plus periodic compaction, and the rows must sit in the database with a migration, so the existing backup job covers them.

## Decision
- Run Hocuspocus **inside the Host server** (not a separate process or port).
- Use **one upgrade router** in the server's HTTP layer, dispatching by path: `/collab` to Hocuspocus, `/events` to its own `ws` server. Phase B migrates `/events` off `@fastify/websocket` as part of the change (tested on the same port, with its E2E).
- Build the sidecar with the `createRequire` banner.
- Use the existing session check in `onAuthenticate`, and store board updates in the database (with migration and backup coverage).

## Consequences
- ✅ One process, one port, one installer.
- ✅ Works on the pinned Node 22 in the installer.
- ⚠️ Phase B has to move `/events` off `@fastify/websocket`. That is a small change but touches the live notifications path, so it needs its own tests.
- ⚠️ Storage design (incremental updates, compaction) is not done. The spike's one-row-per-document is only a placeholder.
- ⚠️ Memory and CPU under many boards and clients are unknown. Measure in Phase B before the acceptance test.

## Alternatives considered
- **Separate Hocuspocus process on another port:** would need its own firewall rule, a second sidecar process, and its own auth check. Rejected.
- **Keep `@fastify/websocket` and add Hocuspocus on its own path:** the spike showed the two upgrade handlers conflict. Rejected unless `/events` moves off the plugin, which is the chosen option anyway.
- **Use another CRDT library:** not evaluated. The plan already chose Yjs for the editor and its ecosystem.
