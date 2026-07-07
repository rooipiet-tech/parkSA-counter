import type { BackendAdapter } from './types.ts';
import { StubAdapter } from './stub.ts';
import { createSupabaseAdapter } from './supabase.ts';

/**
 * Backend selection: the in-memory stub is the DEFAULT. The real Supabase
 * adapter is only used when BOTH VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
 * are present at build time.
 */
export function createAdapter(): BackendAdapter {
  const env = (import.meta as { env?: Record<string, string | undefined> }).env ?? {};
  const url = env.VITE_SUPABASE_URL;
  const anonKey = env.VITE_SUPABASE_ANON_KEY;
  if (url && anonKey) return createSupabaseAdapter(url, anonKey);
  return new StubAdapter();
}

export { StubAdapter } from './stub.ts';
export type { BackendAdapter } from './types.ts';
