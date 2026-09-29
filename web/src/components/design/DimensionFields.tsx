import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { ComponentNode } from '../../engine/openRocketEngine';
import { NumberInput } from '../common/NumberInput';
import { FieldLabel, markRing } from '../common/FieldMark';
import { UnitChip } from '../common/UnitChip';
import { useUnits } from '../../prefs/useUnits';
import { unitScope } from '../../prefs/units';
import { MAX_INSTANCE_COUNT, num, str } from '../../tree/nodeProps';
import { clusterCount } from '../../tree/cluster';
import { shapeIsClippable, shapeParamMax, shapeUsesParameter } from '../../tree/shapeProfile';
import { FIELDS, type Field, type PanelSection } from '../../services/componentFields';
import { DERIVED } from '../../services/derivedFields';

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

/**
 * Whether a declared field APPLIES to this particular node, as opposed to being
 * declared for its type. Every one of these would otherwise be a control that
 * sets a value nothing reads.
 *
 * Shared by `visibleFields` and `sectionFields`, which partition a type's
 * fields between them: a test in only one of the two would hide a row in the
 * dimension list and leave the same row on a section heading.
 */
function applies(node: ComponentNode, f: Field): boolean {
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
  if (f.key === 'shapeParameter') return shapeUsesParameter(defaultShape(node));
  /**
   * Same for the CLIPPED flag. `Transition.isClipped()` returns false outright
   * for a shape that cannot be clipped (conical, ogive, parabolic), so on those
   * the checkbox would set a value the kernel and both views ignore: a control
   * that does nothing.
   */
  if (f.key === 'clipped') return shapeIsClippable(defaultShape(node));
  /**
   * A FILLED part is solid, so it has no wall and no bore. The desktop greys
   * both out; a one-column panel drops them, which also stops the bore row
   * offering to write a thickness the kernel is ignoring.
   */
  if (f.key === 'thickness' || f.key === 'innerDiameter') return node['filled'] !== true;
  /**
   * The cluster's spacing and roll, both ways of stating the spacing, and the
   * angle the group sits at describe where the OTHER tubes go. A single tube
   * has no others: `clusterCount` is 1, every consumer ignores all three, and
   * the rows sat there taking values anyway.
   */
  if (f.key === 'clusterScale' || f.key === 'clusterSeparation' || f.key === 'clusterRotation') {
    return clusterCount(str(node, 'cluster', 'single')) > 1;
  }
  return true;
}

/** The declared fields of this part that the panel shows in its dimension list. */
export function visibleFields(node: ComponentNode, isFirstStage: boolean): Field[] {
  // The top stage separates from nothing above it — hide its separation fields.
  const allFields = node.type === 'stage' && isFirstStage ? [] : (FIELDS[node.type] ?? []);
  return allFields.filter(
    // Sectioned fields are rendered by their own section instead, so the
    // dimension list stays dimensions.
    (f) => f.section === undefined && applies(node, f),
  );
}

/**
 * The declared fields of this part that belong to one named section.
 *
 * Kept next to `visibleFields` because the two PARTITION the type's fields,
 * and a field that fell out of both would simply stop being editable.
 */
export function sectionFields(node: ComponentNode, section: PanelSection): Field[] {
  return (FIELDS[node.type] ?? []).filter((f) => f.section === section && applies(node, f));
}

/**
 * A titled block of fields, separated from what is above it. Renders nothing
 * when the part has no field in that section, so the panel can ask for one
 * unconditionally rather than repeating the type test at the call site.
 *
 * `children` render under the declared rows, for a section that also needs a
 * control the FIELDS table cannot describe — the fillet's material picker.
 */
export function FieldSection({
  node,
  title,
  fields,
  onChange,
  onCommit,
  children,
}: {
  node: ComponentNode;
  title: string;
  fields: Field[];
  onChange: (patch: Partial<ComponentNode>) => void;
  onCommit?: () => void;
  children?: ReactNode;
}) {
  if (!fields.length) return null;
  return (
    <div className="space-y-3 border-t border-white/5 pt-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</h3>
      {fields.map((f) => (
        <FieldRow key={f.key} node={node} field={f} onChange={onChange} onCommit={onCommit} />
      ))}
      {children}
    </div>
  );
}

export function NumberField({
  label,
  unit,
  value,
  step,
  min = 0,
  max,
  required,
  auto,
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
  /**
   * A "follows something else" switch. While it is on the number is derived
   * and the box is read-only, so the checkbox is the control and the box is
   * the readout - rather than a box you can type into whose value is silently
   * overwritten on the next edit.
   */
  auto?: { on: boolean; label: string; title: string; onToggle: (on: boolean) => void };
  onChange: (v: number) => void;
  onCommit?: () => void; // fires on blur — closes the undo entry for this edit
}) {
  const { t } = useTranslation();
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
    // A row, not one big <label>. The switch below is a SECOND control, and a
    // label may only bind to one: wrapping both made the word "Auto" focus the
    // number box rather than tick the box beside it, which is why it could not
    // be worded at all before.
    <div className="flex items-center justify-between gap-2">
      <label className="flex min-w-0 flex-1 items-center justify-between gap-2">
        <FieldLabel text={label} required={required} missing={missing} />
        <span className="flex shrink-0 items-center gap-1">
          <NumberInput
            ariaLabel={label}
            value={Number.isFinite(value) ? value : 0}
            onChange={write}
            onCommit={onCommit}
            step={step}
            min={min}
            max={max}
            disabled={auto?.on}
            className={markRing(
              `w-24 rounded-md px-2 py-1 text-right text-sm ring-1 ring-white/10 focus:outline-none focus:ring-sky-500 ${
                auto?.on ? 'bg-slate-800/50 text-slate-400' : 'bg-slate-800 text-slate-100'
              }`,
              missing,
            )}
          />
          {unit && <span className="min-w-10 text-xs text-slate-500">{unit}</span>}
        </span>
      </label>
      {/* The switch says what it is. It was a bare 13px checkbox at the right
          end of the row with the word only in a `title`, so on a centering ring
          - where BOTH diameters have one - it read as two unexplained ticks,
          and the feature they turn on was reported missing. The accessible name
          keeps the field's own name in front of it ("Outer diameter: Auto"), so
          the two rows are still told apart when the page is read aloud. */}
      {auto && (
        <label
          title={auto.title}
          className="flex shrink-0 cursor-pointer items-center gap-1 text-[11px] leading-none text-slate-400"
        >
          <input
            type="checkbox"
            checked={auto.on}
            onChange={(e) => auto.onToggle(e.target.checked)}
            aria-label={auto.label}
            className="accent-sky-500"
          />
          {t('prop.auto')}
        </label>
      )}
    </div>
  );
}

/**
 * One type-specific field of the selected part, by its declared kind. The kind
 * switch lives here, rather than as inline branches in the panel's render loop,
 * so the panel body reads as a list of rows.
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
  /**
   * Write a converted number to the node, or nothing if the conversion
   * overflowed.
   *
   * `NumberInput` refuses a non-finite ENTRY (see `parseFieldValue`), but a
   * finite entry is not a finite STORED value: the box holds display units and
   * the node holds SI, so 1e306 g/cm3 is 1e309 kg/m3, which is Infinity. That
   * went straight into the node, through the mass and the mesh, and out to the
   * `.ork` as `Infinity` -- which the reader takes back as 0, so the field
   * showed a number the geometry had never had.
   *
   * Every numeric branch below converts, and they are the only place this can
   * happen, so the guard sits on the one way out rather than in each of them.
   * The whole patch is dropped, not the bad key: a `derived` field writes two
   * linked numbers, and half of that pair is worse than neither.
   */
  const patchNumber = (patch: Partial<ComponentNode>) => {
    if (Object.values(patch).some((v) => typeof v === 'number' && !Number.isFinite(v))) return;
    onChange(patch);
  };
  /** The follow-something-else switch for a field that declares one. */
  const autoProp = () =>
    f.auto
      ? {
          auto: {
            on: node[f.auto.flag] === true,
            label: `${label}: ${t('prop.auto')}`,
            title: t(`prop.${f.auto.tip}`),
            onToggle: (on: boolean) => commitChange({ [f.auto!.flag]: on }),
          },
        }
      : {};
  const numeric = (props: {
    unit?: ReactNode;
    value: number;
    step: number;
    min?: number;
    max?: number;
    auto?: { on: boolean; label: string; title: string; onToggle: (on: boolean) => void };
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
    case 'text':
      return (
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-400">{label}</span>
          <textarea
            rows={3}
            value={typeof node[f.key] === 'string' ? (node[f.key] as string) : ''}
            onChange={(e) => onChange({ [f.key]: e.target.value || undefined })}
            onBlur={onCommit}
            className="w-full resize-y rounded-md bg-slate-800 px-2 py-1 text-sm text-slate-100 ring-1 ring-white/10 focus:outline-none focus:ring-sky-500"
          />
        </label>
      );
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
        onChange: (v) => patchNumber({ [f.key]: Math.min(MAX_INSTANCE_COUNT, Math.max(1, Math.round(v))) }),
      });
    case 'mass': {
      const fu = u.at(scope, 'mass');
      return numeric({
        unit: <UnitChip quantity="mass" scope={scope} />,
        value: fu.toUi(num(node, f.key)),
        step: fu.step(0.0005),
        onChange: (v) => patchNumber({ [f.key]: fu.fromUi(v) }),
      });
    }
    case 'distance': {
      const fu = u.at(scope, 'distance');
      return numeric({
        unit: <UnitChip quantity="distance" scope={scope} />,
        value: fu.toUi(num(node, f.key)),
        step: fu.step(f.step ?? 10),
        onChange: (v) => patchNumber({ [f.key]: fu.fromUi(v) }),
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
        ...autoProp(),
        onChange: (v) => patchNumber({ [f.key]: paramMax === undefined ? v : Math.min(paramMax, Math.max(0, v)) }),
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
        onChange: (v) => patchNumber({ [f.key]: fu.fromUi(v) }),
      });
    }
    case 'bore': {
      // A tube's inner diameter, which is not stored: the node and the `.ork`
      // carry the outer radius and the WALL, and the bore is the pair of them.
      // So typing a bore writes the wall back, leaving the outside where it is
      // - the same way OpenRocket's three linked tube fields behave, and the
      // right way round for the job: the outside of a tube is decided by what
      // it has to slide into, and it is the wall that gives.
      //
      // Read through `num` exactly as the thickness row above it does, rather
      // than through the per-type defaults the file services use, so the two
      // rows can never show a wall and a bore that disagree. A wall of zero is
      // already marked as degenerate on its own row; a bore typed all the way
      // out to the outer diameter lands there honestly instead of being nudged
      // off it by an invented minimum.
      const fu = u.at(scope, 'length');
      const outerR = num(node, 'outerRadius');
      const od = 2 * outerR;
      return numeric({
        unit: <UnitChip quantity="length" scope={scope} />,
        value: fu.toUi(Math.max(0, od - 2 * num(node, 'thickness'))),
        step: fu.step(0.0005),
        max: fu.toUi(od),
        onChange: (v) => {
          const bore = Math.max(0, Math.min(od, fu.fromUi(v)));
          // Floored as well as clamped: the unit round trip leaves dust, and a
          // wall of -1.7e-18 is a negative thickness heading for the mass, the
          // mesh and the .ork, none of which check for one.
          patchNumber({ thickness: Math.max(0, (od - bore) / 2) });
        },
      });
    }
    case 'derived': {
      // A second door onto numbers the part DOES store: a fin's sweep as an
      // angle, a streamer's area or aspect ratio, a mass component's density.
      // Nothing here is a node key - the pair of conversions in
      // services/derivedFields.ts reads the stored keys and writes them back,
      // the same arrangement as the `bore` row above, and for the same reason:
      // the arithmetic is the kernel's and belongs somewhere it can be tested.
      const d = DERIVED[f.derived];
      // A bare ratio has no unit group and no chip, so it also has no scope to
      // convert through: it is read and written as itself.
      const fu = d.quantity ? u.at(scope, d.quantity) : undefined;
      const patch = (v: number) => patchNumber(d.write(node, fu ? fu.fromUi(v) : v));
      const value = d.read(node);
      const bound = (v: number | undefined) => (v === undefined ? undefined : Number((fu ? fu.toUi(v) : v).toFixed(6)));
      return numeric({
        unit: d.quantity ? <UnitChip quantity={d.quantity} scope={scope} /> : undefined,
        value: fu ? fu.toUi(value) : value,
        // The spec's own bounds, converted like the value. Snapped, because a
        // bound is a round number by construction and the unit round trip
        // leaves dust on it: 89 degrees came out as 89.00000000000001, which
        // the input then shows as the limit.
        min: bound(d.min?.(node) ?? 0),
        max: bound(d.max?.(node)),
        step: fu ? fu.step(f.step ?? 0.1) : (f.step ?? 0.1),
        onChange: patch,
      });
    }
    default: {
      // length: stored meters, shown in this field's length unit. `diameter`
      // fields are radii in the node and diameters in the box (see FieldFlags):
      // the doubling lives here, at the edit boundary, and nowhere else.
      const fu = u.at(scope, 'length');
      const k = f.diameter ? 2 : 1;
      // `auto`: the value follows something else (a shoulder follows the bore of
      // the tube it plugs into). Ticking it commits at once and the resolver
      // fills the number in the same edit; clearing it pins whatever it now is.
      return numeric({
        unit: <UnitChip quantity="length" scope={scope} />,
        value: fu.toUi(k * num(node, f.key)),
        step: fu.step(0.0005),
        ...autoProp(),
        onChange: (v) => patchNumber({ [f.key]: fu.fromUi(v) / k }),
      });
    }
  }
}
