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
   - `VITE_SUPABASE_URL` = *(your backend REST URL — leave unset to run on the stub)*
   - `VITE_SUPABASE_ANON_KEY` = *(your backend anon/publishable key — leave unset for stub)*
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

### B. Cloudflare / Railway (needs a small adapter + backend service)
Cloudflare D1 (SQLite) and bare Railway Postgres are **not** drop-in
Supabase/PostgREST replacements — they need a thin REST backend plus a matching
`BackendAdapter` implementation (the adapter interface is `src/adapters/types.ts`;
the stub in `src/adapters/stub.ts` is the reference implementation). This is a
follow-up build task; the frontend above is unaffected and can go live first.

## Verify a live deploy
Open the URL on a phone, unlock with the PIN, start a session, tap tiles, toggle
airplane mode, tap more, reconnect — the unsynced badge should drain to 0 and the
dashboard should aggregate by hour / day-of-week / provider in SAST.
