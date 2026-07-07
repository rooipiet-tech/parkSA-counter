import { describe, expect, it } from 'vitest';
import { freshDb, worker, PIN } from './worker-d1-shim.ts';

/**
 * Worker auth gate (CB-3): the shared PIN is validated server-side BEFORE any
 * DB access. This is real server-side gating, unlike the client-only Supabase
 * anon posture. Filterable via `npm run test:unit -- worker-auth`.
 */
describe('worker-auth gate', () => {
  it('missing bearer PIN => 401', async () => {
    const res = await worker.fetch(new Request('http://worker.test/time'), {
      DB: freshDb(),
      PARKSA_PIN: PIN
    });
    expect(res.status).toBe(401);
  });

  it('wrong bearer PIN => 401', async () => {
    const res = await worker.fetch(
      new Request('http://worker.test/time', { headers: { authorization: 'Bearer 9999' } }),
      { DB: freshDb(), PARKSA_PIN: PIN }
    );
    expect(res.status).toBe(401);
  });

  it('correct bearer PIN => 200', async () => {
    const res = await worker.fetch(
      new Request('http://worker.test/time', { headers: { authorization: `Bearer ${PIN}` } }),
      { DB: freshDb(), PARKSA_PIN: PIN }
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { now: string };
    expect(Number.isNaN(new Date(body.now).getTime())).toBe(false);
  });

  it('x-parksa-pin header is also accepted', async () => {
    const res = await worker.fetch(
      new Request('http://worker.test/time', { headers: { 'x-parksa-pin': PIN } }),
      { DB: freshDb(), PARKSA_PIN: PIN }
    );
    expect(res.status).toBe(200);
  });

  it('a protected write is blocked (401) before any DB access when unauthenticated', async () => {
    const res = await worker.fetch(
      new Request('http://worker.test/events', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ events: [] })
      }),
      { DB: freshDb(), PARKSA_PIN: PIN }
    );
    expect(res.status).toBe(401);
  });

  it('OPTIONS preflight needs no auth and advertises CORS', async () => {
    const res = await worker.fetch(new Request('http://worker.test/events', { method: 'OPTIONS' }), {
      DB: freshDb(),
      PARKSA_PIN: PIN
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });
});
