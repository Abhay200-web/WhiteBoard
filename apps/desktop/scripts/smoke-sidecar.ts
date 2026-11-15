// Starts the built sidecar the way the desktop shell will (its own node.exe, no PATH, an empty
// data folder) and checks each native piece: SQLite + migrations, sharp thumbnails, file-type
// detection, the /events WebSocket. Run `sidecar:build` first.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const outDir = fileURLToPath(new URL('../sidecar/', import.meta.url));
const port = 47899;
const base = `http://127.0.0.1:${port}`;
const dataDir = mkdtempSync(path.join(tmpdir(), 'wb-sidecar-'));
// A 1x1 PNG, enough for sharp to make a thumbnail.
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

const server = spawn(path.join(outDir, 'node.exe'), ['dist/server.mjs'], {
  cwd: path.join(outDir, 'server'),
  env: {
    SYSTEMROOT: process.env.SYSTEMROOT,
    WB_DATA_DIR: dataDir,
    WB_HOST: '127.0.0.1',
    WB_PORT: String(port),
  },
  stdio: ['ignore', 'ignore', 'inherit'],
});

function check(ok: unknown, what: string): asserts ok {
  if (!ok) throw new Error(`Sidecar smoke failed: ${what}`);
  console.log(`ok - ${what}`);
}

async function waitForHost() {
  for (let i = 0; i < 40; i++) {
    try {
      return (await (await fetch(`${base}/host/info`)).json()) as { setupDone: boolean };
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error('Sidecar smoke failed: the server did not start within 10 s');
}

try {
  const info = await waitForHost();
  check(info.setupDone === false, 'starts on an empty data folder (SQLite + migrations)');

  const setup = await fetch(`${base}/setup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      workspaceName: 'Smoke',
      ownerName: 'Owner',
      email: 'owner@smoke.test',
      password: 'correct-horse-battery',
    }),
  });
  const { token } = (await setup.json()) as { token: string };
  check(setup.ok && token, 'creates the workspace');
  const auth = { authorization: `Bearer ${token}` };

  const form = new FormData();
  form.append('file', new Blob([png], { type: 'image/png' }), 'dot.png');
  const upload = await fetch(`${base}/files`, { method: 'POST', headers: auth, body: form });
  const file = (await upload.json()) as { id: string; mimeType: string; hasThumbnail: boolean };
  check(upload.ok && file.mimeType === 'image/png', 'detects the uploaded file type (file-type)');

  const thumb = await fetch(`${base}/files/${file.id}/thumbnail`, { headers: auth });
  check(
    thumb.ok && thumb.headers.get('content-type') === 'image/webp',
    'makes a thumbnail (sharp)',
  );

  const ready = await new Promise<string>((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/events`);
    ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', token }));
    ws.onmessage = (event) => {
      resolve(String(event.data));
      ws.close();
    };
    ws.onerror = () => reject(new Error('Sidecar smoke failed: /events did not connect'));
  });
  check(JSON.parse(ready).type === 'ready', 'accepts the /events WebSocket');
} finally {
  if (server.exitCode === null) {
    server.kill();
    await new Promise((resolve) => server.once('exit', resolve));
  }
  rmSync(dataDir, { recursive: true, force: true });
}
