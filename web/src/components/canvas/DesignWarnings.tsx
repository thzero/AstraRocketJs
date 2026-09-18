import { useTranslation } from 'react-i18next';
import { useWorkspaceStore } from '../../state/store';
import { warningText } from '../../services/warningText';

/**
 * What the engine flagged about the DESIGN itself: a discontinuity between body
 * diameters, a fin tab longer than its root chord, a body tube of zero length.
 *
 * These come back on every rebuild in `StaticInfo.warningTexts` — and, like the
 * flight warnings before them, nothing read the field. It was parsed into the
 * type and dropped, so the app silently withheld the class of warning that
 * OpenRocket shows most often. The message text already carries the offending
 * value and the component's name (`Message.toString()` appends its sources).
 *
 * Sits with the static stats rather than in the part editor: they are facts
 * about the whole rocket, and several of them name a part that is not the one
 * currently selected.
 */
export function DesignWarnings() {
  const { t } = useTranslation();
  const texts = useWorkspaceStore((s) => s.info?.warningTexts);
  if (!texts?.length) return null;

  return (
    <section
      aria-label={t('design.warnings', { count: texts.length })}
      className="mx-3 mb-2 rounded-xl bg-amber-500/10 p-3 ring-1 ring-amber-400/30"
    >
      <div className="mb-1.5 text-[10px] uppercase tracking-wide text-amber-300/80">
        {t('design.warnings', { count: texts.length })}
      </div>
      <ul className="space-y-1">
        {texts.map((text, i) => (
          <li key={`${text}-${i}`} className="flex gap-2 text-xs text-amber-200">
            <span aria-hidden>⚠</span>
            <span className="min-w-0">{warningText(text, t)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
