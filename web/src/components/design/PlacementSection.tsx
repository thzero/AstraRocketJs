import { useTranslation } from 'react-i18next';
import type { ComponentNode, ComponentPosition } from '../../engine/openRocketEngine';
import { UnitChip } from '../common/UnitChip';
import { useUnits } from '../../prefs/useUnits';
import { onSi } from '../../prefs/entryValue';
import { unitScope } from '../../prefs/units';
import { PANEL_SCOPE_KEYS } from '../../services/design/componentFields';
import { FieldRow, NumberField, sectionFields, type NodeEditProps } from './DimensionFields';
import { PropSection } from './PropSection';
import { useWorkspaceStore } from '../../state/store';
import { findParent } from '../../services/design/treeEdit';
import { axialFrameOf, rebasePosition } from '../../tree/axialRebase';
import { axialLength } from '../../tree/position';
import { positionOf } from '../../tree/nodeProps';

/**
 * The property panel's placement section: where a nested part sits, as
 * against what shape it is. Along the parent tube (the reference method and
 * the offset from it), and around it (the rotation, for the parts that have
 * one).
 *
 * The rotation belongs here, not in the dimension list, so a lug's "Angle around
 * body" and a fin set's "Base rotation" sit in the same section. They are one
 * kernel property: `FinSet.getBaseRotation()` returns `getAngleOffset()`.
 */

/** Placement: only meaningful for parts nested inside a tube. */
export function PlacementSection({ node, onChange, onCommit }: NodeEditProps) {
  const { t } = useTranslation();
  const u = useUnits();
  // The placement offset carries its own unit, like the override rows.
  const offsetScope = unitScope('prop', node.type, PANEL_SCOPE_KEYS[2]);
  const offsetUnit = u.at(offsetScope, 'length');
  // As the kernel places it: a part with no position keeps its constructor's.
  const pos = positionOf(node);
  // Discrete controls (select / checkbox / pickers) finish the moment they
  // change, so patch and close the undo entry in one shot.
  const commitChange = (patch: Partial<ComponentNode>) => {
    onChange(patch);
    onCommit?.();
  };

  const rotations = sectionFields(node, 'placement');

  // A new reference keeps the part where it is, as the kernel's
  // setAxialMethod does: the offset is re-measured, not carried over.
  const changeMethod = (method: ComponentPosition['method']) => {
    const tree = useWorkspaceStore.getState().tree;
    const parent = node.id ? findParent(tree, node.id) : null;
    const frame = parent?.id ? axialFrameOf(tree, parent.id) : null;
    commitChange({
      position: frame ? rebasePosition(pos, method, axialLength(node), frame) : { ...pos, method },
    });
  };

  return (
    <PropSection title={t('prop.placement')}>
      <label className="flex items-center justify-between gap-3">
        <span className="text-xs text-ink-muted">{t('prop.positionFrom')}</span>
        <select
          value={pos.method}
          onChange={(e) => changeMethod(e.target.value as ComponentPosition['method'])}
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
