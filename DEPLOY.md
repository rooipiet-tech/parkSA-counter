# Deploying ParkSA counter

The app is a static Vite PWA + a pluggable backend adapter. It runs on an
in-memory **stub** adapter when no backend env vars are set, and on a real
backend when they are. PWA install, the service worker, and `crypto.randomUUID`
require **HTTPS** (any host below provides it) or `localhost`.

## Frontend → Vercel (one-time git import)

1. In Vercel, **Add New → Project → Import** `rooipiet-tech/parkSA-counter`.
2. Framework preset auto-detects **Vite** (`vercel.json` pins it).
3. Set **Environment Variables** (Project → Settings → Environment Variables):
   - `VITE_APP_PIN` = `1234`  *(baked into the client bundle; low-friction gate, not a secret — rotate anytime)*
   - **Cloudflare backend (option B):** `VITE_API_URL` = *(your Worker `…workers.dev` URL)* and `VITE_API_PIN` = `1234` *(bearer PIN, falls back to `VITE_APP_PIN`)*
   - **Supabase backend (option A):** `VITE_SUPABASE_URL` = *(project REST URL)* and `VITE_SUPABASE_ANON_KEY` = *(anon/publishable key)*
   - Leave all backend vars unset to run on the in-memory **stub**. Selection
     priority: `VITE_API_URL` (Cloudflare) → Supabase pair → stub.
4. **Deploy.** Every push to the branch redeploys automatically.

> With the Supabase vars **unset**, the deployed app uses the in-memory stub:
> good for previewing the UI and installing the PWA on a phone, but taps do not
> sync or persist server-side. Set both vars to a real backend for field use.

## Backend options

The shipped `SupabaseAdapter` (`src/adapters/supabase.ts`) speaks the
Supabase/PostgREST REST API and the schema lives in
`supabase/migrations/0001_init.sql` (RLS, column-limited session updates,
permanent-provider guard, `server_now()`). To wire a real backend:

### A. Managed Supabase (zero new code)
Requires a free project slot. The org `rooipiet-tech's Org` is at its 2-project
free limit, so either free a slot (pause/upgrade an existing project — **not**
the two in-use ones) or create a **second free Supabase org**. Then:
`apply supabase/migrations/0001_init.sql`, copy the project URL + anon key into
the Vercel env vars above, redeploy. **Do not** deploy this schema into either
existing in-use project.

### B. Cloudflare Worker + D1 (shipped adapter — recommended free option)

A complete REST backend for Cloudflare lives in `worker/` (Worker `worker/index.ts`
+ pure handlers `worker/handlers.ts` + D1/SQLite schema `worker/migrations/0001_init.sql`),
with a matching frontend adapter `src/adapters/rest.ts`. It implements the full
`BackendAdapter` contract server-side (idempotent event/tombstone inserts,
session end-fields-only updates, provider add/rename/hide/reorder with the
permanent-provider guard, paginated reads, server time) and enforces a shared
PIN **server-side** (unlike the client-only Supabase anon posture).

Runbook (from the repo root, under your own Cloudflare account):

```bash
npm i -g wrangler            # or prefix each command below with `npx`
wrangler login              # opens a browser to authorise

wrangler d1 create parksa   # prints a database_id — paste it into wrangler.toml
                            # ([[d1_databases]] database_id = "…")

wrangler d1 migrations apply parksa --remote   # creates tables + seeds 12 providers

wrangler secret put PARKSA_PIN                 # enter 1234 (must match VITE_API_PIN)

wrangler deploy             # prints the https://parksa-counter-api.<sub>.workers.dev URL
```

Then in **Vercel → Project → Settings → Environment Variables** set:

- `VITE_API_URL` = the `https://…workers.dev` URL printed by `wrangler deploy`
- `VITE_API_PIN` = `1234` (the bearer PIN; the app falls back to `VITE_APP_PIN`
  when this is unset)

and **redeploy**. With `VITE_API_URL` set the app selects `RestAdapter`
(`src/adapters/index.ts`); leave it unset to fall back to Supabase-or-stub. To
lock CORS to your site, set `ALLOWED_ORIGIN` in `wrangler.toml` `[vars]` to your
Vercel origin (default `*`) and redeploy the Worker.

> **Security & privacy note.** The bearer PIN is bundled in the client bundle —
> it is a shared low-friction token, **not** a secret — but the Worker enforces
> it server-side (`Authorization: Bearer <pin>` or `x-parksa-pin`) and rejects
> every request with a missing/wrong PIN with `401` **before any DB access**.
> The Worker stores **no personal data**: only pseudonymous observer codes,
> a fixed location label and per-provider tap counts (no vehicle/driver
> identifiers), and it logs neither request bodies nor the PIN.

## Applying the drop-off / pick-up migration to an already-deployed backend

The two-colour tile split (each provider tap is recorded as a **drop-off** or a
**pick-up**) adds a single `direction` column to the `events` table. It is
delivered as an **additive** migration, so an already-deployed backend is
upgraded in place with **no data loss** — every pre-existing row defaults to
`'dropoff'`.

- **Cloudflare D1** — run the migrations command again from the repo root; the
  runner tracks `0001` as applied and executes only the new file
  `worker/migrations/0002_direction.sql`:

  ```bash
  wrangler d1 migrations apply parksa --remote   # picks up 0002_direction
  wrangler deploy                                # redeploy the Worker code
  ```

- **Supabase** — apply `supabase/migrations/0002_direction.sql`
  (`ALTER TABLE events ADD COLUMN direction text NOT NULL DEFAULT 'dropoff'
  CHECK (direction IN ('dropoff','pickup'))`) to the existing project. The anon
  INSERT policy already covers the new column and events stay append-only.

Both are **additive and reversible**: to roll back, run
`ALTER TABLE events DROP COLUMN direction;`. No frontend env vars change.

### C. Railway / other Postgres (needs its own adapter)
Bare Railway Postgres is **not** a drop-in Supabase/PostgREST replacement — it
would need a thin REST backend plus a matching `BackendAdapter` implementation
(interface: `src/adapters/types.ts`; reference semantics: `src/adapters/stub.ts`;
the Cloudflare `worker/` + `src/adapters/rest.ts` pair is a worked example).

## Verify a live deploy
Open the URL on a phone, unlock with the PIN, start a session, tap tiles, toggle
airplane mode, tap more, reconnect — the unsynced badge should drain to 0 and the
dashboard should aggregate by hour / day-of-week / provider in SAST.
