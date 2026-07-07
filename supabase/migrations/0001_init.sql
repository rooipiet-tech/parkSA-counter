-- ParkSA counter — initial schema.
--
-- HANDOVER NOTES:
--  * Deploy into a FRESH Supabase project only. Do NOT apply this migration
--    to an existing in-use project: it creates tables, policies, triggers and
--    column-level grants for the anon role.
--  * Events are append-only: the anon role can INSERT and SELECT but has NO
--    UPDATE or DELETE path on events. Undo is an INSERTed tombstone row.
--  * Sessions use a column-level grant: anon may UPDATE only end_ts and
--    end_source (see REVOKE/GRANT below). PostgREST respects PG column grants.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS providers (
  id text PRIMARY KEY,
  name text NOT NULL,
  sort_order int NOT NULL,
  hidden boolean NOT NULL DEFAULT false,
  is_permanent boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS events (
  id uuid PRIMARY KEY, -- client-generated UUID = idempotency key
  provider_id text NOT NULL,
  device_ts timestamptz NOT NULL,
  session_id uuid NOT NULL,
  observer_label text NOT NULL,
  location_label text NOT NULL,
  synced_offline boolean NOT NULL,
  clock_suspect boolean NOT NULL DEFAULT false,
  received_at timestamptz NOT NULL DEFAULT now()
  -- Deliberately NO FOREIGN KEY on session_id: the offline queue flushes
  -- sessions before events on a best-effort basis, but an event must NEVER
  -- be rejected because its session row has not arrived yet (zero-loss rule).
);

CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY,
  start_ts timestamptz NOT NULL,
  end_ts timestamptz,
  end_source text CHECK (end_source IN ('normal', 'retroactive')),
  observer_label text NOT NULL,
  location_label text NOT NULL,
  -- RS-04: a session can never end before it started.
  CONSTRAINT sessions_end_after_start CHECK (end_ts IS NULL OR end_ts >= start_ts)
);

CREATE TABLE IF NOT EXISTS tombstones (
  event_id uuid PRIMARY KEY, -- one tombstone per event; re-insert is a no-op
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Seed providers — MUST stay identical (ids, names, order) to
-- src/seed/providers.ts. 'Unknown' is last and permanent.
-- ---------------------------------------------------------------------------

INSERT INTO providers (id, name, sort_order, hidden, is_permanent) VALUES
  ('first-class-parking', 'First Class Parking', 1, false, false),
  ('or-tambo-parking-services', 'OR Tambo Parking Services', 2, false, false),
  ('express-airport-parking', 'Express Airport Parking', 3, false, false),
  ('dynamic-airport-parking', 'Dynamic Airport Parking', 4, false, false),
  ('mr-parking', 'Mr Parking', 5, false, false),
  ('safe-car', 'Safe Car', 6, false, false),
  ('e-parking', 'E Parking', 7, false, false),
  ('eazypark', 'EazyPark', 8, false, false),
  ('absolute-valet', 'Absolute Valet', 9, false, false),
  ('faith-airport-parking', 'Faith Airport Parking', 10, false, false),
  ('valet-airport-parking-services', 'Valet Airport Parking Services', 11, false, false),
  ('unknown', 'Unknown', 12, false, true)
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

ALTER TABLE providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tombstones ENABLE ROW LEVEL SECURITY;

-- MIG-01: DROP POLICY IF EXISTS before each CREATE makes the migration safe to
-- re-run (CREATE POLICY has no IF NOT EXISTS form).

-- anon may read everything (pseudonymous observation data only).
DROP POLICY IF EXISTS providers_select_anon ON providers;
CREATE POLICY providers_select_anon ON providers FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS events_select_anon ON events;
CREATE POLICY events_select_anon ON events FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS sessions_select_anon ON sessions;
CREATE POLICY sessions_select_anon ON sessions FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS tombstones_select_anon ON tombstones;
CREATE POLICY tombstones_select_anon ON tombstones FOR SELECT TO anon USING (true);

-- events: INSERT only. There is deliberately NO UPDATE and NO DELETE policy
-- for anon on events — the event log is append-only.
DROP POLICY IF EXISTS events_insert_anon ON events;
CREATE POLICY events_insert_anon ON events FOR INSERT TO anon WITH CHECK (true);

-- tombstones: INSERT only — undo is an appended tombstone row, never a
-- mutation of the underlying event.
DROP POLICY IF EXISTS tombstones_insert_anon ON tombstones;
CREATE POLICY tombstones_insert_anon ON tombstones FOR INSERT TO anon WITH CHECK (true);

-- providers: anon may INSERT and UPDATE (add/rename/hide/reorder from the
-- app settings screen) but has NO DELETE policy.
DROP POLICY IF EXISTS providers_insert_anon ON providers;
CREATE POLICY providers_insert_anon ON providers FOR INSERT TO anon WITH CHECK (true);
DROP POLICY IF EXISTS providers_update_anon ON providers;
CREATE POLICY providers_update_anon ON providers FOR UPDATE TO anon USING (true) WITH CHECK (true);
-- RS-04: a COLUMN-LEVEL grant limits anon UPDATE to the mutable fields; the
-- primary key `id` and `is_permanent` can never be rewritten by anon (the
-- permanent-provider trigger is a belt-and-braces second line of defence).
REVOKE UPDATE ON providers FROM anon;
GRANT UPDATE (name, sort_order, hidden) ON providers TO anon;

-- sessions: anon may INSERT new sessions; UPDATE is allowed by policy but
-- restricted by a COLUMN-LEVEL grant to exactly end_ts and end_source, so a
-- session's identity/start can never be rewritten by the anon role.
DROP POLICY IF EXISTS sessions_insert_anon ON sessions;
CREATE POLICY sessions_insert_anon ON sessions FOR INSERT TO anon WITH CHECK (true);
DROP POLICY IF EXISTS sessions_update_anon ON sessions;
CREATE POLICY sessions_update_anon ON sessions FOR UPDATE TO anon USING (true) WITH CHECK (true);
REVOKE UPDATE ON sessions FROM anon;
GRANT UPDATE (end_ts, end_source) ON sessions TO anon;

-- ---------------------------------------------------------------------------
-- Permanent-provider guard: 'Unknown' can never be hidden, demoted or deleted.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION guard_permanent_provider() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.is_permanent THEN
      RAISE EXCEPTION 'cannot delete a permanent provider';
    END IF;
    RETURN OLD;
  END IF;
  -- MIG-02: also block PK mutation of a permanent provider (would orphan
  -- events pointing at the old provider_id).
  IF OLD.is_permanent AND (NEW.hidden OR NOT NEW.is_permanent OR NEW.id <> OLD.id) THEN
    RAISE EXCEPTION 'cannot hide, demote, rekey or delete a permanent provider';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS providers_permanent_guard ON providers;
CREATE TRIGGER providers_permanent_guard
BEFORE UPDATE OR DELETE ON providers
FOR EACH ROW EXECUTE FUNCTION guard_permanent_provider();

-- ---------------------------------------------------------------------------
-- Server clock for the client-side clock-skew audit (DC-08).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION server_now() RETURNS timestamptz
LANGUAGE sql STABLE AS $$
  SELECT now();
$$;

GRANT EXECUTE ON FUNCTION server_now() TO anon;
