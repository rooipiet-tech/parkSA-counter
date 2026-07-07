-- ParkSA counter — Cloudflare D1 (SQLite) additive migration: tap direction.
--
-- SQLite translation of supabase/migrations/0002_direction.sql. ADDITIVE &
-- REVERSIBLE: a single ADD COLUMN with a default, so legacy rows become
-- 'dropoff' and nothing else is disturbed. Reverse with:
--   ALTER TABLE events DROP COLUMN direction;
--
-- Applied on an already-deployed backend by re-running:
--   wrangler d1 migrations apply parksa --remote
-- (the migrations runner tracks 0001 as applied and runs only this file).

ALTER TABLE events ADD COLUMN direction TEXT NOT NULL DEFAULT 'dropoff';
