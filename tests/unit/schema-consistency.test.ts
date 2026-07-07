import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SEED_PROVIDERS } from '../../src/seed/providers.ts';

const sql = readFileSync(join(process.cwd(), 'supabase', 'migrations', '0001_init.sql'), 'utf8');
const directionSql = readFileSync(
  join(process.cwd(), 'supabase', 'migrations', '0002_direction.sql'),
  'utf8'
);
const workerDirectionSql = readFileSync(
  join(process.cwd(), 'worker', 'migrations', '0002_direction.sql'),
  'utf8'
);

/** Extract the column names of a CREATE TABLE block. */
function tableBlock(name: string): string {
  const m = sql.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${name}\\s*\\(([\\s\\S]*?)\\n\\);`, 'i'));
  if (!m) throw new Error(`no CREATE TABLE for ${name}`);
  return m[1];
}

describe('migration SQL matches the adapter contract (AC-20/AC-22/AC-25)', () => {
  it('events table has every adapter event field as a column, PK on client uuid, received_at DEFAULT now()', () => {
    const block = tableBlock('events');
    const fields = [
      'id',
      'provider_id',
      'device_ts',
      'session_id',
      'observer_label',
      'location_label',
      'synced_offline',
      'clock_suspect',
      'received_at'
    ];
    for (const f of fields) expect(block).toMatch(new RegExp(`^\\s*${f}\\s`, 'm'));
    expect(block).toMatch(/id uuid PRIMARY KEY/i);
    expect(block).toMatch(/received_at timestamptz NOT NULL DEFAULT now\(\)/i);
    expect(block).toMatch(/clock_suspect boolean/i);
    // Deliberately NO foreign key on session_id (documented in a comment).
    expect(block).not.toMatch(/REFERENCES/i);
    expect(block).toMatch(/NO FOREIGN KEY on session_id/i);
  });

  it('sessions table matches Session fields (end_ts nullable, end_source constrained)', () => {
    const block = tableBlock('sessions');
    for (const f of ['id', 'start_ts', 'end_ts', 'end_source', 'observer_label', 'location_label']) {
      expect(block).toMatch(new RegExp(`^\\s*${f}\\s`, 'm'));
    }
    expect(block).toMatch(/end_source text CHECK \(end_source IN \('normal', 'retroactive'\)\)/i);
    expect(block).not.toMatch(/end_ts timestamptz NOT NULL/i);
  });

  it('providers and tombstones tables match adapter fields', () => {
    const p = tableBlock('providers');
    for (const f of ['id', 'name', 'sort_order', 'hidden', 'is_permanent']) {
      expect(p).toMatch(new RegExp(`^\\s*${f}\\s`, 'm'));
    }
    const t = tableBlock('tombstones');
    expect(t).toMatch(/event_id uuid PRIMARY KEY/i);
    expect(t).toMatch(/^\s*created_at\s/m);
  });

  it('seed providers are identical (ids, names, order) to src/seed/providers.ts', () => {
    const seedBlock = sql.match(/INSERT INTO providers[\s\S]*?ON CONFLICT DO NOTHING;/i)?.[0];
    expect(seedBlock).toBeTruthy();
    const rows = [...seedBlock!.matchAll(/\('([^']+)', '([^']+)', (\d+), (false|true), (false|true)\)/g)];
    expect(rows).toHaveLength(12);
    rows.forEach((row, i) => {
      expect(row[1]).toBe(SEED_PROVIDERS[i].id);
      expect(row[2]).toBe(SEED_PROVIDERS[i].name);
      expect(Number(row[3])).toBe(SEED_PROVIDERS[i].sort_order);
      expect(row[5] === 'true').toBe(SEED_PROVIDERS[i].is_permanent);
    });
    expect(sql).toMatch(/ON CONFLICT DO NOTHING/i);
  });

  it('RLS is enabled on all four tables', () => {
    for (const table of ['providers', 'events', 'sessions', 'tombstones']) {
      expect(sql).toMatch(new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`, 'i'));
    }
  });

  it('anon has INSERT on events+tombstones and NO UPDATE/DELETE policy on events', () => {
    expect(sql).toMatch(/CREATE POLICY events_insert_anon ON events FOR INSERT TO anon/i);
    expect(sql).toMatch(/CREATE POLICY tombstones_insert_anon ON tombstones FOR INSERT TO anon/i);
    const policies = [...sql.matchAll(/CREATE POLICY[^;]+;/gi)].map((m) => m[0]);
    const eventPolicies = policies.filter((p) => /ON\s+events\s/i.test(p));
    expect(eventPolicies.length).toBeGreaterThan(0);
    for (const p of eventPolicies) {
      expect(p).not.toMatch(/FOR\s+UPDATE/i);
      expect(p).not.toMatch(/FOR\s+DELETE/i);
      expect(p).not.toMatch(/FOR\s+ALL/i);
    }
  });

  it('sessions anon UPDATE surface is column-limited to end_ts/end_source', () => {
    expect(sql).toContain('REVOKE UPDATE ON sessions FROM anon;');
    expect(sql).toContain('GRANT UPDATE (end_ts, end_source) ON sessions TO anon;');
  });

  it('sessions has an end_ts >= start_ts CHECK (RS-04)', () => {
    expect(sql).toMatch(/CHECK \(end_ts IS NULL OR end_ts >= start_ts\)/i);
  });

  it('providers anon UPDATE is column-limited to name/sort_order/hidden (RS-04)', () => {
    expect(sql).toContain('REVOKE UPDATE ON providers FROM anon;');
    expect(sql).toContain('GRANT UPDATE (name, sort_order, hidden) ON providers TO anon;');
  });

  it('permanent guard also blocks primary-key mutation (MIG-02)', () => {
    expect(sql).toMatch(/NEW\.id <> OLD\.id/);
  });

  it('policies and the guard trigger are drop-if-exists guarded for safe re-run (MIG-01)', () => {
    expect(sql).toMatch(/DROP POLICY IF EXISTS events_insert_anon ON events;/i);
    expect(sql).toMatch(/DROP POLICY IF EXISTS providers_update_anon ON providers;/i);
    expect(sql).toMatch(/DROP TRIGGER IF EXISTS providers_permanent_guard ON providers;/i);
  });

  it('permanent-provider guard trigger and server_now() exist; providers have no anon DELETE', () => {
    expect(sql).toMatch(/CREATE TRIGGER providers_permanent_guard/i);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION server_now\(\) RETURNS timestamptz/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION server_now\(\) TO anon;/i);
    const providerPolicies = [...sql.matchAll(/CREATE POLICY[^;]+ON\s+providers[^;]+;/gi)].map((m) => m[0]);
    for (const p of providerPolicies) expect(p).not.toMatch(/FOR\s+DELETE/i);
  });

  it('schema stores no vehicle or driver identifiers (POPIA minimality)', () => {
    expect(sql).not.toMatch(/vehicle|driver|registration|licence|license/i);
  });
});

describe('direction migration is additive and reversible (AD-1/AD-8)', () => {
  it('Supabase 0002 adds a NOT NULL direction column defaulting to dropoff with a CHECK', () => {
    // 0001 must NOT be edited — direction lives entirely in the additive 0002.
    expect(sql).not.toMatch(/direction/i);
    expect(directionSql).toMatch(/ALTER TABLE\s+events\s+ADD COLUMN\s+direction\s+text/i);
    expect(directionSql).toMatch(/NOT NULL/i);
    expect(directionSql).toMatch(/DEFAULT 'dropoff'/i);
    expect(directionSql).toMatch(/CHECK \(direction IN \('dropoff', 'pickup'\)\)/i);
  });

  it('Cloudflare D1 0002 adds the same additive column (SQLite)', () => {
    expect(workerDirectionSql).toMatch(
      /ALTER TABLE events ADD COLUMN direction TEXT NOT NULL DEFAULT 'dropoff'/i
    );
  });

  it('both note the reversible DROP COLUMN path (no data loss)', () => {
    expect(directionSql).toMatch(/DROP COLUMN direction/i);
    expect(workerDirectionSql).toMatch(/DROP COLUMN direction/i);
  });
});
