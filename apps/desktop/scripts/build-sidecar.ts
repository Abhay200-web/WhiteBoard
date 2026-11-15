// Builds the Host server folder the desktop installer ships (docs/adr/0002-server-sidecar.md):
//   sidecar/node.exe                 pinned Node runtime, checksum-checked
//   sidecar/server/dist/server.mjs   the server and its pure-JS dependencies in one file
//   sidecar/server/dist/restore.mjs  the restore command (apps/server/src/restore-cli.ts)
//   sidecar/server/migrations/       found at start-up as '../migrations' from dist/
//   sidecar/server/node_modules/     only the packages that cannot be bundled (EXTERNAL)
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const NODE_VERSION = '22.23.5';
const NODE_SHA256 = '247e9693d316da9857e44990e5e11709f596f18112251b8026ec6eed80bdf38a';

/** Loaded at run time in ways a bundler cannot follow: native binaries, and file-type's hidden import of strtok3. */
const EXTERNAL = ['better-sqlite3', 'sharp', 'file-type'];

const root = fileURLToPath(new URL('../../../', import.meta.url));
const serverDir = path.join(root, 'apps/server');
const outDir = fileURLToPath(new URL('../sidecar/', import.meta.url));
const appDir = path.join(outDir, 'server');

const sha256 = (buf: Buffer) => createHash('sha256').update(buf).digest('hex');

async function fetchNode(target: string) {
  if (existsSync(target) && sha256(readFileSync(target)) === NODE_SHA256) return;
  const res = await fetch(`https://nodejs.org/dist/v${NODE_VERSION}/win-x64/node.exe`);
  if (!res.ok) throw new Error(`Downloading Node ${NODE_VERSION} failed: HTTP ${res.status}`);
  const exe = Buffer.from(await res.arrayBuffer());
  if (sha256(exe) !== NODE_SHA256) throw new Error(`Node ${NODE_VERSION} checksum mismatch`);
  writeFileSync(target, exe);
}

/** The version the workspace actually installed (from the lockfile), not the range in package.json. */
function installedVersion(name: string): string {
  const pkg = path.join(serverDir, 'node_modules', name, 'package.json');
  return (JSON.parse(readFileSync(pkg, 'utf8')) as { version: string }).version;
}

rmSync(appDir, { recursive: true, force: true });
mkdirSync(appDir, { recursive: true });

await build({
  // restore.mjs is the restore CLI; the desktop app runs it while the server is stopped (T.4).
  entryPoints: {
    server: path.join(serverDir, 'src/index.ts'),
    restore: path.join(serverDir, 'src/restore-cli.ts'),
  },
  outdir: path.join(appDir, 'dist'),
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  target: `node${NODE_VERSION.split('.')[0]}`,
  format: 'esm',
  external: EXTERNAL,
  // Bundled CommonJS dependencies call require(); ESM output has none unless we make one.
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
  logLevel: 'warning',
});
cpSync(path.join(root, 'packages/db/migrations'), path.join(appDir, 'migrations'), {
  recursive: true,
});

writeFileSync(
  path.join(appDir, 'package.json'),
  JSON.stringify({ name: 'whiteboard-host', private: true, type: 'module' }, null, 2),
);
// --os/--cpu pick the Windows binaries even when this runs on another OS. No install scripts run:
// both native packages ship prebuilt binaries. One command string, since npm is a .cmd on Windows.
const specs = EXTERNAL.map((name) => `${name}@${installedVersion(name)}`).join(' ');
execSync(
  `npm install --omit=dev --ignore-scripts --no-audit --no-fund --os=win32 --cpu=x64 ${specs}`,
  { cwd: appDir, stdio: 'inherit' },
);

// better-sqlite3 ships every platform's binary and the SQLite C sources; keep only ours.
const sqliteDir = path.join(appDir, 'node_modules/better-sqlite3');
for (const file of readdirSync(path.join(sqliteDir, 'prebuilds'))) {
  if (file !== 'win32-x64.node') rmSync(path.join(sqliteDir, 'prebuilds', file));
}
for (const dir of ['deps', 'src'])
  rmSync(path.join(sqliteDir, dir), { recursive: true, force: true });

await fetchNode(path.join(outDir, 'node.exe'));
console.log(`Sidecar ready in ${outDir}`);
