import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { ComponentNode } from '../../engine/openRocketEngine';
import { NumberInput } from '../common/NumberInput';
import { FieldLabel, markRing } from '../common/FieldMark';
import { UnitChip } from '../common/UnitChip';
import { useUnits } from '../../prefs/useUnits';
import { unitScope } from '../../prefs/units';
import { MAX_INSTANCE_COUNT, num, str } from '../../tree/nodeProps';
import { shapeParamMax, shapeUsesParameter } from '../../tree/shapeProfile';
import { FIELDS, type Field } from '../../services/componentFields';

/**
 * The property panel's per-type shape and dimension fields: the numeric row
 * every section builds on (`NumberField`), the field-kind switch that renders
 * one declared `Field` (`FieldRow`), and the filter that picks which of a
 * part's declared fields to show (`visibleFields`).
 */

/**
 * The shape a nose cone or transition falls back to when the node carries
 * none: what `shapeUsesParameter` and `shapeParamMax` are asked about. It was
 * spelled out twice, in the field filter and the shape-parameter field.
 */
const defaultShape = (node: ComponentNode): string =>
  str(node, 'shape', node.type === 'nosecone' ? 'ogive' : 'conical');

/** The declared fields of this part that the panel shows. */
export function visibleFields(node: ComponentNode, isFirstStage: boolean): Field[] {
  // The top stage separates from nothing above it — hide its separation fields.
  const allFields = node.type === 'stage' && isFirstStage ? [] : (FIELDS[node.type] ?? []);
  /**
   * Drop the shape parameter for shapes that do not use one.
   *
   * The field did not exist at all before: `shapeParameter` was READ by the
   * mesh, report, schematic, 3D view and both .ork paths but written by
   * nothing, so a power/haack/ogive/parabolic nose imported from a file
   * carried a parameter that changes its whole profile, that the user could
   * see the effect of and never edit, and that round-tripping froze at
   * whatever the file said. `shapeUsesParameter` was the exported, tested
   * helper that would have gated it, with zero production callers.
   */
  return allFields.filter((f) => f.key !== 'shapeParameter' || shapeUsesParameter(defaultShape(node)));
}

export function NumberField({
  label,
  unit,
  value,
  step,
  min = 0,
  max,
  required,
  onChange,
  onCommit,
}: {
  label: string;
  unit?: ReactNode;
  value: number;
  step: number;
  min?: number;
  /** Upper bound, forwarded to the input so the spinner respects it too. */
  max?: number;
  /** A zero here is degenerate geometry — see the `Field` type. */
  required?: boolean;
  onChange: (v: number) => void;
  onCommit?: () => void; // fires on blur — closes the undo entry for this edit
}) {
  // No separate "blank" state to check for: 0 is exactly what is wrong here, so
  // an emptied box and a typed zero collapse into one condition.
  const missing = required && !(Number.isFinite(value) && value > 0);
  /**
   * An empty REQUIRED box writes nothing at all.
   *
   * Not a focus trap -- you can still tab away, which a trap would forbid
   * (WCAG 2.1.2) and which would fight anyone clearing a field to retype it.
   * The input keeps its own draft string while focused, so the box still LOOKS
   * empty as you type; it is only the commit that is withheld. Blur then shows
   * the value that was already there. So the accidental path to a zero is gone
   * entirely, while a deliberately typed 0 still lands, still goes red, and is
   * still refused by the run.
   */
  const write = (v: number | null) => {
    if (v === null && required) return;
    onChange(v ?? 0);
  };
  return (
    <label className="flex items-center justify-between gap-3">
      <FieldLabel text={label} required={required} missing={missing} />
      <span className="flex items-center gap-1">
        <NumberInput
          ariaLabel={label}
          value={Number.isFinite(value) ? value : 0}
          onChange={write}
          onCommit={onCommit}
          step={step}
          min={min}
          max={max}
          className={markRing(
            'w-24 rounded-md bg-slate-800 px-2 py-1 text-right text-sm text-slate-100 ring-1 ring-white/10 focus:outline-none focus:ring-sky-500',
            missing,
          )}
        />
        {unit && <span className="min-w-10 text-xs text-slate-500">{unit}</span>}
      </span>
    </label>
  );
}

/**
 * One type-specific field of the selected part, by its declared kind. Six
 * inline branches used to build the same NumberField in the panel's render
 * loop; the kind switch lives here so the panel body reads as a list of rows.
 */
export function FieldRow({
  node,
  field: f,
  onChange,
  onCommit,
}: {
  node: ComponentNode;
  field: Field;
  onChange: (patch: Partial<ComponentNode>) => void;
  onCommit?: () => void;
}) {
  const { t } = useTranslation();
  const u = useUnits();
  const label = t(`prop.${f.label}`);
  // One scope per field of this component TYPE: every body tube is the
  // same Length field on the same card, so selecting another must not
  // forget the unit just set on it, but a nose cone's Length is its own.
  const scope = unitScope('prop', node.type, f.key);
  // Discrete controls finish the moment they change, so patch and close the
  // undo entry in one shot.
  const commitChange = (patch: Partial<ComponentNode>) => {
    onChange(patch);
    onCommit?.();
  };
  const numeric = (props: {
    unit?: ReactNode;
    value: number;
    step: number;
    min?: number;
    max?: number;
    onChange: (v: number) => void;
  }) => <NumberField label={label} required={f.required} onCommit={onCommit} {...props} />;

  switch (f.kind) {
    case 'select': {
      const cur = typeof node[f.key] === 'string' ? (node[f.key] as string) : f.options[0];
      return (
        <label className="flex items-center justify-between gap-3">
          <span className="text-xs text-slate-400">{label}</span>
          <select
            value={cur}
            onChange={(e) => commitChange({ [f.key]: e.target.value })}
            className="w-32 rounded-md bg-slate-800 px-2 py-1 text-sm text-slate-100 ring-1 ring-white/10 focus:outline-none focus:ring-sky-500"
          >
            {f.options.map((o) => (
              <option key={o} value={o}>
                {f.optLabel ? f.optLabel(o, t) : f.optI18n ? t(`${f.optI18n}.${o}`) : o}
              </option>
            ))}
          </select>
        </label>
      );
    }
    case 'bool':
      return (
        <label className="flex items-center justify-between gap-3">
          <span className="text-xs text-slate-400">{label}</span>
          <input
            type="checkbox"
            checked={node[f.key] === true}
            onChange={(e) => commitChange({ [f.key]: e.target.checked })}
            className="accent-sky-500"
          />
        </label>
      );
    case 'count':
      return numeric({
        value: num(node, f.key),
        step: 1,
        min: 1,
        max: MAX_INSTANCE_COUNT,
        // Clamped at the SOURCE as well as in every consumer: the field had a
        // floor and no ceiling, so the count reached the node and was
        // persisted and exported before any renderer saw it.
        onChange: (v) => onChange({ [f.key]: Math.min(MAX_INSTANCE_COUNT, Math.max(1, Math.round(v))) }),
      });
    case 'mass': {
      const fu = u.at(scope, 'mass');
      return numeric({
        unit: <UnitChip quantity="mass" scope={scope} />,
        value: fu.toUi(num(node, f.key)),
        step: fu.step(0.0005),
        onChange: (v) => onChange({ [f.key]: fu.fromUi(v) }),
      });
    }
    case 'distance': {
      const fu = u.at(scope, 'distance');
      return numeric({
        unit: <UnitChip quantity="distance" scope={scope} />,
        value: fu.toUi(num(node, f.key)),
        step: fu.step(f.step ?? 10),
        onChange: (v) => onChange({ [f.key]: fu.fromUi(v) }),
      });
    }
    case 'number': {
      // The shape parameter has a shape-dependent ceiling the kernel enforces
      // (Shape.maxParameter: haack tops out at LV-Haack, 1/3). `shapeParamMax`
      // is the tested port of it.
      const paramMax = f.key === 'shapeParameter' ? shapeParamMax(defaultShape(node)) : undefined;
      return numeric({
        unit: f.unit,
        value: num(node, f.key),
        step: f.step ?? 0.1,
        max: paramMax,
        onChange: (v) => onChange({ [f.key]: paramMax === undefined ? v : Math.min(paramMax, Math.max(0, v)) }),
      });
    }
    case 'angle': {
      // Stored in radians (kernel/.ork convention), edited in the user's unit.
      const fu = u.at(scope, 'angle');
      return numeric({
        unit: <UnitChip quantity="angle" scope={scope} />,
        // Half a turn either way, in whatever unit is selected: a fixed -180
        // would clamp a radian entry to well inside its legal range.
        min: -fu.toUi(Math.PI),
        step: fu.step(((f.step ?? 5) * Math.PI) / 180),
        value: fu.toUi(num(node, f.key)),
        onChange: (v) => onChange({ [f.key]: fu.fromUi(v) }),
      });
    }
    default: {
      // length: stored meters, shown in this field's length unit
      const fu = u.at(scope, 'length');
      return numeric({
        unit: <UnitChip quantity="length" scope={scope} />,
        value: fu.toUi(num(node, f.key)),
        step: fu.step(0.0005),
        onChange: (v) => onChange({ [f.key]: fu.fromUi(v) }),
      });
    }
  }
}
