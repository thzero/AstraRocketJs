import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { fmtNum } from '../../i18n/format';
import type { FlightResult } from '../../engine/api';
import { CSV_MIME, flightEventsCsv } from '../../services/csvExport';
import { EVENT_EXTRAS, EVENT_NAME, eventRows, type EventRow, type ExtraKey } from '../../services/flightEvents';
import { download, exportFilename } from '../../services/saveFile';
import { unitScope } from '../../prefs/units';
import { useUnits } from '../../prefs/useUnits';
import { UnitChip } from '../common/UnitChip';

/**
 * The flight as a list you can read DOWN: every event, when it happened, and
 * the state of the rocket at that instant.
 *
 * The charts have always marked the same events as a label strip, which is the
 * right thing on a plot and answers only "when". The numbers that say whether
 * each moment went well — how fast off the rail, how stable it was there, what
 * speed the chute actually saw — were already computed and had nowhere to be
 * read. This is that reading.
 *
 * Its rows are the pure join in services/flightEvents; this file is the markup,
 * the same split aeroTables.ts and AeroComponentTables make.
 *
 * Every branch, interleaved on the one launch clock, because the charts beside
 * it already draw every branch: a booster's landing missing from a table next
 * to a chart that plots it would read as a bug. The stage rides on the row as a
 * chip rather than as a column of its own — this pane is 380px wide, and a
 * fifth column costs more than the single-stage case (where there is no stage
 * to name) can spare.
 */

/** Which columns a value belongs to. The numbers are right-aligned and
 *  tabular so a time or an altitude reads as a column rather than as prose. */
const NUM = 'py-1 pl-2 text-right tabular-nums';

/**
 * The per-event extras, already formatted: the line under an event that says
 * what that particular moment is read for.
 *
 * A sub-line rather than more columns for the reason in EVENT_EXTRAS: only the
 * rail-departure row has a thrust-to-weight worth printing, so a TWR column
 * would be one number and a dozen blanks.
 */
function Extras({ row }: { row: EventRow }) {
  const { t } = useTranslation();
  const u = useUnits();
  // Max-Q shares its unit with the summary tile, so the chip on that tile moves
  // this number too: they are the same figure and would otherwise disagree.
  const q = u.at(unitScope('sim', 'maxQ'), 'pressure');
  const parts = (EVENT_EXTRAS[row.type] ?? []).flatMap((k: ExtraKey) => {
    const v = row[k];
    if (v == null || !Number.isFinite(v)) return [];
    switch (k) {
      case 'stability':
        return [`${fmtNum(v, 2)} ${t('stability.caliber')}`];
      case 'twr':
        return [`${t('flight.twr')} ${fmtNum(v, 1)}`];
      case 'aoa':
        return [`${t('flight.aoa')} ${u.fmt('angle', v, 1)}${u.sym('angle')}`];
      case 'mach':
        return [`${t('flight.mach')} ${fmtNum(v, 2)}`];
      case 'q':
        return [`${q.fmt(v)} ${q.sym}`];
    }
  });
  if (!parts.length) return null;
  return <div className="pb-1 pl-2 text-[10px] leading-snug text-slate-500">{parts.join(' · ')}</div>;
}

export function FlightEventsTable({
  sim,
  simName,
  designName,
}: {
  sim: FlightResult | null;
  simName?: string;
  designName?: string;
}) {
  const { t } = useTranslation();
  const u = useUnits();
  const alt = u.at(unitScope('events', 'altitude'), 'distance');
  const spd = u.at(unitScope('events', 'velocity'), 'velocity');
  const rows = useMemo(() => eventRows(sim), [sim]);
  // Only worth naming a stage when there is more than one; a single-stage
  // flight would otherwise wear a "Stage 1" chip on every row saying nothing.
  const staged = (sim?.branches?.length ?? 0) > 1;
  const stageName = (r: EventRow) => (staged ? r.branchName || `${t('flight.stage')} ${r.branch + 1}` : '');
  if (!sim || !rows.length) return null;

  return (
    <section aria-label={t('flight.events')} className="rounded-xl bg-slate-900 p-3 ring-1 ring-white/10">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[10px] uppercase tracking-wide text-slate-400">{t('flight.events')}</span>
        {/* The file carries EVERY extra as its own column, where the table puts
            them on a sub-line - a spreadsheet wants a rectangle it can sort,
            and it has no 380px to respect. It writes the settings-level units
            rather than this table's own chips, the way every other export in
            the app does: a file outlives the session and often goes to
            somebody else. */}
        <button
          onClick={() =>
            download(
              exportFilename([designName, simName, 'flight-events'], 'csv'),
              flightEventsCsv(rows, u.all, (r) => t(EVENT_NAME[r.type]!), stageName, simName),
              CSV_MIME,
            )
          }
          title={t('flight.eventsCsv')}
          className="shrink-0 rounded-md bg-slate-800 px-2 py-1 text-[11px] font-medium text-slate-200 ring-1 ring-white/10 hover:bg-slate-700"
        >
          ⬇ CSV
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-white/10 text-[10px] uppercase tracking-wide text-slate-400">
              <th scope="col" className="py-1 text-left font-normal">
                {t('flight.event')}
              </th>
              <th scope="col" className="py-1 pl-2 text-right font-normal">
                {t('flight.time')}
              </th>
              {/* The unit lives in the HEADER, not on every row: one chip per
                  column changes the whole column, and a chip per cell would be
                  a dozen identical selects down the table. */}
              <th scope="col" className="py-1 pl-2 text-right font-normal">
                <span className="block">{t('flight.altitude')}</span>
                <UnitChip
                  label={t('flight.altitude')}
                  quantity="distance"
                  scope={unitScope('events', 'altitude')}
                  className="text-[10px]"
                />
              </th>
              <th scope="col" className="py-1 pl-2 text-right font-normal">
                <span className="block">{t('flight.velocity')}</span>
                <UnitChip
                  label={t('flight.velocity')}
                  quantity="velocity"
                  scope={unitScope('events', 'velocity')}
                  className="text-[10px]"
                />
              </th>
            </tr>
          </thead>
          {/* One <tbody> per event, so an extras line is tied to its own row
              rather than floating between two of them — and so a row and its
              detail cannot be split by a zebra stripe or a border. */}
          {rows.map((r) => (
            <tbody key={r.key} className="border-b border-white/5 last:border-0">
              <tr>
                <th scope="row" className="py-1 text-left font-medium text-slate-200">
                  {t(EVENT_NAME[r.type]!)}{' '}
                  {/* The component that raised it: which parachute, which
                      motor. This is how a dual-deploy drogue is told from the
                      main, and a cluster's per-motor burnouts from each other.
                      The {' '} is a real space rather than only the margin,
                      so a row selected and copied out of the table reads
                      "Recovery deployment Drogue" and not one run-on word. */}
                  {r.source && <span className="ml-1 font-normal text-slate-500">{r.source}</span>}{' '}
                  {staged && (
                    <span className="ml-1 whitespace-nowrap rounded bg-slate-800 px-1 text-[10px] font-normal text-slate-400">
                      {stageName(r)}
                    </span>
                  )}
                </th>
                <td className={NUM}>{fmtNum(r.time, 2)}</td>
                <td className={NUM}>{r.altitude != null ? alt.fmt(r.altitude) : '—'}</td>
                <td className={NUM}>{r.velocity != null ? spd.fmt(r.velocity, 1) : '—'}</td>
              </tr>
              <tr>
                <td colSpan={4} className="p-0">
                  <Extras row={r} />
                </td>
              </tr>
            </tbody>
          ))}
        </table>
      </div>
    </section>
  );
}
