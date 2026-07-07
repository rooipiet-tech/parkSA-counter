import { Fragment } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { aggregate, type DateRange } from '../lib/aggregate.ts';
import { DOW_NAMES, eachSastDate, toSastDate } from '../lib/sast.ts';
import type { AppCtx } from '../app-context.ts';
import type { Provider, Session, ServerEvent, Tombstone } from '../lib/types.ts';

interface ServerData {
  events: ServerEvent[];
  tombstones: Tombstone[];
  sessions: Session[];
  providers: Provider[];
}

function download(filename: string, text: string) {
  const blob = new Blob([text], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

type CutKey = number | string;

/**
 * Three grouped rows for one provider in a cut table (AD-4): a combined Total
 * row plus Drop-off and Pick-up rows. Keeping the Total row's cell testids as
 * `cell-<cut>-<pid>-<key>` (unsuffixed) preserves the original combined-count
 * contract; the direction rows add `-dropoff` / `-pickup` suffixes.
 */
function DirRows({
  name,
  keys,
  total,
  dir,
  testid
}: {
  name: string;
  keys: CutKey[];
  total: (key: CutKey) => number;
  dir: (direction: 'dropoff' | 'pickup', key: CutKey) => number;
  testid: (direction: '' | 'dropoff' | 'pickup', key: CutKey) => string;
}) {
  return (
    <Fragment>
      <tr>
        <td rowSpan={3}>{name}</td>
        <td class="dir-label">Total</td>
        {keys.map((k) => (
          <td key={String(k)} data-testid={testid('', k)}>
            {total(k)}
          </td>
        ))}
      </tr>
      <tr>
        <td class="dir-label">Drop-off</td>
        {keys.map((k) => (
          <td key={String(k)} data-testid={testid('dropoff', k)}>
            {dir('dropoff', k)}
          </td>
        ))}
      </tr>
      <tr>
        <td class="dir-label">Pick-up</td>
        {keys.map((k) => (
          <td key={String(k)} data-testid={testid('pickup', k)}>
            {dir('pickup', k)}
          </td>
        ))}
      </tr>
    </Fragment>
  );
}

/**
 * Read-only analysis dashboard: provider x hour-of-day, provider x
 * day-of-week and provider x date over a selectable SAST date range, each cut
 * broken down by direction (drop-off / pick-up / total). No event-mutating
 * controls exist on this view.
 */
export function DashboardView({ ctx }: { ctx: AppCtx }) {
  const today = toSastDate(Date.now());
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [data, setData] = useState<ServerData | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [events, tombstones, sessions, providers] = await Promise.all([
        ctx.adapter.listEvents(),
        ctx.adapter.listTombstones(),
        ctx.adapter.listSessions(),
        ctx.adapter.listProviders()
      ]);
      if (alive) setData({ events, tombstones, sessions, providers });
    })();
    return () => {
      alive = false;
    };
  }, [ctx]);

  const range: DateRange = { from, to };
  const agg = useMemo(
    () =>
      data && from <= to
        ? aggregate(data.events, data.tombstones, data.sessions, data.providers, range)
        : null,
    [data, from, to]
  );

  const dates = from <= to ? eachSastDate(from, to) : [];
  const providers = data?.providers ?? [];

  return (
    <div class="dashboard-view">
      <h2>Dashboard (read-only)</h2>
      <div class="range-controls">
        <label>
          From
          <input
            data-testid="range-from"
            type="date"
            value={from}
            onInput={(e) => setFrom((e.target as HTMLInputElement).value)}
          />
        </label>
        <label>
          To
          <input
            data-testid="range-to"
            type="date"
            value={to}
            onInput={(e) => setTo((e.target as HTMLInputElement).value)}
          />
        </label>
        <button
          data-testid="csv-export"
          onClick={() =>
            void ctx.actions.exportRawCsv(range).then((csv) => download(`parksa-events-${from}-${to}.csv`, csv))
          }
        >
          Export events CSV
        </button>
        <button
          data-testid="coverage-export"
          onClick={() =>
            void ctx.actions
              .exportCoverageCsv(range)
              .then((csv) => download(`parksa-coverage-${from}-${to}.csv`, csv))
          }
        >
          Export coverage CSV
        </button>
      </div>

      {agg && (
        <div class="agg-tables">
          <h3>Totals ({agg.total} events in range, tombstones excluded)</h3>
          <div class="scroll-x">
            <table>
              <thead>
                <tr>
                  <th>Provider</th>
                  <th>Total</th>
                  <th>Drop-off</th>
                  <th>Pick-up</th>
                </tr>
              </thead>
              <tbody>
                {providers.map((p) => (
                  <tr key={p.id}>
                    <td data-testid={`dash-provider-${p.id}`}>{p.name}</td>
                    <td data-testid={`dash-total-${p.id}`}>{agg.totalsByProvider[p.id] ?? 0}</td>
                    <td data-testid={`dash-total-${p.id}-dropoff`}>
                      {agg.totalsByProviderDir[p.id]?.dropoff ?? 0}
                    </td>
                    <td data-testid={`dash-total-${p.id}-pickup`}>
                      {agg.totalsByProviderDir[p.id]?.pickup ?? 0}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3>Provider x hour of day (SAST)</h3>
          <div class="scroll-x">
            <table>
              <thead>
                <tr>
                  <th>Provider</th>
                  <th>Dir</th>
                  {Array.from({ length: 24 }, (_, h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {providers.map((p) => (
                  <DirRows
                    key={p.id}
                    name={p.name}
                    keys={Array.from({ length: 24 }, (_, h) => h)}
                    total={(h) => agg.byHour[p.id]?.[h as number] ?? 0}
                    dir={(d, h) => agg.byHourDir[p.id]?.[d][h as number] ?? 0}
                    testid={(d, h) => `cell-hour-${p.id}-${h}${d ? `-${d}` : ''}`}
                  />
                ))}
              </tbody>
            </table>
          </div>

          <h3>Provider x day of week (SAST)</h3>
          <div class="scroll-x">
            <table>
              <thead>
                <tr>
                  <th>Provider</th>
                  <th>Dir</th>
                  {DOW_NAMES.map((d) => (
                    <th key={d}>{d.slice(0, 3)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {providers.map((p) => (
                  <DirRows
                    key={p.id}
                    name={p.name}
                    keys={DOW_NAMES.map((_, d) => d)}
                    total={(d) => agg.byDow[p.id]?.[d as number] ?? 0}
                    dir={(dir, d) => agg.byDowDir[p.id]?.[dir][d as number] ?? 0}
                    testid={(dir, d) => `cell-dow-${p.id}-${d}${dir ? `-${dir}` : ''}`}
                  />
                ))}
              </tbody>
            </table>
          </div>

          <h3>Provider x date (SAST)</h3>
          <div class="scroll-x">
            <table>
              <thead>
                <tr>
                  <th>Provider</th>
                  <th>Dir</th>
                  {dates.map((d) => (
                    <th key={d}>{d.slice(5)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {providers.map((p) => (
                  <DirRows
                    key={p.id}
                    name={p.name}
                    keys={dates}
                    total={(d) => agg.byDate[p.id]?.[d as string] ?? 0}
                    dir={(dir, d) => agg.byDateDir[p.id]?.[dir][d as string] ?? 0}
                    testid={(dir, d) => `cell-date-${p.id}-${d}${dir ? `-${dir}` : ''}`}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
