import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { ComponentNode } from '../../engine/openRocketEngine';
import { NumberInput } from '../common/NumberInput';
import { UnitChip } from '../common/UnitChip';
import { useUnits } from '../../prefs/useUnits';
import { unitScope } from '../../prefs/units';
import { num } from '../../tree/nodeProps';
import { PANEL_SCOPE_KEYS } from '../../services/componentFields';

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
        <span className="flex items-center gap-2 text-xs text-slate-400">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => {
              onToggle(e.target.checked);
              onCommit?.();
            }}
            className="accent-sky-500"
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
            className="w-24 rounded-md bg-slate-800 px-2 py-1 text-right text-sm text-slate-100 ring-1 ring-white/10 focus:outline-none focus:ring-sky-500 disabled:opacity-40"
          />
          {unit && <span className="min-w-10 text-xs text-slate-500">{unit}</span>}
        </span>
      </label>
      {enabled && (
        <label className="flex items-center gap-2 pl-6 text-[11px] text-slate-500">
          <input
            type="checkbox"
            checked={sub}
            onChange={(e) => {
              onSub(e.target.checked);
              onCommit?.();
            }}
            className="accent-sky-500"
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
    <div className="space-y-3 border-t border-white/5 pt-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{t('override.title')}</div>
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
        onValue={(v) => onChange({ overrideMass: overrideMassUnit.fromUi(v) })}
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
        onValue={(v) => onChange({ overrideCGX: overrideCgUnit.fromUi(v) })}
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
      <p className="text-[11px] leading-snug text-slate-500">{t('override.cpNote')}</p>
    </div>
  );
}
