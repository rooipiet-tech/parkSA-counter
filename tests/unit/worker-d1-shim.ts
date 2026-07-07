import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import worker, { type Env } from '../../worker/index.ts';
import type { D1Like, D1PreparedStatement } from '../../worker/handlers.ts';
import { RestAdapter } from '../../src/adapters/rest.ts';
import type { BackendAdapter } from '../../src/adapters/types.ts';

/**
 * D1 shim over an in-memory better-sqlite3 database. Exposes exactly the
 * { prepare(sql).bind(...args).all()/first()/run() } surface worker/handlers.ts
 * uses, so the SAME server code runs unchanged in node (no wrangler) — CB-5.
 */
class ShimStatement implements D1PreparedStatement {
  constructor(
    private readonly stmt: Database.Statement,
    private readonly args: unknown[] = []
  ) {}
  bind(...values: unknown[]): D1PreparedStatement {
    return new ShimStatement(this.stmt, values);
  }
  async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
    return { results: this.stmt.all(...(this.args as never[])) as T[] };
  }
  async first<T = Record<string, unknown>>(): Promise<T | null> {
    const row = this.stmt.get(...(this.args as never[]));
    return (row ?? null) as T | null;
  }
  async run(): Promise<unknown> {
    return this.stmt.run(...(this.args as never[]));
  }
}

class ShimDb implements D1Like {
  constructor(private readonly db: Database.Database) {}
  prepare(sql: string): D1PreparedStatement {
    return new ShimStatement(this.db.prepare(sql));
  }
}

const MIGRATIONS = ['0001_init.sql', '0002_direction.sql'].map((f) =>
  readFileSync(join(process.cwd(), 'worker', 'migrations', f), 'utf8')
);

export const PIN = '1234';

export function freshDb(): D1Like {
  const db = new Database(':memory:');
  for (const migration of MIGRATIONS) db.exec(migration);
  return new ShimDb(db);
}

/** A fetch that routes requests THROUGH the real Worker fetch against a DB. */
export function workerFetch(db: D1Like, pin = PIN) {
  const env: Env = { DB: db, PARKSA_PIN: pin, ALLOWED_ORIGIN: '*' };
  return (input: string, init?: RequestInit): Promise<Response> =>
    worker.fetch(new Request(input, init), env);
}

/** RestAdapter wired to a fresh in-memory Worker+D1 stack. */
export function makeRestAdapter(): BackendAdapter {
  const db = freshDb();
  return new RestAdapter({ baseUrl: 'http://worker.test', pin: PIN, fetchImpl: workerFetch(db) });
}

export { worker };
