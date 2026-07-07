-- ParkSA counter — additive migration: tap direction (drop-off / pick-up).
--
-- ADDITIVE & REVERSIBLE. Safe to apply to an already-deployed project: it only
-- adds one column with a default, so every legacy row becomes 'dropoff' and no
-- existing data is touched. Reverse with:  ALTER TABLE events DROP COLUMN direction;
--
-- The anon INSERT policy already covers the new column (it is not column-limited
-- for events), and events remain append-only (no UPDATE/DELETE path).

ALTER TABLE events
  ADD COLUMN direction text NOT NULL DEFAULT 'dropoff'
  CHECK (direction IN ('dropoff', 'pickup'));
