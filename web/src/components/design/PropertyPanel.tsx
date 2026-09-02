import { useTranslation } from 'react-i18next';
import type { ComponentNode, ComponentPosition } from '../../engine/openRocketEngine';
import { isAxial, hasCatalog, hasMaterial, catalogPatch } from '../../services/treeEdit';
import { colorForType, mergePalette } from '../../services/partColors';
import { useSettings } from '../../state/SettingsProvider';
import type { ComponentType as CatalogType } from '../../services/componentDb';
import { ComponentPicker } from './ComponentPicker';
import { MaterialPicker } from './MaterialPicker';
import { FreeformFinEditor } from './FreeformFinEditor';

/**
 * Edits the currently-selected component's properties. Type-specific numeric
 * fields (lengths in mm, mass in g), a shape/select where relevant, the part
 * name, an axial-position editor for nested parts, and a Delete button. Emits a
 * shallow patch on every change; App merges it into the tree and rebuilds.
 */

type Field =
  | { key: string; label: string; kind: 'length' }   // stored m, shown mm
  | { key: string; label: string; kind: 'mass' }      // stored kg, shown g
  | { key: string; label: string; kind: 'count' }
  | { key: string; label: string; kind: 'number'; step?: number; unit?: string }
  | { key: string; label: string; kind: 'angle'; step?: number }   // stored radians, shown degrees
  | { key: string; label: string; kind: 'bool' }
  | { key: string; label: string; kind: 'select'; options: string[]; optI18n?: string };

// The real OpenRocket shape vocabulary — matches the engine (shapeOf), the
// drawing (shapeProfile), and the parts catalogue. NOT 'elliptical'/'powerseries'.
const NOSE_SHAPES = ['ogive', 'conical', 'ellipsoid', 'power', 'parabolic', 'haack'];

// Recovery-device deployment triggers — the kernel DeployEvent vocabulary
// (ComponentFactory.deployEventOf); the same strings .ork import/export use.
// Apogee first: it's the default and the most common single-deploy trigger.
const DEPLOY_EVENTS = ['apogee', 'ejection', 'altitude', 'launch', 'never'];

// Optional through-the-wall fin tab (0 length/height = no tab). Shared by the
// trapezoidal and elliptical fin editors; keys match the engine + .ork.
const FIN_TABS: Field[] = [
  { key: 'tabLength', label: 'tabLength', kind: 'length' },
  { key: 'tabHeight', label: 'tabHeight', kind: 'length' },
  { key: 'tabOffset', label: 'tabOffset', kind: 'length' },
  { key: 'tabOffsetMethod', label: 'tabOffsetMethod', kind: 'select', options: ['top', 'middle', 'bottom'] },
];

// `label` is an i18n key suffix under `prop.*` (resolved at render).
const FIELDS: Record<string, Field[]> = {
  nosecone: [
    { key: 'shape', label: 'shape', kind: 'select', options: NOSE_SHAPES },
    { key: 'length', label: 'length', kind: 'length' },
    { key: 'aftRadius', label: 'radius', kind: 'length' },
    { key: 'thickness', label: 'thickness', kind: 'length' },
    { key: 'shoulderLength', label: 'shoulderLength', kind: 'length' },
    { key: 'shoulderRadius', label: 'shoulderRadius', kind: 'length' },
    { key: 'shoulderThickness', label: 'shoulderThickness', kind: 'length' },
    { key: 'shoulderCapped', label: 'shoulderCapped', kind: 'bool' },
  ],
  bodytube: [
    { key: 'length', label: 'length', kind: 'length' },
    { key: 'outerRadius', label: 'radius', kind: 'length' },
    { key: 'thickness', label: 'thickness', kind: 'length' },
    { key: 'motorMount', label: 'motorMount', kind: 'bool' },
    { key: 'motorOverhang', label: 'motorOverhang', kind: 'length' },
  ],
  transition: [
    { key: 'shape', label: 'shape', kind: 'select', options: ['conical', 'ogive', 'ellipsoid', 'power', 'parabolic', 'haack'] },
    { key: 'length', label: 'length', kind: 'length' },
    { key: 'foreRadius', label: 'foreRadius', kind: 'length' },
    { key: 'aftRadius', label: 'aftRadius', kind: 'length' },
    { key: 'thickness', label: 'thickness', kind: 'length' },
    { key: 'foreShoulderLength', label: 'foreShoulderLength', kind: 'length' },
    { key: 'foreShoulderRadius', label: 'foreShoulderRadius', kind: 'length' },
    { key: 'aftShoulderLength', label: 'aftShoulderLength', kind: 'length' },
    { key: 'aftShoulderRadius', label: 'aftShoulderRadius', kind: 'length' },
  ],
  trapezoidfinset: [
    { key: 'finCount', label: 'finCount', kind: 'count' },
    { key: 'rootChord', label: 'rootChord', kind: 'length' },
    { key: 'tipChord', label: 'tipChord', kind: 'length' },
    { key: 'sweep', label: 'sweep', kind: 'length' },
    { key: 'height', label: 'height', kind: 'length' },
    { key: 'thickness', label: 'thickness', kind: 'length' },
    { key: 'cant', label: 'cant', kind: 'angle', step: 0.5 },
    ...FIN_TABS,
  ],
  ellipticalfinset: [
    { key: 'finCount', label: 'finCount', kind: 'count' },
    { key: 'rootChord', label: 'rootChord', kind: 'length' },
    { key: 'height', label: 'height', kind: 'length' },
    { key: 'thickness', label: 'thickness', kind: 'length' },
    { key: 'cant', label: 'cant', kind: 'angle', step: 0.5 },
    ...FIN_TABS,
  ],
  freeformfinset: [
    { key: 'finCount', label: 'finCount', kind: 'count' },
    { key: 'thickness', label: 'thickness', kind: 'length' },
    { key: 'cant', label: 'cant', kind: 'angle', step: 0.5 },
    ...FIN_TABS,
  ],
  tubefinset: [
    { key: 'finCount', label: 'tubeCount', kind: 'count' },
    { key: 'length', label: 'length', kind: 'length' },
    { key: 'outerRadius', label: 'tubeRadius', kind: 'length' },
    { key: 'thickness', label: 'thickness', kind: 'length' },
  ],
  innertube: [
    { key: 'length', label: 'length', kind: 'length' },
    { key: 'outerRadius', label: 'radius', kind: 'length' },
    { key: 'thickness', label: 'thickness', kind: 'length' },
    { key: 'motorMount', label: 'motorMount', kind: 'bool' },
    { key: 'motorOverhang', label: 'motorOverhang', kind: 'length' },
  ],
  tubecoupler: [
    { key: 'length', label: 'length', kind: 'length' },
    { key: 'outerRadius', label: 'radius', kind: 'length' },
    { key: 'thickness', label: 'thickness', kind: 'length' },
  ],
  centeringring: [
    { key: 'length', label: 'thickness', kind: 'length' },
    { key: 'outerRadius', label: 'outerRadius', kind: 'length' },
    { key: 'innerRadius', label: 'innerRadius', kind: 'length' },
  ],
  bulkhead: [
    { key: 'length', label: 'thickness', kind: 'length' },
    { key: 'outerRadius', label: 'radius', kind: 'length' },
  ],
  engineblock: [
    { key: 'length', label: 'length', kind: 'length' },
    { key: 'outerRadius', label: 'radius', kind: 'length' },
    { key: 'thickness', label: 'thickness', kind: 'length' },
  ],
  launchlug: [
    { key: 'length', label: 'length', kind: 'length' },
    { key: 'outerRadius', label: 'radius', kind: 'length' },
    { key: 'angleOffset', label: 'angleAroundBody', kind: 'angle' },
  ],
  railbutton: [
    { key: 'outerDiameter', label: 'outerDiameter', kind: 'length' },
    { key: 'angleOffset', label: 'angleAroundBody', kind: 'angle' },
  ],
  parachute: [
    { key: 'diameter', label: 'diameter', kind: 'length' },
    { key: 'cd', label: 'dragCoeff', kind: 'number', step: 0.05 },
    { key: 'lineCount', label: 'lineCount', kind: 'count' },
    { key: 'lineLength', label: 'lineLength', kind: 'length' },
    { key: 'deployEvent', label: 'deployEvent', kind: 'select', options: DEPLOY_EVENTS, optI18n: 'deployEvent' },
    { key: 'deployAltitude', label: 'deployAltitude', kind: 'number', unit: 'm', step: 10 },
    { key: 'deployDelay', label: 'deployDelay', kind: 'number', unit: 's', step: 0.5 },
  ],
  streamer: [
    { key: 'stripLength', label: 'length', kind: 'length' },
    { key: 'stripWidth', label: 'width', kind: 'length' },
    { key: 'cd', label: 'dragCoeff', kind: 'number', step: 0.05 },
    { key: 'deployEvent', label: 'deployEvent', kind: 'select', options: DEPLOY_EVENTS, optI18n: 'deployEvent' },
    { key: 'deployAltitude', label: 'deployAltitude', kind: 'number', unit: 'm', step: 10 },
    { key: 'deployDelay', label: 'deployDelay', kind: 'number', unit: 's', step: 0.5 },
  ],
  masscomponent: [
    { key: 'mass', label: 'mass', kind: 'mass' },
    { key: 'length', label: 'length', kind: 'length' },
  ],
};

const numVal = (n: ComponentNode, key: string): number => (typeof n[key] === 'number' ? (n[key] as number) : 0);

function NumberField({ label, unit, value, step, min = 0, onChange, onCommit }: {
  label: string; unit?: string; value: number; step: number; min?: number; onChange: (v: number) => void;
  onCommit?: () => void; // fires on blur — closes the undo entry for this edit
}) {
  return (
    <label className="flex items-center justify-between gap-3">
      <span className="text-xs text-slate-400">{label}</span>
      <span className="flex items-center gap-1">
        <input
          type="number" value={Number.isFinite(value) ? +value.toFixed(4) : 0} step={step} min={min}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          onBlur={onCommit}
          className="w-24 rounded-md bg-slate-800 px-2 py-1 text-right text-sm text-slate-100 ring-1 ring-white/10 focus:outline-none focus:ring-sky-500"
        />
        {unit && <span className="w-6 text-xs text-slate-500">{unit}</span>}
      </span>
    </label>
  );
}

/** One override (mass / CG / CD): an enable checkbox + value, and — once enabled —
 *  an "apply to all subcomponents" toggle (OpenRocket's override-subtree flag). */
function OverrideRow({ label, unit, enabled, value, step, onToggle, onValue, onCommit, subLabel, sub, onSub }: {
  label: string; unit?: string; enabled: boolean; value: number; step: number;
  onToggle: (on: boolean) => void; onValue: (v: number) => void; onCommit?: () => void;
  subLabel: string; sub: boolean; onSub: (on: boolean) => void;
}) {
  return (
    <div className="space-y-1">
      <label className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-xs text-slate-400">
          <input type="checkbox" checked={enabled} onChange={(e) => { onToggle(e.target.checked); onCommit?.(); }} className="accent-sky-500" />
          {label}
        </span>
        <span className="flex items-center gap-1">
          <input
            type="number" disabled={!enabled} step={step} min={0}
            value={Number.isFinite(value) ? +value.toFixed(4) : 0}
            onChange={(e) => onValue(parseFloat(e.target.value) || 0)}
            onBlur={onCommit}
            className="w-24 rounded-md bg-slate-800 px-2 py-1 text-right text-sm text-slate-100 ring-1 ring-white/10 focus:outline-none focus:ring-sky-500 disabled:opacity-40"
          />
          {unit && <span className="w-6 text-xs text-slate-500">{unit}</span>}
        </span>
      </label>
      {enabled && (
        <label className="flex items-center gap-2 pl-6 text-[11px] text-slate-500">
          <input type="checkbox" checked={sub} onChange={(e) => { onSub(e.target.checked); onCommit?.(); }} className="accent-sky-500" />
          {subLabel}
        </label>
      )}
    </div>
  );
}

export function PropertyPanel({ node, onChange, onCommit, onRemove, onMove, canMoveUp, canMoveDown }: {
  node: ComponentNode | null;
  onChange: (patch: Partial<ComponentNode>) => void;
  /** Close the current edit's undo entry. Number/text fields fire it on blur;
   *  discrete controls (select, checkbox, pickers) fire it right after onChange. */
  onCommit?: () => void;
  onRemove: () => void;
  onMove?: (dir: -1 | 1) => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
}) {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const palette = mergePalette(settings.partColors);
  if (!node) {
    return (
      <section className="rounded-xl bg-slate-900 p-3 text-sm text-slate-500 ring-1 ring-white/10">
        {t('prop.selectHint')}
      </section>
    );
  }

  const fields = FIELDS[node.type] ?? [];
  const label = t(`part.${node.type}`, { defaultValue: node.type });
  const flabel = (f: Field) => t(`prop.${f.label}`);
  const pos = (node.position as ComponentPosition | undefined) ?? { method: 'top', offset: 0 };
  // Discrete controls (select / checkbox / pickers) finish the moment they
  // change, so patch and close the undo entry in one shot.
  const commitChange = (patch: Partial<ComponentNode>) => { onChange(patch); onCommit?.(); };

  return (
    <section className="space-y-3 rounded-xl bg-slate-900 p-3 ring-1 ring-white/10">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</h2>
        {node.type !== 'stage' && (
          <div className="flex items-center gap-1">
            {onMove && (
              <>
                <button
                  onClick={() => onMove(-1)} disabled={!canMoveUp} title={t('prop.moveUp')}
                  className="rounded-md bg-slate-800 px-2 py-1 text-xs text-slate-300 ring-1 ring-white/10 hover:bg-slate-700 disabled:cursor-not-allowed disabled:text-slate-600 disabled:hover:bg-slate-800"
                >↑</button>
                <button
                  onClick={() => onMove(1)} disabled={!canMoveDown} title={t('prop.moveDown')}
                  className="rounded-md bg-slate-800 px-2 py-1 text-xs text-slate-300 ring-1 ring-white/10 hover:bg-slate-700 disabled:cursor-not-allowed disabled:text-slate-600 disabled:hover:bg-slate-800"
                >↓</button>
              </>
            )}
            <button
              onClick={onRemove}
              className="rounded-md bg-red-500/15 px-2 py-1 text-xs font-medium text-red-300 ring-1 ring-red-500/30 hover:bg-red-500/25"
            >
              {t('prop.delete')}
            </button>
          </div>
        )}
      </div>

      <label className="flex items-center justify-between gap-3">
        <span className="text-xs text-slate-400">{t('prop.name')}</span>
        <input
          type="text" value={typeof node.name === 'string' ? node.name : ''} placeholder={label}
          onChange={(e) => onChange({ name: e.target.value })} onBlur={onCommit}
          className="w-40 rounded-md bg-slate-800 px-2 py-1 text-sm text-slate-100 ring-1 ring-white/10 focus:outline-none focus:ring-sky-500"
        />
      </label>

      {node.type !== 'stage' && (
        <label className="flex items-center justify-between gap-3">
          <span className="text-xs text-slate-400">{t('prop.color')}</span>
          <span className="flex items-center gap-2">
            <input
              type="color"
              value={typeof node.color === 'string' ? node.color : colorForType(node.type, palette)}
              onChange={(e) => onChange({ color: e.target.value })} onBlur={onCommit}
              className="h-7 w-10 cursor-pointer rounded-md border border-white/10 bg-slate-800 p-0.5"
            />
            {typeof node.color === 'string' && (
              <button
                onClick={() => commitChange({ color: undefined })} title={t('prop.resetColor')}
                className="rounded-md bg-slate-800 px-2 py-1 text-xs text-slate-400 ring-1 ring-white/10 hover:bg-slate-700"
              >↺</button>
            )}
          </span>
        </label>
      )}

      {hasCatalog(node.type) && (
        <ComponentPicker type={node.type as CatalogType} onApply={(p) => commitChange(catalogPatch(p))} />
      )}

      {fields.map((f) => {
        if (f.kind === 'select') {
          const cur = typeof node[f.key] === 'string' ? (node[f.key] as string) : f.options[0];
          return (
            <label key={f.key} className="flex items-center justify-between gap-3">
              <span className="text-xs text-slate-400">{flabel(f)}</span>
              <select
                value={cur} onChange={(e) => commitChange({ [f.key]: e.target.value })}
                className="w-32 rounded-md bg-slate-800 px-2 py-1 text-sm text-slate-100 ring-1 ring-white/10 focus:outline-none focus:ring-sky-500"
              >
                {f.options.map((o) => <option key={o} value={o}>{f.optI18n ? t(`${f.optI18n}.${o}`) : o}</option>)}
              </select>
            </label>
          );
        }
        if (f.kind === 'count') {
          return (
            <NumberField key={f.key} label={flabel(f)} value={numVal(node, f.key)} step={1}
              onChange={(v) => onChange({ [f.key]: Math.max(1, Math.round(v)) })} onCommit={onCommit} />
          );
        }
        if (f.kind === 'bool') {
          return (
            <label key={f.key} className="flex items-center justify-between gap-3">
              <span className="text-xs text-slate-400">{flabel(f)}</span>
              <input
                type="checkbox" checked={node[f.key] === true}
                onChange={(e) => commitChange({ [f.key]: e.target.checked })}
                className="accent-sky-500"
              />
            </label>
          );
        }
        if (f.kind === 'mass') {
          return (
            <NumberField key={f.key} label={flabel(f)} unit="g" value={numVal(node, f.key) * 1000} step={0.5}
              onChange={(v) => onChange({ [f.key]: v / 1000 })} onCommit={onCommit} />
          );
        }
        if (f.kind === 'number') {
          return (
            <NumberField key={f.key} label={flabel(f)} unit={f.unit} value={numVal(node, f.key)} step={f.step ?? 0.1}
              onChange={(v) => onChange({ [f.key]: v })} onCommit={onCommit} />
          );
        }
        if (f.kind === 'angle') {
          // Stored in radians (kernel/.ork convention), edited in degrees.
          return (
            <NumberField key={f.key} label={flabel(f)} unit="°" min={-180} step={f.step ?? 5}
              value={(numVal(node, f.key) * 180) / Math.PI}
              onChange={(v) => onChange({ [f.key]: (v * Math.PI) / 180 })} onCommit={onCommit} />
          );
        }
        // length: stored metres, shown mm
        return (
          <NumberField key={f.key} label={flabel(f)} unit="mm" value={numVal(node, f.key) * 1000} step={0.5}
            onChange={(v) => onChange({ [f.key]: v / 1000 })} onCommit={onCommit} />
        );
      })}

      {hasMaterial(node.type) && (
        <div className="border-t border-white/5 pt-3">
          <MaterialPicker
            value={typeof node.materialName === 'string' ? node.materialName : undefined}
            onChange={(name, d) => commitChange({ materialName: name, density: d || undefined })}
          />
        </div>
      )}

      {/* Freeform fin: its defining feature is the outline polygon, edited
          graphically rather than as scalar fields. */}
      {node.type === 'freeformfinset' && (
        <div className="border-t border-white/5 pt-3">
          <FreeformFinEditor
            points={(node.points as [number, number][] | undefined) ?? []}
            onChange={(pts) => onChange({ points: pts } as Partial<ComponentNode>)}
            onCommit={onCommit}
          />
        </div>
      )}

      {/* Recovery devices use surface (fabric) + line (cord) materials, not the
          bulk material above — each feeds the device's mass. */}
      {(node.type === 'parachute' || node.type === 'streamer') && (
        <div className="space-y-3 border-t border-white/5 pt-3">
          <MaterialPicker
            type="surface"
            label={t(node.type === 'streamer' ? 'material.strip' : 'material.canopy')}
            value={typeof node.surfaceMaterialName === 'string' ? node.surfaceMaterialName : undefined}
            onChange={(name, d) => commitChange({ surfaceMaterialName: name, surfaceDensity: d || undefined })}
          />
          {node.type === 'parachute' && (
            <MaterialPicker
              type="line"
              label={t('material.lines')}
              value={typeof node.lineMaterialName === 'string' ? node.lineMaterialName : undefined}
              onChange={(name, d) => commitChange({ lineMaterialName: name, lineDensity: d || undefined })}
            />
          )}
        </div>
      )}

      {/* Mass / CG / CD overrides (OpenRocket semantics). A stage-level override
          with "all subcomponents" on is the usual way to pin a measured mass/CG. */}
      <div className="space-y-3 border-t border-white/5 pt-3">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{t('override.title')}</div>
        <OverrideRow
          label={t('override.mass')} unit="g" step={0.5}
          enabled={typeof node.overrideMass === 'number'} value={numVal(node, 'overrideMass') * 1000}
          onToggle={(on) => onChange({ overrideMass: on ? Math.max(numVal(node, 'overrideMass'), 0.01) : undefined, overrideSubcomponentsMass: on ? node.overrideSubcomponentsMass as boolean | undefined : undefined })}
          onValue={(v) => onChange({ overrideMass: v / 1000 })} onCommit={onCommit}
          subLabel={t('override.applyAll')} sub={node.overrideSubcomponentsMass === true}
          onSub={(on) => onChange({ overrideSubcomponentsMass: on || undefined })}
        />
        <OverrideRow
          label={t(node.type === 'stage' ? 'override.cgStage' : 'override.cg')} unit="mm" step={1}
          enabled={typeof node.overrideCGX === 'number'} value={numVal(node, 'overrideCGX') * 1000}
          onToggle={(on) => onChange({ overrideCGX: on ? numVal(node, 'overrideCGX') : undefined, overrideSubcomponentsCG: on ? node.overrideSubcomponentsCG as boolean | undefined : undefined })}
          onValue={(v) => onChange({ overrideCGX: v / 1000 })} onCommit={onCommit}
          subLabel={t('override.applyAll')} sub={node.overrideSubcomponentsCG === true}
          onSub={(on) => onChange({ overrideSubcomponentsCG: on || undefined })}
        />
        <OverrideRow
          label={t('override.cd')} step={0.05}
          enabled={typeof node.overrideCD === 'number'} value={numVal(node, 'overrideCD')}
          onToggle={(on) => onChange({ overrideCD: on ? (numVal(node, 'overrideCD') || 0.5) : undefined, overrideSubcomponentsCD: on ? node.overrideSubcomponentsCD as boolean | undefined : undefined })}
          onValue={(v) => onChange({ overrideCD: v })} onCommit={onCommit}
          subLabel={t('override.applyAll')} sub={node.overrideSubcomponentsCD === true}
          onSub={(on) => onChange({ overrideSubcomponentsCD: on || undefined })}
        />
        <p className="text-[11px] leading-snug text-slate-500">{t('override.cpNote')}</p>
      </div>

      {/* Placement — only meaningful for parts nested inside a tube. */}
      {node.type !== 'stage' && !isAxial(node.type) && (
        <div className="space-y-3 border-t border-white/5 pt-3">
          <label className="flex items-center justify-between gap-3">
            <span className="text-xs text-slate-400">{t('prop.positionFrom')}</span>
            <select
              value={pos.method}
              onChange={(e) => commitChange({ position: { ...pos, method: e.target.value as ComponentPosition['method'] } })}
              className="w-32 rounded-md bg-slate-800 px-2 py-1 text-sm text-slate-100 ring-1 ring-white/10 focus:outline-none focus:ring-sky-500"
            >
              {(['top', 'middle', 'bottom', 'absolute'] as const).map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
          <NumberField label={t('prop.offset')} unit="mm" value={pos.offset * 1000} step={1} min={-100000}
            onChange={(v) => onChange({ position: { ...pos, offset: v / 1000 } })} onCommit={onCommit} />
        </div>
      )}
    </section>
  );
}
