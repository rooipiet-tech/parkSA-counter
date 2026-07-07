import { TapQueue } from '../../src/queue/queue.ts';
import { newId } from '../../src/lib/ids.ts';
import { DEFAULT_LOCATION, type Session } from '../../src/lib/types.ts';

let dbCounter = 0;

export function uniqueDbName(): string {
  return `parksa-test-${Date.now()}-${dbCounter++}`;
}

export function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: newId(),
    start_ts: new Date().toISOString(),
    observer_label: 'OBS-1',
    location_label: DEFAULT_LOCATION,
    ...overrides
  };
}

export interface TestQueueOpts {
  dbName?: string;
  offline?: boolean | (() => boolean);
  startSession?: boolean;
}

export async function openTestQueue(opts: TestQueueOpts = {}) {
  const dbName = opts.dbName ?? uniqueDbName();
  const offline = opts.offline ?? false;
  const isOffline = typeof offline === 'function' ? offline : () => offline;
  const queue = await TapQueue.open({ dbName, isOffline });
  let session: Session | null = null;
  if (opts.startSession !== false) {
    session = makeSession();
    await queue.startSession(session);
  }
  return { queue, dbName, session };
}
