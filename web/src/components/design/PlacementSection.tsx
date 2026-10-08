import { useTranslation } from 'react-i18next';
import type { ComponentNode, ComponentPosition } from '../../engine/openRocketEngine';
import { UnitChip } from '../common/UnitChip';
import { useUnits } from '../../prefs/useUnits';
import { onSi } from '../../prefs/entryValue';
import { unitScope } from '../../prefs/units';
import { PANEL_SCOPE_KEYS } from '../../services/design/componentFields';
import { FieldRow, NumberField, sectionFields } from './DimensionFields';
import { PropSection } from './PropSection';

/**
 * The property panel's placement section: WHERE a nested part sits, as
 * against what shape it is. Along the parent tube (the reference method and
 * the offset from it), and around it (the rotation, for the parts that have
 * one).
 *
 * The rotation belongs here, not in the dimension list, which puts a launch lug's
 * angle between its radius and its length and leaves the two names for one idea (a
 * lug's "Angle around body", a fin set's "Base rotation") rows apart in different
 * sections. They are one kernel property: `FinSet.getBaseRotation()` returns
 * `getAngleOffset()`.
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
  const pos = node.position ?? { method: 'top', offset: 0 };
  // Discrete controls (select / checkbox / pickers) finish the moment they
  // change, so patch and close the undo entry in one shot.
  const commitChange = (patch: Partial<ComponentNode>) => {
    onChange(patch);
    onCommit?.();
  };

  const rotations = sectionFields(node, 'placement');

  return (
    <PropSection title={t('prop.placement')}>
      <label className="flex items-center justify-between gap-3">
        <span className="text-xs text-ink-muted">{t('prop.positionFrom')}</span>
        <select
          value={pos.method}
          onChange={(e) =>
            commitChange({ position: { ...pos, method: e.target.value as ComponentPosition['method'] } })
          }
          className="w-32 rounded-md bg-raised px-2 py-1 text-sm text-ink-strong ring-1 ring-line/10 focus:outline-none focus:ring-accent-500"
        >
          {(['top', 'middle', 'bottom', 'absolute'] as const).map((m) => (
            <option key={m} value={m}>
              {t(`positionFrom.${m}`)}
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
        onChange={onSi(offsetUnit, (si) => si !== null && onChange({ position: { ...pos, offset: si } }))}
        onCommit={onCommit}
      />
      {rotations.map((f) => (
        <FieldRow key={f.key} node={node} field={f} onChange={onChange} onCommit={onCommit} />
      ))}
    </PropSection>
  );
}
