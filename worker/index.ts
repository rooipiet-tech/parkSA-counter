/**
 * ParkSA counter — Cloudflare Worker entry (ES module).
 *
 * REST surface over D1 covering the full BackendAdapter contract. Real
 * server-side auth: every request must carry the shared PIN as
 * `Authorization: Bearer <pin>` or `x-parksa-pin: <pin>`, validated against
 * env.PARKSA_PIN BEFORE any DB access (CB-3). This is stronger than the
 * client-only Supabase anon posture.
 *
 * CORS is enabled for the configured origin (env.ALLOWED_ORIGIN, default '*').
 * Nothing here logs request bodies or the PIN (L-0008 PII posture).
 */
import * as h from './handlers.ts';
import type { D1Like } from './handlers.ts';
import type { Provider, Session, TapEvent, Tombstone } from '../src/lib/types.ts';

export interface Env {
  DB: D1Like;
  PARKSA_PIN?: string;
  ALLOWED_ORIGIN?: string;
}

function corsHeaders(env: Env): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Headers': 'authorization, content-type, x-parksa-pin',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
    'Access-Control-Max-Age': '86400'
  };
}

function json(env: Env, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...corsHeaders(env) }
  });
}

/** Length-checked, constant-time-ish string compare (never short-circuits on
 * content, never logs either operand). */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function extractPin(request: Request): string | null {
  const auth = request.headers.get('authorization');
  if (auth && /^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, '').trim();
  const x = request.headers.get('x-parksa-pin');
  if (x) return x.trim();
  return null;
}

function authorized(request: Request, env: Env): boolean {
  const expected = env.PARKSA_PIN ?? '';
  if (!expected) return false; // fail closed if no secret configured
  const provided = extractPin(request);
  if (provided == null) return false;
  return timingSafeEqual(provided, expected);
}

async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new h.HandlerError('invalid JSON body', 400);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const method = request.method.toUpperCase();

    // CORS preflight — no auth, no DB.
    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(env) });
    }

    // Server-side PIN gate BEFORE any DB access (CB-3).
    if (!authorized(request, env)) {
      return json(env, { error: 'unauthorized' }, 401);
    }

    const db = env.DB;
    const limit = Number(url.searchParams.get('limit') ?? h.PAGE_SIZE) || h.PAGE_SIZE;
    const offset = Number(url.searchParams.get('offset') ?? 0) || 0;

    try {
      // ---- reads ----
      if (method === 'GET') {
        switch (path) {
          case '/time':
            return json(env, { now: h.getServerTime() });
          case '/events':
            return json(env, { rows: await h.listEvents(db, limit, offset) });
          case '/tombstones':
            return json(env, { rows: await h.listTombstones(db, limit, offset) });
          case '/sessions':
            return json(env, { rows: await h.listSessions(db, limit, offset) });
          case '/providers':
            return json(env, { rows: await h.listProviders(db) });
        }
      }

      // ---- writes ----
      if (method === 'POST' || method === 'PUT') {
        switch (path) {
          case '/events': {
            const body = await readJson<{ events: TapEvent[] }>(request);
            await h.insertEvents(db, body.events ?? []);
            return json(env, { ok: true });
          }
          case '/tombstones': {
            const body = await readJson<{ tombstones: Tombstone[] }>(request);
            await h.insertTombstones(db, body.tombstones ?? []);
            return json(env, { ok: true });
          }
          case '/sessions': {
            const body = await readJson<{ session: Session }>(request);
            await h.upsertSession(db, body.session);
            return json(env, { ok: true });
          }
          case '/providers': {
            const body = await readJson<{ provider: Provider }>(request);
            await h.addProvider(db, body.provider);
            return json(env, { ok: true });
          }
          case '/providers/rename': {
            const body = await readJson<{ id: string; name: string }>(request);
            await h.renameProvider(db, body.id, body.name);
            return json(env, { ok: true });
          }
          case '/providers/hide': {
            const body = await readJson<{ id: string; hidden: boolean }>(request);
            await h.setProviderHidden(db, body.id, body.hidden);
            return json(env, { ok: true });
          }
          case '/providers/reorder': {
            const body = await readJson<{ orderedIds: string[] }>(request);
            await h.reorderProviders(db, body.orderedIds ?? []);
            return json(env, { ok: true });
          }
          case '/providers/delete': {
            const body = await readJson<{ id: string }>(request);
            await h.deleteProvider(db, body.id);
            return json(env, { ok: true });
          }
        }
      }

      return json(env, { error: 'not found' }, 404);
    } catch (err) {
      const status = err instanceof h.HandlerError ? err.status : 500;
      const message = err instanceof Error ? err.message : 'internal error';
      return json(env, { error: message }, status);
    }
  }
};
