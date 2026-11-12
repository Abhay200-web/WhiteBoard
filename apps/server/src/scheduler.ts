import { jobs as jobsTable, type Db } from '@whiteboard/db';
import { eq } from 'drizzle-orm';

export interface Job {
  name: string;
  intervalMs: number;
  run: (db: Db, now: Date) => void | Promise<void>;
}

/**
 * Runs every job whose last run is older than its interval (or that never ran).
 * Because the last run is stored in SQLite, a Host that was off catches up on the next tick.
 * One failing job never stops the others.
 */
export async function runDueJobs(
  db: Db,
  jobs: readonly Job[],
  now = new Date(),
): Promise<string[]> {
  const ran: string[] = [];
  for (const job of jobs) {
    const row = db.select().from(jobsTable).where(eq(jobsTable.name, job.name)).get();
    if (row?.lastRunAt && now.getTime() - row.lastRunAt.getTime() < job.intervalMs) continue;
    let status: 'ok' | 'error' = 'ok';
    let error: string | null = null;
    try {
      await job.run(db, now);
    } catch (err) {
      status = 'error';
      error = err instanceof Error ? err.message : String(err);
    }
    db.insert(jobsTable)
      .values({ name: job.name, lastRunAt: now, lastStatus: status, lastError: error })
      .onConflictDoUpdate({
        target: jobsTable.name,
        set: { lastRunAt: now, lastStatus: status, lastError: error },
      })
      .run();
    ran.push(job.name);
  }
  return ran;
}

/** Starts the in-process scheduler. The first tick runs immediately (startup catch-up). */
export function startScheduler(
  db: Db,
  jobs: readonly Job[],
  { tickMs = 60_000, onError }: { tickMs?: number; onError?: (err: unknown) => void } = {},
): () => void {
  let running = false;
  const tick = () => {
    if (running) return;
    running = true;
    runDueJobs(db, jobs)
      .catch((err: unknown) => onError?.(err))
      .finally(() => {
        running = false;
      });
  };
  tick();
  const timer = setInterval(tick, tickMs);
  timer.unref();
  return () => clearInterval(timer);
}
