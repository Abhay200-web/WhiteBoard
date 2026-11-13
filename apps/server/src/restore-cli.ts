// Restore a backup into a Host data folder. Stop the Host first.
//   pnpm --filter @whiteboard/server restore <backup-folder> [--data-dir <dir>] [--replace]
import path from 'node:path';

import { loadConfig } from './config';
import { RestoreError, restoreBackup } from './backups/restore';

const args = process.argv.slice(2);
const replace = args.includes('--replace');
const dirFlag = args.indexOf('--data-dir');
const dataDirArg = dirFlag >= 0 ? args[dirFlag + 1] : undefined;
const backup = args.find((a, i) => !a.startsWith('--') && i !== dirFlag + 1);

if (!backup) {
  console.error('Usage: restore <backup-folder> [--data-dir <dir>] [--replace]');
  process.exit(2);
}

const dataDir = dataDirArg ? path.resolve(dataDirArg) : loadConfig().dataDir;
try {
  const movedTo = await restoreBackup(path.resolve(backup), dataDir, { replace });
  console.log(`Restored ${backup} into ${dataDir}`);
  if (movedTo) console.log(`The previous data was kept in ${movedTo}`);
} catch (err) {
  if (err instanceof RestoreError) {
    console.error(err.message);
    process.exit(1);
  }
  throw err;
}
