import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { NumberInput } from '../common/NumberInput';

/**
 * The pieces of a per-configuration override card (recovery deployment, stage
 * separation). Every field falls through: empty means the part's own value on
 * the design, shown as the placeholder or as the "As designed" option, so the
 * control reads as the value the flight will use.
 *
 * Each control is labeled "<part> - <field>": a configuration lists several
 * parts with the same fields, and the part name is what tells them apart.
 */

export const overrideFieldLabel = (name: string, label: string): string => `${name} - ${label}`;

/** The card: the part name, and an Overridden badge when anything differs from the design. */
export function OverrideCard({
  name,
  overridden,
  children,
}: {
  name: string;
  overridden: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <section aria-label={name} className="rounded-xl bg-surface p-3 ring-1 ring-line/10">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className="truncate text-sm font-medium text-ink">{name}</span>
        {overridden && (
          <span className="shrink-0 text-[10px] uppercase tracking-wide text-warn-300">{t('configs.overridden')}</span>
        )}
      </div>
      {children}
    </section>
  );
}

/** One labeled row of a card. */
export function OverrideRow({ label, first, children }: { label: string; first?: boolean; children: ReactNode }) {
  return (
    <label className={`${first ? '' : 'mt-2 '}flex items-center justify-between gap-3`}>
      <span className="text-xs text-ink-muted">{label}</span>
      {children}
    </label>
  );
}

/**
 * An event override. "As designed" is the first option, not a blank: the
 * reader has to be able to tell "follows the design" from a value somebody
 * chose. Picking it reports null.
 */
export function OverrideSelect({
  name,
  label,
  value,
  designed,
  options,
  onChange,
  first,
  width = 'w-40',
}: {
  name: string;
  label: string;
  value: string | null | undefined;
  /** The design's own choice, already translated. */
  designed: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string | null) => void;
  first?: boolean;
  width?: string;
}) {
  const { t } = useTranslation();
  return (
    <OverrideRow label={label} first={first}>
      <select
        value={value ?? ''}
        aria-label={overrideFieldLabel(name, label)}
        onChange={(e) => onChange(e.target.value || null)}
        className={`${width} rounded-md bg-raised px-2 py-1 text-xs text-ink-strong ring-1 ring-line/10 focus:outline-none focus:ring-accent-500`}
      >
        <option value="">{t('configs.asDesigned', { value: designed })}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </OverrideRow>
  );
}

/** A number override in display units, with the design's value as the placeholder. */
export function OverrideNumber({
  name,
  label,
  value,
  placeholder,
  step,
  min,
  unit,
  onChange,
  onCommit,
  first,
}: {
  name: string;
  label: string;
  value: number | null;
  placeholder: string;
  step: number;
  min: number;
  unit: string;
  onChange: (value: number | null) => void;
  onCommit: () => void;
  first?: boolean;
}) {
  return (
    <OverrideRow label={label} first={first}>
      <span className="flex items-center gap-1">
        <NumberInput
          ariaLabel={overrideFieldLabel(name, label)}
          value={value}
          placeholder={placeholder}
          step={step}
          min={min}
          onChange={onChange}
          onCommit={onCommit}
          className="w-24 rounded-md bg-raised px-2 py-1 text-right text-sm text-ink-strong ring-1 ring-line/10 focus:outline-none focus:ring-accent-500"
        />
        <span className="min-w-6 text-xs text-ink-faint">{unit}</span>
      </span>
    </OverrideRow>
  );
}
