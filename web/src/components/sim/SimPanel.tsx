import { useTranslation } from 'react-i18next';
import type { StaticInfo, FlightResult } from '../../engine/api';
import { SimSummary } from './SimSummary';

/** Run button + the active simulation's summary tiles (see {@link SimSummary}). */
export function SimPanel({
  info,
  runLabel,
  sim,
  busy,
  onRun,
  blockReason,
}: {
  info: StaticInfo | null;
  runLabel: string;
  sim: FlightResult | null;
  busy: boolean;
  onRun: () => void;
  /** When set, the design can't be simulated (no mount / no motor): the reason
   *  is shown and the Run button is disabled. */
  blockReason?: string | null;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4 p-3">
      <button
        onClick={onRun}
        disabled={busy || !info || !!blockReason}
        className="w-full rounded-xl bg-sky-600 py-3 font-semibold text-white disabled:opacity-50"
      >
        {busy ? t('sim.running') : t('sim.run', { name: runLabel })}
      </button>

      {blockReason && !busy && (
        <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-center text-sm text-amber-300 ring-1 ring-amber-400/30">
          ⚠ {blockReason}
        </p>
      )}

      <SimSummary sim={sim} />
      {!sim?.summary && !busy && !blockReason && (
        <p className="text-center text-sm text-slate-500">{t('sim.prompt')}</p>
      )}
    </div>
  );
}
