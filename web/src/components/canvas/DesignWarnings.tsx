import { useLauncherT } from '../common/useLauncher';
import { useUnits } from '../../prefs/useUnits';
import { useWorkspaceStore } from '../../state/store';
import { warningText } from '../../services/app/warningText';

/**
 * What the engine flagged about the design itself: a discontinuity between body
 * diameters, a fin tab longer than its root chord, a body tube of zero length.
 *
 * These come back on every rebuild in `StaticInfo.warningTexts`; they are the
 * class of warning OpenRocket shows most often. The message text already carries the offending
 * value and the component's name (`Message.toString()` appends its sources).
 *
 * Sits with the static stats rather than in the part editor: they are facts
 * about the whole rocket, and several of them name a part that is not the one
 * currently selected.
 */
export function DesignWarnings() {
  const t = useLauncherT();
  const u = useUnits();
  const texts = useWorkspaceStore((s) => s.info?.warningTexts);
  if (!texts?.length) return null;

  return (
    <section
      aria-label={t('design.warnings', { count: texts.length })}
      className="mx-3 mb-2 rounded-xl bg-warn-500/10 p-3 ring-1 ring-warn-400/30"
    >
      <div className="mb-1.5 text-[10px] uppercase tracking-wide text-warn-300/80">
        {t('design.warnings', { count: texts.length })}
      </div>
      <ul className="space-y-1">
        {texts.map((text, i) => (
          <li key={`${text}-${i}`} className="flex gap-2 text-xs text-warn-200">
            <span aria-hidden>⚠</span>
            <span className="min-w-0">{warningText(text, t, (q, si) => u.fmtSym(q, si))}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
