# ParkSA Counter

Offline-first PWA tally counter for observing parking-provider pickups at
OR Tambo (Parkade 2 South, Level 3). One big tile per provider; every tap is
an append-only event that syncs idempotently to a backend when connectivity
allows. Analysis (provider × hour / day-of-week / date, SAST) and CSV export
are built in.

- **Frontend:** Vite 7 + Preact + TypeScript, `vite-plugin-pwa` (generateSW).
- **Storage:** IndexedDB queue (`pendingEvents`, `pendingTombstones`,
  `pendingSessions`, `sessionLog`, `meta`) — pending rows are removed only
  after the backend acks; the session log survives sync and reload.
- **Backends:** a single `BackendAdapter` interface with two implementations:
  an in-memory **stub** (the default whenever Supabase env vars are absent —
  all tests run against it) and a **Supabase** adapter
  (`src/adapters/supabase.ts`) that mirrors the contract-tested stub
  semantics.
- **Undo:** append-only tombstones. Events are never updated or deleted;
  readers anti-join `tombstones` on `event_id`.
- **Time:** all hour/day-of-week/date binning goes through the single module
  `src/lib/sast.ts` (South Africa is fixed UTC+2, no DST). Aggregation uses
  `device_ts` for events synced offline and `received_at` otherwise (DC-06).
- **Clock audit:** each flush measures device-vs-server skew; events synced
  with |skew| > 120 s carry `clock_suspect=true`.

## Quick start

```bash
npm ci
npm run dev          # local dev server (stub backend)
npm run build        # production build into dist/
npm run preview      # serve the production build
npm test             # unit suite (vitest) then e2e suite (Playwright/chromium)
npm run test:unit    # vitest only; filter by filename: npm run test:unit -- timezone
npm run test:e2e     # Playwright only (builds + serves a preview automatically)
npm run seed:month   # regenerate fixtures/expected-aggregates.json (deterministic)
```

No credentials are needed for anything above: without `VITE_SUPABASE_URL` /
`VITE_SUPABASE_ANON_KEY` the app uses the in-memory stub adapter.

Configuration (build-time env vars):

| Variable | Default | Purpose |
| --- | --- | --- |
| `VITE_APP_PIN` | `1234` | Shared unlock PIN |
| `VITE_SUPABASE_URL` | unset | Supabase project URL (unset ⇒ stub backend) |
| `VITE_SUPABASE_ANON_KEY` | unset | Supabase anon key (unset ⇒ stub backend) |

URL hooks (used by the tests): `?fresh=1` wipes localStorage/IndexedDB before
boot (then strips itself from the URL) — but it **refuses to wipe when unsynced
taps are queued** unless `?fresh=1&force=1` is also given, so the zero-loss
guarantee holds in production (test/agent fresh contexts have nothing pending,
so behaviour is unchanged). `?seed=month` self-seeds the stub with the
deterministic June-2026 synthetic month (`src/seed/month.ts`).

## Agent interface

Every operable surface is drivable headlessly through stable `data-testid`
selectors plus the window-level API below. Nothing requires text or CSS-class
selectors.

### `window.__PARKSA__` API

Always installed (even before PIN unlock).

- `getQueueState(): Promise<{ events, pendingCount }>` — exact shape:
  ```ts
  {
    events: Array<{           // ALL taps of the current session, in tap order,
      id: string;             // surviving sync AND reload
      provider_id: string;
      device_ts: string;      // ISO, captured at tap time
      session_id: string;
      observer_label: string;
      location_label: string;
      synced_offline: boolean; // written at enqueue time
      clock_suspect: boolean;
      received_at?: string;
      tombstoned: boolean;     // true if undone (row is never removed)
      synced: boolean;         // true once the backend acked it
    }>;
    pendingCount: number;      // events still awaiting backend ack
  }
  ```
- `getServerState(): Promise<{ events, sessions, providers, tombstones }>` —
  backend snapshot; each event carries `tombstoned: boolean` computed by
  anti-joining the tombstones table.
- `setForceOffline(v: boolean): void` — app-level offline switch, persisted to
  localStorage (survives reload); `false` also triggers a sync attempt.
- `flush(): Promise<void>` — flush the queue now; rejects on backend failure.
- `exportCsv({ from, to }): Promise<string>` — raw-events CSV over a SAST date
  range (`YYYY-MM-DD`, inclusive); byte-identical to the dashboard download.
  Fields starting with `= + - @` (formula-injection triggers) are neutralized.
- `exportCoverageCsv({ from, to }): Promise<string>` — per date×hour SAST
  coverage CSV (`date,hour,covered,event_count`); distinguishes unobserved bins
  from zero-demand ones.
- `closeSessionRetroactively(sessionId, endTs?): Promise<void>` — closes a
  never-ended (stale) session with `end_source='retroactive'`. Also reachable
  from the settings UI (`retro-close-<id>` buttons). Never auto-runs against the
  session resumed on reload — you must name a specific id.
- `listOpenSessions(): Promise<Session[]>` — open (never-ended) backend sessions
  excluding the one currently resumed on this device (retro-close candidates).
- `injectFault(n: number): void` / `clearFault(): void` — **stub-only** fault
  injection (the next `n` backend calls fail). On the Supabase adapter these
  are `console.warn` no-ops.

### data-testid inventory

| Area | testid | Element / behaviour |
| --- | --- | --- |
| Shell | `insecure-context-warning` | Blocking warning when `!isSecureContext` |
| Shell | `ios-install-hint` | Compact install hint on iPhone UA when not standalone |
| Shell | `ios-install-hint-dismiss` | Dismiss the install hint (persisted per device) |
| Shell | `unsynced-banner` | Nag when a relaunch finds unsynced taps |
| Shell | `unsynced-badge` | Persistent unsynced-count badge |
| Shell | `last-sync` | Last successful sync — humanized SAST text; `data-iso` attr holds the machine-readable ISO instant (`Never synced` when none) |
| Shell | `nav-count`, `nav-dashboard` | View switching (hash-based) |
| Shell | `settings-open` | Settings opener — **long-press ≥500 ms**; a plain click does nothing |
| PIN | `pin-input`, `pin-submit`, `pin-error` | Unlock gate (once per device) |
| Session | `observer-input`, `observer-helper`, `observer-error` | Pseudonymous observer code (`^[A-Za-z0-9_-]{1,12}$`) |
| Session | `location-input` | Location label (default `OR Tambo Parkade 2 South Level 3`) |
| Session | `session-start`, `session-end`, `session-info` | Lifecycle controls (End session is a two-step confirm) |
| Session | `session-end-confirm`, `session-end-cancel` | Confirm / cancel ending the session |
| Session | `unsynced-warning` | Shown when a session ends with a non-empty queue |
| Counting | `tile-<provider_id>` | Tap tile (pointerdown-only capture) |
| Counting | `count-<provider_id>` | Per-tile running session count |
| Counting | `undo-btn` | Undo last tap (append-only tombstone) |
| Settings | `provider-add-name`, `provider-add` | Add provider |
| Settings | `provider-row-<id>`, `provider-name-<id>`, `provider-rename-<id>` | Rename |
| Settings | `provider-hide-<id>` | Hide/unhide (absent for permanent `unknown`) |
| Settings | `provider-top-<id>`, `provider-up-<id>`, `provider-down-<id>` | Reorder |
| Settings | `settings-back`, `settings-error` | Navigation / errors |
| Settings | `open-sessions`, `open-session-<id>`, `retro-close-<id>` | Close a stale open session retroactively |
| Dashboard | `range-from`, `range-to` | SAST date range |
| Dashboard | `csv-export`, `coverage-export` | CSV downloads |
| Dashboard | `dash-provider-<id>`, `dash-total-<id>` | Totals row |
| Dashboard | `cell-hour-<id>-<0..23>` | Provider × hour cell |
| Dashboard | `cell-dow-<id>-<0..6>` | Provider × day-of-week cell (0 = Sunday) |
| Dashboard | `cell-date-<id>-<YYYY-MM-DD>` | Provider × date cell |

## Deployment (HTTPS only)

Deploy the built `dist/` to **HTTPS-only hosting** (e.g. Netlify/Vercel/any
static host with TLS). Service workers, durable storage and
`crypto.randomUUID` require a secure context: the app refuses to run over
plain HTTP and renders a blocking warning instead. **`http://localhost` is the
sole non-TLS path** (development and the test loop only). Do not serve the
app over plain HTTP anywhere else.

Set `VITE_APP_PIN`, `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` at build
time to bind a deployment to a Supabase project.

## Supabase migration & handover notes

`supabase/migrations/0001_init.sql` contains the full schema, seed and
hardening. Read before applying:

- **Deploy into a fresh project only.** Do NOT apply this migration to either
  existing in-use Supabase project: it creates tables, RLS policies, triggers
  and role grants for `anon`.
- Events are **append-only**: `anon` gets INSERT + SELECT on `events` and has
  no UPDATE or DELETE path. Undo works by INSERTing a `tombstones` row
  (`event_id` PK ⇒ idempotent). Idempotent event re-sends rely on the
  client-generated UUID PK plus `ON CONFLICT DO NOTHING` /
  `ignoreDuplicates: true` upserts.
- **Column-level grant on sessions:** the anon UPDATE policy is deliberately
  paired with `REVOKE UPDATE ON sessions FROM anon;` followed by
  `GRANT UPDATE (end_ts, end_source) ON sessions TO anon;`. PostgREST
  respects PostgreSQL column grants, so the anon role can close a session
  (normally or retroactively) but can never rewrite its identity, start time
  or labels. Keep the REVOKE/GRANT pair intact if you edit the policies.
- `events.session_id` deliberately has **no foreign key**: the client flushes
  sessions before events on a best-effort basis, but an event must never be
  rejected because its session row has not arrived yet.
- The `providers_permanent_guard` trigger blocks hiding, demoting, **rekeying
  (PK mutation)** or deleting permanent providers (`Unknown`) even for callers
  that bypass the app. Provider anon UPDATE is additionally column-limited via
  `REVOKE UPDATE ON providers FROM anon;` +
  `GRANT UPDATE (name, sort_order, hidden) ON providers TO anon;` so `id` and
  `is_permanent` are immutable to the anon role.
- `sessions` carries `CHECK (end_ts IS NULL OR end_ts >= start_ts)`.
- The migration is **re-runnable**: every policy is `DROP POLICY IF EXISTS`-ed
  before `CREATE`, the trigger is `DROP TRIGGER IF EXISTS`-ed, and functions use
  `CREATE OR REPLACE`.
- `server_now()` (SECURITY-neutral, STABLE) backs the client clock-skew
  audit; keep EXECUTE granted to `anon`.
- The 12 seeded providers must stay identical (ids, names, order) to
  `src/seed/providers.ts` — `npm run test:unit -- schema-consistency`
  enforces this.

## POPIA & data residency

- **Region:** the Supabase project should be created in **eu-west-1**
  (Ireland), the nearest well-supported region; data therefore leaves South
  Africa.
- **No personal information reaches Supabase.** Observer labels are
  constrained pseudonymous codes (max 12 chars, no spaces — real names like
  “John Smith” are rejected by validation), the location is a fixed text
  label, and events contain no per-vehicle or per-driver identifiers of any
  kind. Under POPIA the stored records are therefore not personal
  information, and the cross-border transfer conditions of **POPIA s72** are
  not triggered by this dataset.
- **Revisit note:** if any personal information is ever added (real names,
  vehicle identifiers, photos, precise observer identities), this position
  must be revisited immediately — s72 transfer safeguards (or an in-country
  region) and the rest of POPIA would then apply. Keep any off-system mapping
  of observer codes to real people out of this repository and under its own
  retention/deletion owner.

**ACSA field protocol:** obtain ACSA/airport-management permission before
observing at the parkade, and follow their instructions on site — this app
deliberately records nothing about individual vehicles or people, only tap
counts per provider.

## Repository map

```
src/lib/sast.ts          single SAST (UTC+2) conversion point — all binning
src/lib/aggregate.ts     client-side aggregation + per-bin session coverage
src/lib/csv.ts           raw-events CSV + coverage CSV serializers
src/adapters/            BackendAdapter contract, stub (default), Supabase
src/queue/               IndexedDB queue, flush, append-only undo
src/sync/engine.ts       foreground-only sync triggers + exponential backoff
src/seed/                seed providers + deterministic synthetic month
supabase/migrations/     0001_init.sql (schema, seed, RLS, grants, triggers)
fixtures/                expected-aggregates.json (checked in, deterministic)
tests/unit/              vitest suites (node + fake-indexeddb)
e2e/                     Playwright suites (chromium, stub backend)
scripts/                 gen-icons.mjs, seed-month.mjs
```
