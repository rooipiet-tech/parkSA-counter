import type { Provider } from '../lib/types.ts';

/**
 * The 12 seed providers, in goal order, with STABLE ids.
 * Must stay identical (ids, names, order) to the seed block in
 * supabase/migrations/0001_init.sql — enforced by tests/unit/schema-consistency.test.ts.
 * 'Unknown' is last and permanent: it can never be hidden or deleted.
 */
export const SEED_PROVIDERS: Provider[] = [
  { id: 'first-class-parking', name: 'First Class Parking', sort_order: 1, hidden: false, is_permanent: false },
  { id: 'or-tambo-parking-services', name: 'OR Tambo Parking Services', sort_order: 2, hidden: false, is_permanent: false },
  { id: 'express-airport-parking', name: 'Express Airport Parking', sort_order: 3, hidden: false, is_permanent: false },
  { id: 'dynamic-airport-parking', name: 'Dynamic Airport Parking', sort_order: 4, hidden: false, is_permanent: false },
  { id: 'mr-parking', name: 'Mr Parking', sort_order: 5, hidden: false, is_permanent: false },
  { id: 'safe-car', name: 'Safe Car', sort_order: 6, hidden: false, is_permanent: false },
  { id: 'e-parking', name: 'E Parking', sort_order: 7, hidden: false, is_permanent: false },
  { id: 'eazypark', name: 'EazyPark', sort_order: 8, hidden: false, is_permanent: false },
  { id: 'absolute-valet', name: 'Absolute Valet', sort_order: 9, hidden: false, is_permanent: false },
  { id: 'faith-airport-parking', name: 'Faith Airport Parking', sort_order: 10, hidden: false, is_permanent: false },
  { id: 'valet-airport-parking-services', name: 'Valet Airport Parking Services', sort_order: 11, hidden: false, is_permanent: false },
  { id: 'unknown', name: 'Unknown', sort_order: 12, hidden: false, is_permanent: true }
];
