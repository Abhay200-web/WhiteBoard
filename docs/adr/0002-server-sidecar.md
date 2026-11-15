# ADR 0002 — Ship the Host server as a pinned node.exe plus a bundled server folder

- **Status:** Accepted. Installer verified on the dev PC (Step T.2); a clean-PC install is still to do
- **Date:** 2026-11-15
- **Deciders:** Owner, backend developer

## Context
ADR 0001 says the Tauri app starts the Node server as a sidecar on the Host PC. The server uses native modules: `better-sqlite3` (database) and `sharp` (thumbnails). It also uses `file-type`, which loads `strtok3` through an import written so bundlers cannot see it. Week 0 flagged "Node + native modules inside the installer" as the biggest packaging risk. The choice was between:

- **A. Folder:** a pinned `node.exe` + the server bundled into one file + a small `node_modules` for whatever cannot be bundled.
- **B. Single executable:** Node SEA (or `pkg`) turning the server into one `.exe`.

## What the spike found (2026-11-15, Windows 11, Node 22.23.5)
- `better-sqlite3` 13 is a **Node-API** module and ships prebuilt binaries per platform. Nothing is compiled and one binary works on any Node version. `sharp` 0.35 is also Node-API, with its prebuilt `@img/sharp-win32-x64`.
- esbuild bundles the server to one ESM file (3.2 MB) when `better-sqlite3`, `sharp` and `file-type` are left external. On the first try `file-type` was bundled and uploads failed with `Cannot find package 'strtok3'`, which is why it is external.
- Started with only the pinned `node.exe`, an empty `PATH` and an empty data folder, the folder build creates the database, runs migrations, sets up a workspace, detects an uploaded PNG, makes a WebP thumbnail, takes a backup and accepts the `/events` WebSocket. `pnpm --filter @whiteboard/desktop sidecar:smoke` repeats these checks (except the backup).
- Size: `node.exe` 83 MB + server folder about 26 MB (after dropping other platforms' SQLite binaries and the SQLite C sources) = **109 MB on disk, about 42 MB zipped**.
- **SEA** needs a CommonJS entry. The server uses top-level `await`, so esbuild refuses the CJS bundle. That is fixable, but SEA's `require` only loads Node's built-ins, so the `.node` binaries, sharp's libvips DLLs and the ESM `file-type` would still have to sit beside the exe and be loaded by path. It saves nothing and adds steps. `pkg` is archived upstream, and its fork unpacks native modules to a temp folder at run time. Neither was built end to end, since the blocker is structural.

## Decision
1. Use **option A**. `pnpm --filter @whiteboard/desktop sidecar:build` (`apps/desktop/scripts/build-sidecar.ts`) writes `apps/desktop/sidecar/`:
   - `node.exe`: Node **22.23.5** (matches `.nvmrc`), downloaded from nodejs.org and checked against a pinned SHA-256.
   - `server/dist/server.mjs`: the server and its pure-JS dependencies.
   - `server/migrations/`: found at start-up as `../migrations` relative to `dist/`.
   - `server/node_modules/`: only `better-sqlite3`, `sharp`, `file-type` and their dependencies, at the versions in our lockfile, Windows x64 binaries only, no install scripts.
2. The shell runs `node.exe dist/server.mjs` with `server/` as the working folder and passes `WB_DATA_DIR`, `WB_HOST` and `WB_PORT`. The server needs nothing else from the PC.
3. Upgrading Node means changing `NODE_VERSION` + `NODE_SHA256` in the build script and `.nvmrc` together.

## Consequences
- ✅ No compiler is needed to build the sidecar. `--os=win32 --cpu=x64` should let a Linux CI runner build it too (only tried on Windows so far).
- ✅ The server code is unchanged. Dev still runs it with `tsx`.
- ⚠️ A new dependency that loads code at run time (a native module, or a hidden `import()` like `file-type`'s) must be added to `EXTERNAL` in the build script. The smoke test catches the cases it exercises, not all of them.
- ⚠️ `file-type`'s own dependencies (`strtok3` and others) are resolved by npm when the sidecar is built, not pinned by our lockfile.
- ⚠️ About 42 MB of the installer is Node itself. That is acceptable for an office LAN install.
- ✅ **Installer (T.2, 2026-11-15):** the whole `sidecar/` folder, `node.exe` included, ships as a Tauri resource (`bundle.resources`), not as an "external binary", so it stays one folder. The `.msi` is 44.9 MB, and the built app starts the server from it. Still to do: install it on a clean PC. `restore-cli` will be bundled the same way for T.4.

## Alternatives considered
- **Node SEA / `pkg` single executable:** see the findings above.
- **Ship the whole pnpm `node_modules`:** works, but it is far larger, and pnpm's symlinked layout does not copy cleanly into an installer.
- **Bundle `file-type` and patch its hidden import:** fragile across upgrades, for a saving of a few hundred kB.
