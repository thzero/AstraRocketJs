import { useTranslation } from 'react-i18next';
import type { ComponentNode, ComponentPosition } from '../../engine/openRocketEngine';
import { UnitChip } from '../common/UnitChip';
import { useUnits } from '../../prefs/useUnits';
import { unitScope } from '../../prefs/units';
import { PANEL_SCOPE_KEYS } from '../../services/componentFields';
import { NumberField } from './DimensionFields';

/**
 * The property panel's placement section: where a nested part sits along its
 * parent tube (the reference method and the offset from it).
 */

/** Placement — only meaningful for parts nested inside a tube. */
export function PlacementSection({
  node,
  onChange,
  onCommit,
}: {
  node: ComponentNode;
  onChange: (patch: Partial<ComponentNode>) => void;
  onCommit?: () => void;
}) {
  const { t } = useTranslation();
  const u = useUnits();
  // The placement offset carries its own unit, like the override rows.
  const offsetScope = unitScope('prop', node.type, PANEL_SCOPE_KEYS[2]);
  const offsetUnit = u.at(offsetScope, 'length');
  const pos = (node.position as ComponentPosition | undefined) ?? { method: 'top', offset: 0 };
  // Discrete controls (select / checkbox / pickers) finish the moment they
  // change, so patch and close the undo entry in one shot.
  const commitChange = (patch: Partial<ComponentNode>) => {
    onChange(patch);
    onCommit?.();
  };

  return (
    <div className="space-y-3 border-t border-white/5 pt-3">
      <label className="flex items-center justify-between gap-3">
        <span className="text-xs text-slate-400">{t('prop.positionFrom')}</span>
        <select
          value={pos.method}
          onChange={(e) =>
            commitChange({ position: { ...pos, method: e.target.value as ComponentPosition['method'] } })
          }
          className="w-32 rounded-md bg-slate-800 px-2 py-1 text-sm text-slate-100 ring-1 ring-white/10 focus:outline-none focus:ring-sky-500"
        >
          {(['top', 'middle', 'bottom', 'absolute'] as const).map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </label>
      <NumberField
        label={t('prop.offset')}
        unit={<UnitChip quantity="length" scope={offsetScope} />}
        value={offsetUnit.toUi(pos.offset)}
        step={offsetUnit.step(0.001)}
        // A negative offset is legal (a part sitting proud of its parent);
        // the bound is in the field's unit so it doesn't shrink in inches.
        min={-offsetUnit.toUi(100)}
        onChange={(v) => onChange({ position: { ...pos, offset: offsetUnit.fromUi(v) } })}
        onCommit={onCommit}
      />
    </div>
  );
}
