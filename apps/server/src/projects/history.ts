import { randomUUID } from 'node:crypto';

import type { TaskEvent } from '@whiteboard/core';
import { taskHistory, type DbTx } from '@whiteboard/db';

/** Records one change to a task. Call it inside the transaction that makes the change. */
export function recordHistory(tx: DbTx, taskId: string, actorId: string, change: TaskEvent) {
  const { event, ...data } = change;
  tx.insert(taskHistory)
    .values({ id: randomUUID(), taskId, actorId, event, data, at: new Date() })
    .run();
}
