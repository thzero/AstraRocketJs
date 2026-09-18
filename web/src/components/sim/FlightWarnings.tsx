import { useTranslation } from 'react-i18next';
import type { FlightResult } from '../../engine/api';
import { warningText, warningHelp } from '../../services/warningText';

/** HIGH reads as a problem, the rest as a note. Never color alone: every row
 *  carries the warning glyph and its own text. */
const TONE: Record<string, string> = {
  HIGH: 'bg-red-500/10 text-red-300 ring-red-400/30',
  NORMAL: 'bg-amber-500/10 text-amber-200 ring-amber-400/30',
  LOW: 'bg-slate-800 text-slate-300 ring-white/10',
};

/**
 * What the kernel flagged about this flight: a recovery device out too fast, a
 * large angle of attack, no recovery device at all.
 *
 * The engine has exported these for a while and NOTHING read them — the field
 * was parsed into the type and dropped on the floor, so the deployment-speed
 * thresholds could be tuned all day without a user ever seeing their output.
 * This is the other half of those settings.
 */
export function FlightWarnings({ sim }: { sim: FlightResult | null }) {
  const { t } = useTranslation();
  const warnings = sim?.warnings ?? [];
  if (!sim || !warnings.length) return null;

  return (
    <section className="rounded-xl bg-slate-900 p-3 ring-1 ring-white/10">
      <div className="mb-2 text-[10px] uppercase tracking-wide text-slate-400">
        {t('sim.warnings', { count: warnings.length })}
      </div>
      <ul className="space-y-1.5">
        {warnings.map((w, i) => {
          // What it MEANS, not just what tripped. A deployment-speed warning
          // that does not say what a fast deployment does to the airframe is a
          // number the reader has to already understand in order to act on.
          const help = warningHelp(w.message, t);
          return (
            <li
              key={`${w.key}-${i}`}
              className={`flex gap-2 rounded-lg px-2.5 py-1.5 text-xs ring-1 ${TONE[w.priority ?? 'NORMAL'] ?? TONE.NORMAL}`}
            >
              <span aria-hidden>⚠</span>
              <span className="min-w-0">
                <span className="font-medium">{warningText(w.message, t)}</span>
                {help && <span className="mt-1 block font-normal leading-snug opacity-80">{help}</span>}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
