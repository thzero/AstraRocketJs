import { useTranslation } from 'react-i18next';

/**
 * What a launch field can be saying about itself, in three levels.
 *
 * REQUIRED (a quiet asterisk, always on) says a flight cannot be computed
 * without this field. It is on whether or not the field is filled, because
 * "which of these do I actually have to fill in?" is a question you ask BEFORE
 * you have left one empty -- a marker that only shows up once something is
 * already wrong cannot answer it.
 *
 * MISSING (the label boxed in red) is that same field, empty. It blocks the run.
 *
 * DIFFERS (the label boxed in amber) is not a fault at all: the value is fine,
 * but the other simulations in the selection hold a different one and typing
 * here will overwrite theirs.
 *
 * Missing outranks differs when a field is both, because it is the one that
 * stops the run; the tooltip still mentions the disagreement.
 *
 * The two states box the LABEL rather than adding a worded badge beside it.
 * A badge reading "DIFFERS" said the same thing twice -- the color already
 * carried it -- while costing more width than the field name itself in a 380px
 * column. Boxing the name is free: the label was going to be drawn anyway.
 * The wording survives where it is not competing for space, in the `title` and
 * in a visually-hidden span, so hovering or reading the page aloud still gets
 * a sentence rather than a color.
 */

/** Classes that turn a field label into a flagged pill. Empty when it is neither. */
const box = (missing?: boolean, mixed?: boolean): string =>
  missing
    ? 'rounded bg-red-500/20 px-1.5 py-0.5 text-red-200 ring-1 ring-red-500/60'
    : mixed
      ? 'rounded bg-amber-500/20 px-1.5 py-0.5 text-amber-200 ring-1 ring-amber-500/50'
      : '';

/**
 * A field's label, boxed when it has something to report.
 *
 * `aria-hidden` on the asterisk with the meaning in a visually-hidden span: a
 * screen reader announcing "asterisk" after every second label is noise, and
 * the convention it stands for is a purely visual one.
 */
export function FieldLabel({
  text,
  required,
  missing,
  mixed,
  className = 'text-xs text-slate-400',
}: {
  text: string;
  required?: boolean;
  missing?: boolean;
  mixed?: boolean;
  /** Typography for the row this label sits in; the pill is layered on top. */
  className?: string;
}) {
  const { t } = useTranslation();
  const why = missing
    ? mixed
      ? `${t('sims.missingField')} ${t('sims.mixedField')}`
      : t('sims.missingField')
    : mixed
      ? t('sims.mixedField')
      : required
        ? t('sims.requiredField')
        : '';
  const flagged = box(missing, mixed);
  return (
    <span className={`${className} ${flagged}`} title={why || undefined}>
      {text}
      {required && !missing && (
        <span className="ml-0.5 align-super text-[10px] leading-none text-red-400/80" aria-hidden>
          *
        </span>
      )}
      {why && <span className="sr-only"> {why}</span>}
    </span>
  );
}

/**
 * Swap a control's resting ring for the flagged one. Applied by REPLACING
 * `ring-white/10` rather than appending, because two `ring-*` utilities in one
 * class list resolve by stylesheet order, not by which came later in the string.
 */
export const markRing = (cls: string, missing?: boolean, mixed?: boolean): string =>
  missing
    ? cls.replace('ring-white/10', 'ring-red-500/70')
    : mixed
      ? cls.replace('ring-white/10', 'ring-amber-500/60')
      : cls;
