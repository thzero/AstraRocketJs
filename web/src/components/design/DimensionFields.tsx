import { useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { ComponentNode } from '../../engine/openRocketEngine';
import { NumberInput } from '../common/NumberInput';
import { FieldLabel, markRing } from '../common/FieldMark';
import { UnitChip } from '../common/UnitChip';
import { useUnits, type FieldUnit } from '../../prefs/useUnits';
import { clampEntry } from '../../prefs/entryValue';
import { unitScope, type Quantity } from '../../prefs/units';
import { num } from '../../tree/nodeProps';
import { shapeSelect } from '../../tree/shapeProfile';
import { FIELDS, type Field, type PanelSection } from '../../services/design/componentFields';
import { DERIVED } from '../../services/design/derivedFields';
import { clampToBounds, type DimensionBounds } from '../../services/design/linkedDimensions';
import {
  KERNEL_AUTO_KEYS,
  fieldApplies,
  fieldOptions,
  fieldRange,
  fieldValue,
  liveBounds,
} from '../../services/design/fieldRange';
import { parentRadiusOf } from '../../tree/finPlanform';
import { PropSection } from './PropSection';
import { rebaseTabOffset } from '../../tree/axialRebase';
import { useWorkspaceStore } from '../../state/store';

/**
 * The kernel's value for an automatic field it resolves itself, while the field
 * is on Auto.
 *
 * Memoized on the live build: the panel re-renders on every keystroke in any of
 * its fields, and each read is a kernel call and an envelope parse. A new build
 * is a new `rocket`, so an edit that moves the value is still picked up.
 */
function useKernelAutoValue(node: ComponentNode, f: Field): number | undefined {
  const rocket = useWorkspaceStore((s) => s.rocket);
  const autoOn = !!f.auto && node[f.auto.flag] === true && KERNEL_AUTO_KEYS.has(f.key);
  const id = typeof node.id === 'string' ? node.id : null;
  return useMemo(() => {
    if (!autoOn || !rocket || id === null) return undefined;
    try {
      const v = (rocket.componentInfo(id) as unknown as Record<string, unknown>)[f.key];
      return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
    } catch {
      // A part the live build does not hold yet (the rebuild trails the edit).
      return undefined;
    }
  }, [rocket, id, f.key, autoOn]);
}

/**
 * A fin tab's depth limit, `FinSet.getMaxTabHeight()`: the parent's radius at
 * the tab's two ends, which no field bound can read because it lives on the
 * parent. Null for every other field, and for a fin with no symmetric parent.
 */
function useTabDepthLimit(node: ComponentNode, f: Field): number | null {
  const id = f.key === 'tabHeight' && typeof node.id === 'string' ? node.id : null;
  return useWorkspaceStore((s) => (id === null ? null : parentRadiusOf(s.tree, id)));
}

/**
 * The property panel's per-type shape and dimension fields: the numeric row
 * every section builds on (`NumberField`), the field-kind switch that renders
 * one declared `Field` (`FieldRow`), and the filter that picks which of a
 * part's declared fields to show (`visibleFields`).
 */

/** The declared fields of this part that the panel shows in its dimension list. */
export function visibleFields(node: ComponentNode, isFirstStage: boolean): Field[] {
  // The top stage separates from nothing above it, so hide its separation fields.
  const allFields = node.type === 'stage' && isFirstStage ? [] : (FIELDS[node.type] ?? []);
  return allFields.filter(
    // Sectioned fields are rendered by their own section instead, so the
    // dimension list stays dimensions.
    (f) => f.section === undefined && fieldApplies(node, f),
  );
}

/**
 * The declared fields of this part that belong to one named section.
 *
 * Kept next to `visibleFields` because the two partition the type's fields,
 * and a field that fell out of both would simply stop being editable.
 */
export function sectionFields(node: ComponentNode, section: PanelSection): Field[] {
  return (FIELDS[node.type] ?? []).filter((f) => f.section === section && fieldApplies(node, f));
}

/**
 * A titled block of fields, separated from what is above it. Renders nothing
 * when the part has no field in that section, so the panel can ask for one
 * unconditionally rather than repeating the type test at the call site.
 *
 * `children` render under the declared rows, for a section that also needs a
 * control the FIELDS table cannot describe: the fillet's material picker.
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
    <PropSection title={title}>
      {fields.map((f) => (
        <FieldRow key={f.key} node={node} field={f} onChange={onChange} onCommit={onCommit} />
      ))}
      {children}
    </PropSection>
  );
}

/** What a property panel section edits: the part, and the panel's patch and commit handlers. */
export interface NodeEditProps {
  node: ComponentNode;
  onChange: (patch: Partial<ComponentNode>) => void;
  /** Closes the undo entry the edits since the last commit opened. */
  onCommit?: () => void;
  /**
   * Whether the part's stage has a stage below it (`fieldRange.hasStageBelow`),
   * which decides whether a recovery device is offered the lower-stage
   * separation event. Undefined for a part outside a design, which is offered
   * every option.
   */
  stageBelow?: boolean;
}

/**
 * The stub that plugs into the tube next door. It is a different piece of the
 * part from the cone or taper above it, and under the same heading it would
 * read as four more dimensions of the same shape. A transition has two, kept
 * apart because each end is its own build and eight rows under one heading is
 * a wall. At most two render for a given part (a transition's fore and aft):
 * FieldSection draws nothing when the type has no field in it.
 */
export function ShoulderSections({ node, onChange, onCommit }: NodeEditProps) {
  const { t } = useTranslation();
  return (
    <>
      {(
        [
          ['shoulder', t('prop.shoulder')],
          ['foreShoulder', t('prop.foreShoulder')],
          ['aftShoulder', t('prop.aftShoulder')],
        ] as const
      ).map(([section, title]) => (
        <FieldSection
          key={section}
          node={node}
          title={title}
          fields={sectionFields(node, section)}
          onChange={onChange}
          onCommit={onCommit}
        />
      ))}
    </>
  );
}

export function NumberField({
  label,
  unit,
  value,
  step,
  min,
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
  /** Lower bound; absent, the box takes any number (a signed length, an angle the kernel wraps). */
  min?: number;
  /** Upper bound, forwarded to the input so the spinner respects it too. */
  max?: number;
  /** A zero here is a value the kernel cannot fly; see the `Field` type. */
  required?: boolean;
  /**
   * A "follows something else" switch. While it is on the number is derived
   * and the box is read-only, so the checkbox is the control and the box is
   * the readout - rather than a box you can type into whose value is silently
   * overwritten on the next edit.
   */
  auto?: { on: boolean; label: string; title: string; onToggle: (on: boolean) => void };
  onChange: (v: number) => void;
  onCommit?: () => void; // fires on blur; closes the undo entry for this edit
}) {
  const { t } = useTranslation();
  // No separate "blank" state to check for: 0 is exactly what is wrong here, so
  // an emptied box and a typed zero collapse into one condition.
  const missing = required && !(Number.isFinite(value) && value > 0);
  /**
   * An empty required box writes nothing at all.
   *
   * Not a focus trap: you can still tab away, which a trap would forbid
   * (WCAG 2.1.2) and which would fight anyone clearing a field to retype it.
   * The input keeps its own draft string while focused, so the box still looks
   * empty as you type; it is only the commit that is withheld. Blur then shows
   * the value that was already there. So clearing a box never writes a zero,
   * while a deliberately typed 0 still lands, goes red, and is refused by the
   * run.
   */
  const write = (v: number | null) => {
    if (v === null && required) return;
    onChange(v ?? 0);
  };
  return (
    // A row, not one big <label>. The switch below is a second control, and a
    // label may only bind to one: wrapping both would make the word "Auto"
    // focus the number box rather than tick the box beside it.
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
              `w-24 rounded-md px-2 py-1 text-right text-sm ring-1 ring-line/10 focus:outline-none focus:ring-accent-500 ${
                auto?.on ? 'bg-raised/50 text-ink-muted' : 'bg-raised text-ink-strong'
              }`,
              missing,
            )}
          />
          {unit && <span className="min-w-10 text-xs text-ink-faint">{unit}</span>}
        </span>
      </label>
      {/* The switch carries its word on screen, not only in a `title`: on a
          centering ring both diameters have one, and two bare checkboxes read
          as unexplained ticks. The accessible name
          keeps the field's own name in front of it ("Outer diameter: Auto"), so
          the two rows are still told apart when the page is read aloud. */}
      {auto && (
        <label
          title={auto.title}
          className="flex shrink-0 cursor-pointer items-center gap-1 text-[11px] leading-none text-ink-muted"
        >
          <input
            type="checkbox"
            checked={auto.on}
            onChange={(e) => auto.onToggle(e.target.checked)}
            aria-label={auto.label}
            className="accent-accent-500"
          />
          {t('prop.auto')}
        </label>
      )}
    </div>
  );
}

/**
 * What picking `value` in a select field writes. A tab reference rebases the
 * tab so it stays put, and a nose cone or transition shape brings the new
 * shape's own parameter and clip.
 */
function selectPatch(node: ComponentNode, key: string, value: string): Partial<ComponentNode> {
  if (key === 'tabOffsetMethod') return rebaseTabOffset(node, value);
  if (key === 'shape' && (node.type === 'nosecone' || node.type === 'transition')) return shapeSelect(node, value);
  return { [key]: value };
}

/**
 * One type-specific field of the selected part, by its declared kind. The kind
 * switch lives here, rather than as inline branches in the panel's render loop,
 * so the panel body reads as a list of rows.
 */
export function FieldRow({ node, field: f, onChange, onCommit, stageBelow }: NodeEditProps & { field: Field }) {
  const { t } = useTranslation();
  const u = useUnits();
  const kernelAuto = useKernelAutoValue(node, f);
  const tabDepth = useTabDepthLimit(node, f);
  const bounds: DimensionBounds | undefined = liveBounds(f, tabDepth);
  const label = t(`prop.${f.label}`);
  // One scope per field of this component type: every body tube is the
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
   * Write a converted patch to the node, or nothing at all.
   *
   * Each branch below converts through `FieldUnit.toSi`, which is the app's one
   * rule for what an entry may store (prefs/entryValue) and answers `null` for
   * a value that cannot survive the conversion: 1e306 g/cm3 is 1e309 kg/m3,
   * which is Infinity. This drops such a patch rather than writing the `null`
   * on into the node.
   *
   * The whole patch is dropped, not the bad key: a `derived` field writes two
   * linked numbers, and half of that pair is worse than neither. That is also
   * why the finite check stays here as well as in `toSi`: `derived` and `bore`
   * do arithmetic of their own on the converted value before it lands.
   */
  const patchNumber = (patch: Partial<ComponentNode>) => {
    if (Object.values(patch).some((v) => v === null || (typeof v === 'number' && !Number.isFinite(v)))) return;
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
            // Turning Auto off keeps the length it was showing, as desktop does.
            onToggle: (on: boolean) =>
              commitChange(
                on || kernelAuto === undefined
                  ? { [f.auto!.flag]: on }
                  : { [f.auto!.flag]: false, [f.key]: kernelAuto },
              ),
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
  /** The field's own stored SI number, edited in its unit with a unit chip. */
  const inUnit = (quantity: Quantity, stepSi: number, min?: (fu: FieldUnit) => number, maxSi?: number) => {
    const fu = u.at(scope, quantity);
    return numeric({
      unit: <UnitChip quantity={quantity} scope={scope} />,
      value: fu.toUi(Number(fieldValue(node, f))),
      step: fu.step(stepSi),
      min: min?.(fu),
      max: maxSi === undefined ? undefined : fu.toUi(maxSi),
      onChange: (v) => {
        const si = fu.toSi(v);
        patchNumber({ [f.key]: si === null || maxSi === undefined ? si : Math.max(-maxSi, Math.min(maxSi, si)) });
      },
    });
  };

  switch (f.kind) {
    case 'select': {
      const cur = String(fieldValue(node, f));
      return (
        <label className="flex items-center justify-between gap-3">
          <span className="text-xs text-ink-muted">{label}</span>
          <select
            value={cur}
            // A new tab reference keeps the tab where it is, as the kernel's
            // FinSet.setTabOffsetMethod does, and a new shape takes its own
            // parameter and clip, as Transition.setShapeType does.
            onChange={(e) => commitChange(selectPatch(node, f.key, e.target.value))}
            className="w-32 rounded-md bg-raised px-2 py-1 text-sm text-ink-strong ring-1 ring-line/10 focus:outline-none focus:ring-accent-500"
          >
            {fieldOptions(node, f, stageBelow).map((o) => (
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
          <span className="text-xs text-ink-muted">{label}</span>
          <textarea
            rows={3}
            value={typeof node[f.key] === 'string' ? (node[f.key] as string) : ''}
            onChange={(e) => onChange({ [f.key]: e.target.value || undefined })}
            onBlur={onCommit}
            className="w-full resize-y rounded-md bg-raised px-2 py-1 text-sm text-ink-strong ring-1 ring-line/10 focus:outline-none focus:ring-accent-500"
          />
        </label>
      );
    case 'bool':
      return (
        <label className="flex items-center justify-between gap-3">
          <span className="text-xs text-ink-muted">{label}</span>
          <input
            type="checkbox"
            checked={fieldValue(node, f) === true}
            onChange={(e) => commitChange({ [f.key]: e.target.checked })}
            className="accent-accent-500"
          />
        </label>
      );
    case 'count': {
      const { min = 1, max = 1 } = fieldRange(node, f);
      return numeric({
        value: Number(fieldValue(node, f)),
        step: 1,
        min,
        max,
        // Clamped here as well as in every consumer: without a ceiling at the
        // source, the count would reach the node and be persisted and exported
        // before any renderer saw it.
        onChange: (v) => patchNumber({ [f.key]: Math.min(max, Math.max(min, Math.round(v))) }),
      });
    }
    case 'mass':
    case 'distance': {
      // The floor goes into the box, converted like the value: `fieldRange`
      // declares both kinds non-negative, and the bridge refuses a negative mass
      // or deploy altitude (ComponentFactory NON_NEGATIVE) while the kernel keeps
      // a negative separation altitude and never fires the trigger. Without the
      // floor here, `parseFieldValue` clamps nothing and a typed -150 lands.
      const { min } = fieldRange(node, f);
      const floor = min === undefined ? undefined : (fu: FieldUnit) => fu.toUi(min);
      return f.kind === 'mass' ? inUnit('mass', 0.0005, floor) : inUnit('distance', f.step ?? 10, floor);
    }
    case 'number': {
      const { min, max } = fieldRange(node, f);
      return numeric({
        unit: f.unit,
        // On Auto, the number the kernel works out (a recovery device's Cd),
        // not the stored one it ignores.
        value: kernelAuto ?? Number(fieldValue(node, f)),
        step: f.step ?? 0.1,
        min,
        max,
        ...autoProp(),
        onChange: (v) => patchNumber({ [f.key]: Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v)) }),
      });
    }
    case 'angle': {
      // Stored in radians (kernel/.ork convention), edited in the user's unit.
      // The range is converted, not fixed in degrees: a fixed -180 would clamp
      // a radian entry to well inside its legal range.
      const { min, max } = fieldRange(node, f);
      return inUnit(
        'angle',
        ((f.step ?? 5) * Math.PI) / 180,
        min === undefined ? undefined : (fu) => fu.toUi(min),
        max,
      );
    }
    case 'bore': {
      // A tube's inner diameter, which is not stored: the node and the `.ork`
      // carry the outer radius and the wall, and the bore is the pair of them.
      // So typing a bore writes the wall back and leaves the outside where it
      // is, as OpenRocket's three linked tube fields do.
      //
      // Read through `num` exactly as the thickness row above it does, rather
      // than through the per-type defaults the file services use, so the two
      // rows never show a wall and a bore that disagree. A bore typed out to
      // the outer diameter lands there (a zero wall, which its own row marks),
      // with no minimum wall imposed.
      const fu = u.at(scope, 'length');
      const outerR = num(node, 'outerRadius');
      const od = 2 * outerR;
      return numeric({
        unit: <UnitChip quantity="length" scope={scope} />,
        value: fu.toUi(Math.max(0, od - 2 * num(node, 'thickness'))),
        step: fu.step(0.0005),
        min: 0,
        max: fu.toUi(od),
        onChange: (v) => {
          const si = fu.toSi(v);
          if (si === null) return;
          const bore = Math.max(0, Math.min(od, si));
          // Floored as well as clamped: the unit round trip leaves dust, and a
          // wall of -1.7e-18 is a negative thickness heading for the mass, the
          // mesh and the .ork, none of which check for one.
          patchNumber({ thickness: Math.max(0, (od - bore) / 2) });
        },
      });
    }
    case 'derived': {
      // A second door onto numbers the part does store: a fin's sweep as an
      // angle, a streamer's area or aspect ratio, a mass component's density.
      // Nothing here is a node key - the pair of conversions in
      // services/design/derivedFields.ts reads the stored keys and writes them
      // back, so the arithmetic, which is the kernel's, sits where it can be
      // tested.
      const d = DERIVED[f.derived];
      // A bare ratio has no unit group and no chip, so it also has no scope to
      // convert through: it is read and written as itself.
      const fu = d.quantity ? u.at(scope, d.quantity) : undefined;
      const patch = (v: number) => {
        // A bare ratio has no unit to convert through, so it takes the same
        // rule with no conversion leg rather than skipping the check.
        const si = fu ? fu.toSi(v) : clampEntry(v);
        if (si === null) return;
        patchNumber(d.write(node, si));
      };
      const value = d.read(node);
      const bound = (v: number | undefined) => (v === undefined ? undefined : Number((fu ? fu.toUi(v) : v).toFixed(6)));
      return numeric({
        unit: d.quantity ? <UnitChip quantity={d.quantity} scope={scope} /> : undefined,
        value: fu ? fu.toUi(value) : value,
        // The spec's own bounds, converted like the value. Snapped, because a
        // bound is a round number by construction and the unit round trip
        // leaves dust on it: 89 degrees comes out as 89.00000000000001, which
        // the input would then show as the limit.
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
      // `bounds`: the range the kernel's setter holds this value in, given the
      // rest of the part. The box stops there, and so does the stored value, so
      // the panel never shows a figure the kernel would fly as another.
      const { min, max } = fieldRange(node, f, bounds);
      const range = {
        ...(min === undefined ? {} : { min: fu.toUi(k * min) }),
        ...(max === undefined ? {} : { max: fu.toUi(k * max) }),
      };
      // `auto`: the value follows something else (a shoulder follows the bore of
      // the tube it plugs into). Ticking it commits at once and the resolver
      // fills the number in the same edit; clearing it pins whatever it now is.
      return numeric({
        unit: <UnitChip quantity="length" scope={scope} />,
        value: fu.toUi(k * (kernelAuto ?? Number(fieldValue(node, f)))),
        step: fu.step(0.0005),
        ...range,
        ...autoProp(),
        onChange: (v) => {
          const si = fu.toSi(v, (s) => s / k);
          patchNumber({ [f.key]: si === null ? si : clampToBounds(node, bounds, si) });
        },
      });
    }
  }
}
