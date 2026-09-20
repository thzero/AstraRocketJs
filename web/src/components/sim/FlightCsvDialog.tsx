import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettings } from '../../state/SettingsProvider';
import { useUnits } from '../../prefs/useUnits';
import { useFocusTrap } from '../common/useFocusTrap';
import { flightColumns, type FlightColumn } from '../../services/flightColumns';
import { flightDataCsv, CSV_MIME } from '../../services/csvExport';
import { download } from '../../services/saveFile';
import type { FlightResult } from '../../engine/openRocketEngine';

/**
 * What goes in the flight CSV, before it is written — OpenRocket's Export data
 * tab: the variables, the format, the comments and which stage.
 *
 * The button used to download immediately: twelve fixed columns, commas, six
 * significant digits, event comments always on. That is one opinion about a file
 * somebody else has to read, and it could not be argued with.
 *
 * The variable list comes from the RESULT rather than a fixed table, so it shows
 * what this run actually recorded. Series the app has no name for are listed
 * under their kernel symbol, which is what they are called everywhere else.
 */
export function FlightCsvDialog({
  result,
  simName,
  onClose,
}: {
  result: FlightResult;
  simName: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const u = useUnits();
  const { settings, update } = useSettings();
  const ref = useFocusTrap<HTMLDivElement>(true, { onEscape: onClose });
  const saved = settings.flightCsv;

  const branches = result.branches ?? [];
  const [branchIndex, setBranchIndex] = useState(0);
  const columns = useMemo(() => flightColumns(result, branchIndex), [result, branchIndex]);

  // Only keys this run can fill: a saved list may name a series an older or
  // newer build recorded, and offering a column the file cannot fill would be a
  // menu of empty promises.
  const available = new Set(columns.map((c) => c.key));
  const chosen = saved.columns.filter((k) => available.has(k));

  const patch = (p: Partial<typeof saved>) => update({ flightCsv: { ...saved, ...p } });
  const toggle = (key: string) =>
    patch({ columns: chosen.includes(key) ? chosen.filter((k) => k !== key) : [...chosen, key] });

  const name = (c: FlightColumn) => (c.labelKey ? t(c.labelKey) : c.key);
  const unit = (c: FlightColumn) => (c.quantity ? u.sym(c.quantity) : (c.unit ?? ''));

  const onExport = () => {
    const csv = flightDataCsv(result, u.all, { ...saved, columns: chosen, branchIndex, columnName: name }, simName);
    download(`${simName || 'flight'}.csv`, csv, CSV_MIME);
    onClose();
  };

  const box = 'rounded-lg bg-slate-900/60 p-3 ring-1 ring-white/10';
  const label = 'mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400';
  const field = 'rounded-md bg-slate-800 px-2 py-1 text-xs text-slate-100 ring-1 ring-white/10';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4">
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={t('csv.title')}
        className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-xl bg-slate-900 p-4 shadow-2xl ring-1 ring-white/15"
      >
        <h2 className="mb-3 text-sm font-semibold text-slate-100">{t('csv.title')}</h2>

        <div className="grid min-h-0 flex-1 gap-3 md:grid-cols-[1fr_260px]">
          {/* Variables */}
          <div className={`${box} flex min-h-0 flex-col`}>
            <div className={label}>{t('csv.variables')}</div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <table className="w-full text-xs">
                <tbody>
                  {columns.map((c) => (
                    <tr key={c.key} className="border-b border-white/5">
                      <td className="w-8 py-1">
                        <input
                          type="checkbox"
                          checked={chosen.includes(c.key)}
                          onChange={() => toggle(c.key)}
                          aria-label={name(c)}
                          className="accent-sky-500"
                        />
                      </td>
                      <td className="py-1 text-slate-200">{name(c)}</td>
                      <td className="w-16 py-1 text-right text-slate-500">{unit(c)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-2 flex items-center gap-2 border-t border-white/10 pt-2">
              <button className={field} onClick={() => patch({ columns: columns.map((c) => c.key) })}>
                {t('csv.selectAll')}
              </button>
              <button className={field} onClick={() => patch({ columns: [] })}>
                {t('csv.selectNone')}
              </button>
              <span className="text-[11px] text-slate-400">
                {t('csv.count', { count: chosen.length, total: columns.length })}
              </span>
            </div>
          </div>

          {/* Format, comments, stage */}
          <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
            <div className={box}>
              <div className={label}>{t('csv.format')}</div>
              <div className="space-y-2 text-xs text-slate-300">
                <div className="flex items-center justify-between gap-2">
                  <span>{t('csv.separator')}</span>
                  <select
                    className={field}
                    aria-label={t('csv.separator')}
                    value={saved.separator}
                    onChange={(e) => patch({ separator: e.target.value })}
                  >
                    <option value=",">,</option>
                    <option value=";">;</option>
                    <option value="\t">{t('csv.tab')}</option>
                    <option value=" ">{t('csv.space')}</option>
                  </select>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span>{t('csv.decimals')}</span>
                  <input
                    type="number"
                    min={0}
                    max={12}
                    className={`${field} w-16 text-right`}
                    aria-label={t('csv.decimals')}
                    value={saved.decimals}
                    onChange={(e) => patch({ decimals: Math.min(Math.max(Number(e.target.value) || 0, 0), 12) })}
                  />
                </div>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={saved.exponential}
                    onChange={(e) => patch({ exponential: e.target.checked })}
                    className="accent-sky-500"
                  />
                  {t('csv.exponential')}
                </label>
              </div>
            </div>

            <div className={box}>
              <div className={label}>{t('csv.comments')}</div>
              <div className="space-y-2 text-xs text-slate-300">
                {(
                  [
                    ['simDescription', 'csv.simDescription'],
                    ['fieldDescriptions', 'csv.fieldDescriptions'],
                    ['flightEvents', 'csv.flightEvents'],
                  ] as const
                ).map(([key, labelKey]) => (
                  <label key={key} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={saved[key]}
                      onChange={(e) => patch({ [key]: e.target.checked })}
                      className="accent-sky-500"
                    />
                    {t(labelKey)}
                  </label>
                ))}
                <div className="flex items-center justify-between gap-2">
                  <span>{t('csv.commentChar')}</span>
                  <input
                    className={`${field} w-16`}
                    aria-label={t('csv.commentChar')}
                    value={saved.commentChar}
                    onChange={(e) => patch({ commentChar: e.target.value || '#' })}
                  />
                </div>
              </div>
            </div>

            {/* Only a staged flight has a stage to choose. */}
            {branches.length > 1 && (
              <div className={box}>
                <div className={label}>{t('csv.stage')}</div>
                <select
                  className={`${field} w-full`}
                  aria-label={t('csv.stage')}
                  value={branchIndex}
                  onChange={(e) => setBranchIndex(Number(e.target.value))}
                >
                  {branches.map((b, i) => (
                    <option key={i} value={i}>
                      {b.name || `${t('flight.stage')} ${i + 1}`}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>

        <div className="mt-3 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 ring-1 ring-white/10 hover:bg-slate-700"
          >
            {t('common.close')}
          </button>
          <button
            onClick={onExport}
            disabled={!chosen.length}
            className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t('csv.export')}
          </button>
        </div>
      </div>
    </div>
  );
}
