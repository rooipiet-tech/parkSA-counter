import type { BackendAdapter } from './types.ts';
import { StubAdapter } from './stub.ts';
import { createSupabaseAdapter } from './supabase.ts';
import { createRestAdapter } from './rest.ts';

/**
 * Backend selection (priority order):
 *   1. RestAdapter  — when VITE_API_URL is set (Cloudflare Worker + D1 backend).
 *      Bearer token is VITE_API_PIN, falling back to VITE_APP_PIN.
 *   2. SupabaseAdapter — when BOTH VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
 *      are present.
 *   3. StubAdapter — the in-memory DEFAULT when nothing is configured.
 */
export function createAdapter(): BackendAdapter {
  const env = (import.meta as { env?: Record<string, string | undefined> }).env ?? {};

  const apiUrl = env.VITE_API_URL;
  if (apiUrl) {
    const pin = env.VITE_API_PIN || env.VITE_APP_PIN || '';
    return createRestAdapter({ baseUrl: apiUrl, pin });
  }

  const url = env.VITE_SUPABASE_URL;
  const anonKey = env.VITE_SUPABASE_ANON_KEY;
  if (url && anonKey) return createSupabaseAdapter(url, anonKey);

  return new StubAdapter();
}

export { StubAdapter } from './stub.ts';
export { RestAdapter } from './rest.ts';
export type { BackendAdapter } from './types.ts';
