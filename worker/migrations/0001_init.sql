-- ParkSA counter — Cloudflare D1 (SQLite) schema.
--
-- SQLite translation of supabase/migrations/0001_init.sql. RLS, column grants
-- and the permanent-provider trigger are intentionally DROPPED: the Worker
-- (worker/index.ts + worker/handlers.ts) enforces auth (shared PIN) and the
-- permanent-provider guard in code instead. Columns, names and semantics are
-- kept identical to the Postgres schema and to src/adapters/types.ts.
--
-- Idempotent + re-runnable: CREATE TABLE IF NOT EXISTS, INSERT OR IGNORE.
-- Booleans are stored as INTEGER 0/1; timestamps as ISO-8601 TEXT (UTC).

CREATE TABLE IF NOT EXISTS providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0,
  is_permanent INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY, -- client-generated UUID = idempotency key
  provider_id TEXT NOT NULL,
  device_ts TEXT NOT NULL,
  session_id TEXT NOT NULL,
  observer_label TEXT NOT NULL,
  location_label TEXT NOT NULL,
  synced_offline INTEGER NOT NULL,
  clock_suspect INTEGER NOT NULL DEFAULT 0,
  received_at TEXT NOT NULL
  -- Deliberately NO FOREIGN KEY on session_id (mirrors the Supabase decision):
  -- the offline queue flushes sessions before events on a best-effort basis,
  -- but an event must NEVER be rejected because its session row has not
  -- arrived yet (zero-loss rule / out-of-order acceptance).
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  start_ts TEXT NOT NULL,
  end_ts TEXT,
  end_source TEXT CHECK (end_source IN ('normal', 'retroactive')),
  observer_label TEXT NOT NULL,
  location_label TEXT NOT NULL,
  -- RS-04: a session can never end before it started.
  CONSTRAINT sessions_end_after_start CHECK (end_ts IS NULL OR end_ts >= start_ts)
);

CREATE TABLE IF NOT EXISTS tombstones (
  event_id TEXT PRIMARY KEY, -- one tombstone per event; re-insert is a no-op
  created_at TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- Seed providers — MUST stay identical (ids, names, order) to
-- src/seed/providers.ts. 'Unknown' is last and permanent (is_permanent=1).
-- ---------------------------------------------------------------------------

INSERT OR IGNORE INTO providers (id, name, sort_order, hidden, is_permanent) VALUES
  ('first-class-parking', 'First Class Parking', 1, 0, 0),
  ('or-tambo-parking-services', 'OR Tambo Parking Services', 2, 0, 0),
  ('express-airport-parking', 'Express Airport Parking', 3, 0, 0),
  ('dynamic-airport-parking', 'Dynamic Airport Parking', 4, 0, 0),
  ('mr-parking', 'Mr Parking', 5, 0, 0),
  ('safe-car', 'Safe Car', 6, 0, 0),
  ('e-parking', 'E Parking', 7, 0, 0),
  ('eazypark', 'EazyPark', 8, 0, 0),
  ('absolute-valet', 'Absolute Valet', 9, 0, 0),
  ('faith-airport-parking', 'Faith Airport Parking', 10, 0, 0),
  ('valet-airport-parking-services', 'Valet Airport Parking Services', 11, 0, 0),
  ('unknown', 'Unknown', 12, 0, 1);
