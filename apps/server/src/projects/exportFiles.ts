import { readFileSync } from 'node:fs';

import { files, projectFiles, taskFiles, tasks, type Db } from '@whiteboard/db';
import { zipSync } from 'fflate';
import { eq } from 'drizzle-orm';

import { resolveStoragePath } from '../files/storage';
import { buildMarkdown, type ProjectExport } from './export';

interface StoredFile {
  /** Path inside the zip, for example `tasks/Poster/brief.pdf`. */
  zipPath: string;
  storagePath: string;
}

/** Every file attached to the project or to one of its tasks, with the folder it goes in. */
function storedFiles(db: Db, projectId: string): StoredFile[] {
  const projectLevel = db
    .select({ name: files.name, storagePath: files.storagePath })
    .from(projectFiles)
    .innerJoin(files, eq(files.id, projectFiles.fileId))
    .where(eq(projectFiles.projectId, projectId))
    .all()
    .map((f) => ({ zipPath: `files/${f.name}`, storagePath: f.storagePath }));
  const taskLevel = db
    .select({ title: tasks.title, name: files.name, storagePath: files.storagePath })
    .from(taskFiles)
    .innerJoin(tasks, eq(tasks.id, taskFiles.taskId))
    .innerJoin(files, eq(files.id, taskFiles.fileId))
    .where(eq(tasks.projectId, projectId))
    .all()
    .map((f) => ({ zipPath: `tasks/${f.title}/${f.name}`, storagePath: f.storagePath }));
  return [...projectLevel, ...taskLevel];
}

/** Replaces characters that are not allowed in a zip path or a Windows file name. */
const FORBIDDEN = '/\\:*?"<>|';
const safePart = (name: string) =>
  [...name]
    .map((ch) => (ch.charCodeAt(0) < 32 || FORBIDDEN.includes(ch) ? '_' : ch))
    .join('')
    .trim() || '_';

/**
 * A zip with the project as Markdown (`project.md`) and every attached file. Files go in
 * `files/` for the project and `tasks/<task>/` for each task; two files with the same name in
 * one folder get a number so none is lost.
 */
export function buildProjectZip(
  db: Db,
  dataDir: string,
  data: ProjectExport,
  projectId: string,
): Uint8Array {
  const entries: Record<string, Uint8Array> = {
    'project.md': new TextEncoder().encode(buildMarkdown(data)),
  };
  const used = new Set<string>(Object.keys(entries));
  for (const file of storedFiles(db, projectId)) {
    const parts = file.zipPath.split('/').map(safePart);
    const folder = parts.slice(0, -1).join('/');
    const base = parts[parts.length - 1]!;
    const dot = base.lastIndexOf('.');
    const stem = dot > 0 ? base.slice(0, dot) : base;
    const ext = dot > 0 ? base.slice(dot) : '';
    let name = `${folder}/${base}`;
    for (let n = 2; used.has(name); n++) name = `${folder}/${stem} (${n})${ext}`;
    used.add(name);
    entries[name] = readFileSync(resolveStoragePath(dataDir, file.storagePath));
  }
  return zipSync(entries, { level: 6 });
}
