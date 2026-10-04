import { Fragment, lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import type { ComponentNode } from '../../engine/openRocketEngine';
import { isAxial, hasCatalog, hasMaterial, catalogPatch, presetRef } from '../../services/design/treeEdit';
import type { PickerType } from '../../services/parts/componentDb';
import type { FitContext } from '../../services/parts/componentFilter';
// Lazily loaded: it pulls in the ~740 kB component catalog (services/parts/componentDb),
// so it splits into its own chunk fetched only when a catalog part is selected.
const ComponentPicker = lazy(() => import('./ComponentPicker').then((m) => ({ default: m.ComponentPicker })));
// Lazy for the same reason and behind the same Suspense boundary: it is the
// other half of the picker, and nothing needs either until a catalog part is
// selected.
const SavePartButton = lazy(() => import('./SavePartButton').then((m) => ({ default: m.SavePartButton })));
import { ErrorBoundary } from '../common/ErrorBoundary';
import { AppearanceSection } from './AppearanceSection';
import { FreeformFinEditor } from './FreeformFinEditor';
import { RecoverySizingReadout } from './RecoverySizingReadout';
import { ConfigOverrideNote } from './ConfigOverrideNote';
import { useUnits } from '../../prefs/useUnits';
import { num } from '../../tree/nodeProps';
import { tubeFinMaxCount, tubeFinMaxRadius } from '../../tree/tubefins';
import { FieldRow, FieldSection, sectionFields, visibleFields } from './DimensionFields';
import { MaterialSection, RecoveryMaterialSection } from './MaterialSection';
import { StageRecovery } from './StageRecovery';
import { ComponentActions } from './ComponentActions';
import { AutoFinTabButton } from './AutoFinTabButton';
import { FreeformFinActions } from './FreeformFinActions';
import { MaterialPicker } from './MaterialPicker';
import { OverridesSection } from './OverridesSection';
import { ShapeDescription } from './ShapeDescription';
import { PlacementSection } from './PlacementSection';

/**
 * The property panel shell: the header (move / delete), the name row, the
 * catalog picker, and the order in which the sections appear. The dimension
 * fields, materials, appearance, overrides and placement each live in their own
 * module.
 */

/**
 * Edits the currently-selected component's properties. Type-specific numeric
 * fields, a shape/select where relevant, the part name, an axial-position editor
 * for nested parts, and a Delete button. Emits a shallow patch on every change;
 * the workspace store (`patchSelected`) merges it into the tree and rebuilds.
 *
 * The tree is always SI (meters, kilograms, radians). Every field converts to
 * the user's chosen unit on the way out and back on the way in; the unit label
 * beside each field is a UnitChip, so it doubles as the picker.
 */

/**
 * Do N tubes of radius r collide around a body of radius R?
 *
 * Asked through `tubeFinMaxRadius` so the panel and the drawing agree on one
 * definition of "touching"; the 1e-9 lets an exactly-touching set through,
 * which is a legal (if tight) build, not an error.
 */
function tubeFinsCollide(node: ComponentNode, parentRadius: number): boolean {
  if (!(parentRadius > 0)) return false;
  const max = tubeFinMaxRadius(num(node, 'finCount'), parentRadius);
  return max !== null && num(node, 'outerRadius') > max + 1e-9;
}

export function PropertyPanel({
  node,
  onChange,
  onCommit,
  onRemove,
  onMove,
  canMoveUp,
  canMoveDown,
  canRemove = true,
  isFirstStage = false,
  parentRadius = 0,
  fit,
  flush = false,
}: {
  node: ComponentNode | null;
  onChange: (patch: Partial<ComponentNode>) => void;
  /** Close the current edit's undo entry. Number/text fields fire it on blur;
   *  discrete controls (select, checkbox, pickers) fire it right after onChange. */
  onCommit?: () => void;
  onRemove: () => void;
  onMove?: (dir: -1 | 1) => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  /** False disables Delete (e.g. the only stage — a rocket needs at least one). */
  canRemove?: boolean;
  /** The selected node is the top stage — has nothing above it, so no separation. */
  isFirstStage?: boolean;
  /** Outer radius (m) of the body this part rings — tube fins only. */
  parentRadius?: number;
  /** Geometry around this part, so the catalog picker can rank what fits it. */
  fit?: FitContext;
  /**
   * Drop the panel's own card, for a host that already is one. The right column
   * needs the card to read as a panel against the pane behind it; the component
   * dialog is already a slate-900 surface with a ring, and a second one inside
   * it is a box drawn around the inside of a box.
   */
  flush?: boolean;
}) {
  const { t } = useTranslation();
  const u = useUnits();
  // The card is the panel's own surface, and the host says whether it needs one.
  const card = flush ? '' : ' rounded-xl bg-slate-900 ring-1 ring-white/10';
  if (!node) {
    return <section className={`p-3 text-sm text-slate-500${card}`}>{t('prop.selectHint')}</section>;
  }

  const fields = visibleFields(node, isFirstStage);
  // `shapeParameter` is filtered out for shapes that do not use one, so the
  // description follows whichever of the two is last on screen.
  const shapeAnchor = fields.filter((f) => f.key === 'shape' || f.key === 'shapeParameter').at(-1)?.key;
  const label = t(`part.${node.type}`, { defaultValue: node.type });
  // The catalog row this part was picked from, as `presetRef` recorded it.
  const catalogPart = node['preset'] as { manufacturer?: string; partNo?: string } | undefined;
  // Discrete controls (select / checkbox / pickers) finish the moment they
  // change, so patch and close the undo entry in one shot.
  const commitChange = (patch: Partial<ComponentNode>) => {
    onChange(patch);
    onCommit?.();
  };

  return (
    <section className={`space-y-3 p-3${card}`}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</h2>
        <div className="flex items-center gap-1">
          {onMove && (
            <>
              <button
                onClick={() => onMove(-1)}
                disabled={!canMoveUp}
                title={t('prop.moveUp')}
                aria-label={t('prop.moveUp')}
                className="rounded-md bg-slate-800 px-2 py-1 text-xs text-slate-300 ring-1 ring-white/10 hover:bg-slate-700 disabled:cursor-not-allowed disabled:text-slate-600 disabled:hover:bg-slate-800"
              >
                ↑
              </button>
              <button
                onClick={() => onMove(1)}
                disabled={!canMoveDown}
                title={t('prop.moveDown')}
                aria-label={t('prop.moveDown')}
                className="rounded-md bg-slate-800 px-2 py-1 text-xs text-slate-300 ring-1 ring-white/10 hover:bg-slate-700 disabled:cursor-not-allowed disabled:text-slate-600 disabled:hover:bg-slate-800"
              >
                ↓
              </button>
            </>
          )}
          <button
            onClick={onRemove}
            disabled={!canRemove}
            title={canRemove ? t('prop.delete') : t('prop.lastStage')}
            className="rounded-md bg-red-500/15 px-2 py-1 text-xs font-medium text-red-300 ring-1 ring-red-500/30 hover:bg-red-500/25 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-600 disabled:ring-white/10 disabled:hover:bg-slate-800"
          >
            {t('prop.delete')}
          </button>
        </div>
      </div>

      {/* What this part IS: what it is called, and which catalog part it came
          from. Color used to be here too and is its own section now, below:
          these two say what the part is, and that one says how it is drawn. */}
      <div className="space-y-3 border-t border-white/5 pt-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">{t('prop.part')}</h3>
        <label className="flex items-center justify-between gap-3">
          <span className="text-xs text-slate-400">{t('prop.name')}</span>
          <input
            type="text"
            value={typeof node.name === 'string' ? node.name : ''}
            placeholder={label}
            onChange={(e) => onChange({ name: e.target.value })}
            onBlur={onCommit}
            className="w-40 rounded-md bg-slate-800 px-2 py-1 text-sm text-slate-100 ring-1 ring-white/10 focus:outline-none focus:ring-sky-500"
          />
        </label>

        {/*
            WHICH catalog part this is, when it came from one.
            The link is written by the picker and carried into the `.ork`
            (`presetRef`), and until this row existed nothing on screen said so:
            a design built from real parts looked hand-typed. It disappears by
            itself when an edit breaks the link, because `breaksPreset` drops the
            link with the same commit.
        */}
        {catalogPart && (
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-slate-400">{t('prop.catalogPart')}</span>
            <span
              className="w-40 truncate text-right text-sm text-slate-200"
              title={`${catalogPart.manufacturer} ${catalogPart.partNo}`}
            >
              {catalogPart.partNo}
              <span className="block truncate text-[10px] text-slate-500">{catalogPart.manufacturer}</span>
            </span>
          </div>
        )}

        {hasCatalog(node.type) && (
          // Outside the Suspense, because it is the chunk FETCH that fails on
          // a stale deploy and Suspense re-throws that rejection. Uncaught it
          // took the whole app down over a picker; caught here, the dimensions
          // below it stay editable.
          <ErrorBoundary>
            <Suspense fallback={<div className="text-xs text-slate-500">{t('common.loading')}</div>}>
              <div className="space-y-2">
                <ComponentPicker
                  type={node.type as PickerType}
                  fit={fit}
                  current={catalogPart?.partNo}
                  // The link goes in with the dimensions: the desktop shows which
                  // catalog part a component is, and drops the link as soon as a
                  // dimension moves (see treeEdit.breaksPreset).
                  onApply={(p) => commitChange({ ...catalogPatch(p, node), ...presetRef(p) })}
                />
                {/* The other direction: take the part you just built and put it
                    in the picker above, on this design and every other one. */}
                <SavePartButton node={node} type={node.type as PickerType} />
              </div>
            </Suspense>
          </ErrorBoundary>
        )}
      </div>

      {/* What the chosen shape IS, in OpenRocket's own words, directly under
          the controls it describes: the shape and, where the shape uses one,
          its parameter. The desktop puts it beside those two; a one-column
          panel puts it below them. */}
      {fields.map((f) => (
        <Fragment key={f.key}>
          <FieldRow node={node} field={f} onChange={onChange} onCommit={onCommit} />
          {f.key === shapeAnchor && <ShapeDescription node={node} />}
        </Fragment>
      ))}

      {/* The stub that plugs into the tube next door. It is a different piece
          of the part from the cone or taper above it, and it was reading as
          four more dimensions of the same shape. A transition has two, kept
          apart because each end is its own build and eight rows under one
          heading is a wall. Only one of the three renders for a given part:
          FieldSection draws nothing when the type has no field in it. */}
      <FieldSection
        node={node}
        title={t('prop.shoulder')}
        fields={sectionFields(node, 'shoulder')}
        onChange={onChange}
        onCommit={onCommit}
      />
      <FieldSection
        node={node}
        title={t('prop.foreShoulder')}
        fields={sectionFields(node, 'foreShoulder')}
        onChange={onChange}
        onCommit={onCommit}
      />
      <FieldSection
        node={node}
        title={t('prop.aftShoulder')}
        fields={sectionFields(node, 'aftShoulder')}
        onChange={onChange}
        onCommit={onCommit}
      />

      {/* The through-the-wall tab is a separate piece of the fin — four fields
          that describe the part of it buried in the airframe, not its
          planform. Run on under the planform they read as four more
          dimensions of the same shape. */}
      <FieldSection
        node={node}
        title={t('prop.finTab')}
        fields={sectionFields(node, 'finTab')}
        onChange={onChange}
        onCommit={onCommit}
      >
        <AutoFinTabButton node={node} />
      </FieldSection>

      {/* The glue bead along the fin root. Its material is rarely the fin's own
          — epoxy on plywood — so it carries its own, beside the radius.
          The picker used to appear only once the radius was non-zero, on the
          theory that a material with no bead is meaningless. What that
          actually did was hide it: you cannot find a control that is not
          there, and the order you fill a section in is yours, not the
          panel's. It stores fine at radius 0 and goes live the moment there
          is a bead. */}
      <FieldSection
        node={node}
        title={t('prop.fillet')}
        fields={sectionFields(node, 'fillet')}
        onChange={onChange}
        onCommit={onCommit}
      >
        <MaterialPicker
          use="fillet"
          label={t('material.fillet')}
          value={typeof node['filletMaterialName'] === 'string' ? (node['filletMaterialName'] as string) : undefined}
          onChange={(name, d, group) =>
            commitChange({
              filletMaterialName: name,
              filletDensity: d || undefined,
              // The catalog group rides along so the .ork writer can put the
              // material back in its own category rather than the
              // PaperProducts its Cardboard fallback belongs to. It comes from
              // the picker because only the picker has the catalog in hand; a
              // custom adhesive carries its group this way too, which the old
              // built-ins-only lookup could not see.
              filletMaterialGroup: (name && group) || undefined,
            } as Partial<ComponentNode>)
          }
        />
      </FieldSection>

      {/* Tube fins collide with each other once they are too fat, or too many,
          for the body they ring — geometry the app could compute (tubefins.ts)
          but never showed. Warn rather than clamp: the user may be part-way
          through a change, and both ways out (fewer tubes, thinner tubes) are
          theirs to pick. */}
      {node.type === 'tubefinset' && tubeFinsCollide(node, parentRadius) && (
        <p className="rounded-md bg-amber-500/10 px-2 py-1.5 text-[11px] leading-snug text-amber-300 ring-1 ring-amber-500/30">
          {t('prop.tubeFinsCollide', {
            max: tubeFinMaxCount(num(node, 'outerRadius'), parentRadius),
            // Doubled to match the field it is about: the tube's size reads as
            // a diameter in the box above this warning.
            diameter: u.fmt('length', 2 * (tubeFinMaxRadius(num(node, 'finCount'), parentRadius) ?? 0)),
            unit: u.sym('length'),
          })}
        </p>
      )}

      {hasMaterial(node.type) && <MaterialSection node={node} onCommitChange={commitChange} />}

      {/* What the tube does for a MOTOR, as against what the tube IS. Only a
          body tube (two rows) and an inner tube (six, the cluster among them)
          have one; every other type renders nothing here.

          Below the material rather than above it, because everything above this
          point describes the tube itself - its dimensions, then what it is made
          of - and this is the first section about the job it has been given. A
          body tube's motor-mount switch sitting between its wall thickness and
          its material split the description of one object in half, and on an
          inner tube the cluster rows pushed the material six rows down. */}
      <FieldSection
        node={node}
        title={t('prop.motor')}
        fields={sectionFields(node, 'motor')}
        onChange={onChange}
        onCommit={onCommit}
      />

      {/* Freeform fin: its defining feature is the outline polygon, edited
          graphically rather than as scalar fields. */}
      {node.type === 'freeformfinset' && (
        <div className="border-t border-white/5 pt-3">
          <FreeformFinEditor
            points={(node.points as [number, number][] | undefined) ?? []}
            onChange={(pts) => onChange({ points: pts } as Partial<ComponentNode>)}
            onCommit={onCommit}
          />
          {/* Scale fin, Import from image and Export CSV: the desktop's own
              Point Actions menu, which needs the node rather than just the
              point list. */}
          <FreeformFinActions node={node} />
        </div>
      )}

      {(node.type === 'parachute' || node.type === 'streamer') && (
        <>
          {/* The deployment fields above are the DESIGN's; a flight
              configuration may open this device at another moment. */}
          <ConfigOverrideNote node={node} />
          <RecoveryMaterialSection node={node} onCommitChange={commitChange} />
        </>
      )}

      {/* Same for staging: the separation fields above are the design's, and a
          configuration may let this booster go at another moment. */}
      {(node.type === 'stage' || node.type === 'parallelstage') && <ConfigOverrideNote node={node} />}

      {/* Single or dual deployment, chosen on the STAGE, which is the only place
          OpenRocket offers it. A pod set is not a stage and has no recovery
          plan of its own; a parallel stage is one and does. */}
      {(node.type === 'stage' || node.type === 'parallelstage') && <StageRecovery node={node} />}

      {/* Descent sizing — canopy diameter for the descent bands + this chute's
          own descent rate, from the live descent mass. Parachutes only (the
          sqrt-law is diameter-based; streamers size differently). */}
      {node.type === 'parachute' && <RecoverySizingReadout node={node} />}

      {/* Placement — only meaningful for parts nested inside a tube. */}
      {node.type !== 'stage' && !isAxial(node.type) && (
        <PlacementSection node={node} onChange={onChange} onCommit={onCommit} />
      )}

      {/* Appearance is second to last on every part, directly above Overrides.
          A stage has no color of its own, so it has no Appearance section. */}
      {node.type !== 'stage' && (
        <AppearanceSection node={node} onChange={onChange} onCommit={onCommit} onCommitChange={commitChange} />
      )}

      {/* The tree-shape actions: Convert to freeform, the three Splits and the
          cluster's Reset. Above Overrides, because they are still about the part
          itself. */}
      <ComponentActions node={node} />

      {/* Overrides are the last thing about the ROCKET on every part, without
          exception. They are not a property of the part the way its dimensions,
          material and placement are: they are a deliberate override of what
          those add up to, reached for rarely and after the part is described.
          Sitting in the middle, between the material and the placement, they
          pushed the placement rows below three rows nobody was looking for. */}
      <OverridesSection node={node} onChange={onChange} onCommit={onCommit} />

      {/* Notes on this part, which the desktop gives a tab of its own and we had
          been dropping on every save. Dead last, below even the overrides: it is
          the only field here that is about the BUILDER rather than the rocket,
          so nothing the panel says about the part should be under it. It was
          sitting above the material, which put a free-text box between the
          part's dimensions and what it is made of. */}
      <FieldSection
        node={node}
        title={t('prop.comment')}
        fields={sectionFields(node, 'comment')}
        onChange={onChange}
        onCommit={onCommit}
      />
    </section>
  );
}
