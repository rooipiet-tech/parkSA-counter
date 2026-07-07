/**
 * `npm run seed:month` — regenerates fixtures/expected-aggregates.json from
 * the deterministic seed month (src/seed/month.ts). The fixture is checked
 * in; unit and e2e tests compare live aggregation output against it.
 * Runs on plain Node 22+ (native TypeScript type stripping).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateMonth, SEED_MONTH_RANGE } from '../src/seed/month.ts';
import { aggregate } from '../src/lib/aggregate.ts';
import { exportCsv } from '../src/lib/csv.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const month = generateMonth();

const agg = aggregate(month.events, month.tombstones, month.sessions, month.providers, {
  from: SEED_MONTH_RANGE.from,
  to: SEED_MONTH_RANGE.to
});

const csv = exportCsv({
  events: month.events,
  tombstones: month.tombstones,
  providers: month.providers,
  range: { from: SEED_MONTH_RANGE.from, to: SEED_MONTH_RANGE.to }
});

const fixture = {
  range: { from: SEED_MONTH_RANGE.from, to: SEED_MONTH_RANGE.to },
  eventCount: month.events.length,
  tombstoneCount: month.tombstones.length,
  sessionCount: month.sessions.length,
  csvRowCount: csv.trimEnd().split('\n').length - 1, // data rows (excl. header)
  byHour: agg.byHour,
  byDow: agg.byDow,
  byDate: agg.byDate,
  coverage: agg.coverage,
  total: agg.total,
  totalsByProvider: agg.totalsByProvider
};

const outDir = join(root, 'fixtures');
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, 'expected-aggregates.json');
writeFileSync(outFile, JSON.stringify(fixture, null, 2) + '\n');
console.log(
  `wrote ${outFile}: ${fixture.eventCount} events, ${fixture.tombstoneCount} tombstones, ${fixture.sessionCount} sessions`
);
