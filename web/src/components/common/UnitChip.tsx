import { useTranslation } from 'react-i18next';
import { useSettings } from '../../state/SettingsProvider';
import { UNITS, unitFor, type Quantity } from '../../prefs/units';

/**
 * The unit shown beside a value, changeable in place: a borderless <select>
 * styled to read as plain text.
 *
 * It changes THIS FIELD ONLY. `scope` names the field (see `unitScope`), and
 * the choice is stored against that key, so setting a nose cone's Length to
 * inches leaves its Thickness, the tree, the rulers and the stats strip alone.
 * Settings ▸ Units remains the one place that moves everything at once.
 *
 * The choice persists. Picking the Settings default back removes the override
 * rather than storing one that happens to match, so the field goes back to
 * following the preference if that preference later changes.
 *
 * A field showing something other than the default is tinted, so a card with
 * one length in inches among centimetres reads as deliberate rather than as a
 * bug — and so a choice made months ago is findable where it actually matters,
 * not only in the preferences dialog.
 *
 * The accessible name carries the QUANTITY, not just "unit" — a panel can show
 * a dozen of these at once, and a bare "Unit" makes every one of them announce
 * identically to a screen reader.
 */
export function UnitChip({
  quantity,
  scope,
  className = '',
}: {
  quantity: Quantity;
  scope: string;
  className?: string;
}) {
  const { t } = useTranslation();
  const { settings, update } = useSettings();
  const current = unitFor(settings.units, settings.unitOverrides, quantity, scope);
  const overridden = current !== settings.units[quantity];
  return (
    <select
      value={current}
      title={
        overridden
          ? t('units.chipOverridden', { unit: settings.units[quantity] })
          : t('units.chipTitle')
      }
      // The tint is a colour-only cue, which reaches nobody using a screen
      // reader — so the accessible name carries the same fact in words.
      aria-label={
        overridden
          ? t('units.ariaForOverridden', { quantity: t(`units.q.${quantity}`) })
          : t('units.ariaFor', { quantity: t(`units.q.${quantity}`) })
      }
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => {
        const next = { ...settings.unitOverrides };
        if (e.target.value === settings.units[quantity]) delete next[scope];
        else next[scope] = e.target.value;
        update({ unitOverrides: next });
      }}
      className={`cursor-pointer appearance-none bg-transparent text-xs hover:text-sky-400 focus:outline-none focus:ring-1 focus:ring-sky-500 ${
        overridden ? 'font-medium text-amber-400' : 'text-slate-500'
      } ${className}`}
    >
      {UNITS[quantity].map((u) => (
        <option key={u.symbol} value={u.symbol} className="bg-slate-800 text-slate-100">
          {u.symbol}
        </option>
      ))}
    </select>
  );
}
