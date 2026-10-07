import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { ComponentNode } from '../../engine/openRocketEngine';
import { NumberInput } from '../common/NumberInput';
import { UnitChip } from '../common/UnitChip';
import { useUnits } from '../../prefs/useUnits';
import { onSi } from '../../prefs/entryValue';
import { unitScope } from '../../prefs/units';
import { num } from '../../tree/nodeProps';
import { PANEL_SCOPE_KEYS } from '../../services/design/componentFields';
import { PropSection } from './PropSection';

/**
 * The property panel's override section: the mass / CG / CD overrides
 * (OpenRocket semantics), each an enable box, a value and an
 * "apply to all subcomponents" toggle.
 */

/** One override (mass / CG / CD): an enable checkbox + value, and, once enabled,
 *  an "apply to all subcomponents" toggle (OpenRocket's override-subtree flag). */
function OverrideRow({
  label,
  unit,
  enabled,
  value,
  step,
  onToggle,
  onValue,
  onCommit,
  subLabel,
  sub,
  onSub,
}: {
  label: string;
  unit?: ReactNode;
  enabled: boolean;
  value: number;
  step: number;
  onToggle: (on: boolean) => void;
  onValue: (v: number) => void;
  onCommit?: () => void;
  subLabel: string;
  sub: boolean;
  onSub: (on: boolean) => void;
}) {
  return (
    <div className="space-y-1">
      <label className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-xs text-ink-muted">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => {
              onToggle(e.target.checked);
              onCommit?.();
            }}
            className="accent-accent-500"
          />
          {label}
        </span>
        <span className="flex items-center gap-1">
          <NumberInput
            ariaLabel={label}
            value={Number.isFinite(value) ? value : 0}
            onChange={(v) => onValue(v ?? 0)}
            onCommit={onCommit}
            disabled={!enabled}
            step={step}
            min={0}
            className="w-24 rounded-md bg-raised px-2 py-1 text-right text-sm text-ink-strong ring-1 ring-line/10 focus:outline-none focus:ring-accent-500 disabled:opacity-40"
          />
          {unit && <span className="min-w-10 text-xs text-ink-faint">{unit}</span>}
        </span>
      </label>
      {enabled && (
        <label className="flex items-center gap-2 pl-6 text-[11px] text-ink-faint">
          <input
            type="checkbox"
            checked={sub}
            onChange={(e) => {
              onSub(e.target.checked);
              onCommit?.();
            }}
            className="accent-accent-500"
          />
          {subLabel}
        </label>
      )}
    </div>
  );
}

/** Mass / CG / CD overrides (OpenRocket semantics). A stage-level override
 *  with "all subcomponents" on is the usual way to pin a measured mass/CG. */
export function OverridesSection({
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
  // The rows below the type-specific fields carry their own units too.
  const massOverrideScope = unitScope('prop', node.type, PANEL_SCOPE_KEYS[0]);
  const cgOverrideScope = unitScope('prop', node.type, PANEL_SCOPE_KEYS[1]);
  const overrideMassUnit = u.at(massOverrideScope, 'mass');
  const overrideCgUnit = u.at(cgOverrideScope, 'length');

  return (
    <PropSection title={t('override.title')}>
      <OverrideRow
        label={t('override.mass')}
        unit={<UnitChip quantity="mass" scope={massOverrideScope} />}
        step={overrideMassUnit.step(0.0005)}
        enabled={typeof node.overrideMass === 'number'}
        value={overrideMassUnit.toUi(num(node, 'overrideMass'))}
        onToggle={(on) =>
          onChange({
            overrideMass: on ? Math.max(num(node, 'overrideMass'), 0.01) : undefined,
            overrideSubcomponentsMass: on ? (node.overrideSubcomponentsMass as boolean | undefined) : undefined,
          })
        }
        onValue={onSi(overrideMassUnit, (si) => si !== null && onChange({ overrideMass: si }))}
        onCommit={onCommit}
        subLabel={t('override.applyAll')}
        sub={node.overrideSubcomponentsMass === true}
        onSub={(on) => onChange({ overrideSubcomponentsMass: on || undefined })}
      />
      <OverrideRow
        label={t(node.type === 'stage' ? 'override.cgStage' : 'override.cg')}
        unit={<UnitChip quantity="length" scope={cgOverrideScope} />}
        step={overrideCgUnit.step(0.001)}
        enabled={typeof node.overrideCGX === 'number'}
        value={overrideCgUnit.toUi(num(node, 'overrideCGX'))}
        onToggle={(on) =>
          onChange({
            overrideCGX: on ? num(node, 'overrideCGX') : undefined,
            overrideSubcomponentsCG: on ? (node.overrideSubcomponentsCG as boolean | undefined) : undefined,
          })
        }
        onValue={onSi(overrideCgUnit, (si) => si !== null && onChange({ overrideCGX: si }))}
        onCommit={onCommit}
        subLabel={t('override.applyAll')}
        sub={node.overrideSubcomponentsCG === true}
        onSub={(on) => onChange({ overrideSubcomponentsCG: on || undefined })}
      />
      <OverrideRow
        label={t('override.cd')}
        step={0.05}
        enabled={typeof node.overrideCD === 'number'}
        value={num(node, 'overrideCD')}
        onToggle={(on) =>
          onChange({
            overrideCD: on ? num(node, 'overrideCD') || 0.5 : undefined,
            overrideSubcomponentsCD: on ? (node.overrideSubcomponentsCD as boolean | undefined) : undefined,
          })
        }
        onValue={(v) => onChange({ overrideCD: v })}
        onCommit={onCommit}
        subLabel={t('override.applyAll')}
        sub={node.overrideSubcomponentsCD === true}
        onSub={(on) => onChange({ overrideSubcomponentsCD: on || undefined })}
      />
      <p className="text-[11px] leading-snug text-ink-faint">{t('override.cpNote')}</p>
    </PropSection>
  );
}
