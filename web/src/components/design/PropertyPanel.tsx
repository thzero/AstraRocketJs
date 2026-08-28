import { useTranslation } from 'react-i18next';
import type { ComponentNode, ComponentPosition } from '../../engine/openRocketEngine';
import { isAxial, hasCatalog, hasMaterial, catalogPatch } from '../../services/treeEdit';
import { colorForType, mergePalette } from '../../services/partColors';
import { useSettings } from '../../state/SettingsProvider';
import type { ComponentType as CatalogType } from '../../services/componentDb';
import { ComponentPicker } from './ComponentPicker';
import { MaterialPicker } from './MaterialPicker';

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
  | { key: string; label: string; kind: 'number'; step?: number }
  | { key: string; label: string; kind: 'select'; options: string[] };

// The real OpenRocket shape vocabulary — matches the engine (shapeOf), the
// drawing (shapeProfile), and the parts catalogue. NOT 'elliptical'/'powerseries'.
const NOSE_SHAPES = ['ogive', 'conical', 'ellipsoid', 'power', 'parabolic', 'haack'];

// `label` is an i18n key suffix under `prop.*` (resolved at render).
const FIELDS: Record<string, Field[]> = {
  nosecone: [
    { key: 'shape', label: 'shape', kind: 'select', options: NOSE_SHAPES },
    { key: 'length', label: 'length', kind: 'length' },
    { key: 'aftRadius', label: 'radius', kind: 'length' },
    { key: 'thickness', label: 'thickness', kind: 'length' },
  ],
  bodytube: [
    { key: 'length', label: 'length', kind: 'length' },
    { key: 'outerRadius', label: 'radius', kind: 'length' },
    { key: 'thickness', label: 'thickness', kind: 'length' },
  ],
  transition: [
    { key: 'shape', label: 'shape', kind: 'select', options: ['conical', 'ogive', 'ellipsoid', 'power', 'parabolic', 'haack'] },
    { key: 'length', label: 'length', kind: 'length' },
    { key: 'foreRadius', label: 'foreRadius', kind: 'length' },
    { key: 'aftRadius', label: 'aftRadius', kind: 'length' },
    { key: 'thickness', label: 'thickness', kind: 'length' },
  ],
  trapezoidfinset: [
    { key: 'finCount', label: 'finCount', kind: 'count' },
    { key: 'rootChord', label: 'rootChord', kind: 'length' },
    { key: 'tipChord', label: 'tipChord', kind: 'length' },
    { key: 'sweep', label: 'sweep', kind: 'length' },
    { key: 'height', label: 'height', kind: 'length' },
    { key: 'thickness', label: 'thickness', kind: 'length' },
  ],
  ellipticalfinset: [
    { key: 'finCount', label: 'finCount', kind: 'count' },
    { key: 'rootChord', label: 'rootChord', kind: 'length' },
    { key: 'height', label: 'height', kind: 'length' },
    { key: 'thickness', label: 'thickness', kind: 'length' },
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
    { key: 'length', label: 'thickness', kind: 'length' },
    { key: 'outerRadius', label: 'radius', kind: 'length' },
  ],
  launchlug: [
    { key: 'length', label: 'length', kind: 'length' },
    { key: 'outerRadius', label: 'radius', kind: 'length' },
  ],
  parachute: [
    { key: 'diameter', label: 'diameter', kind: 'length' },
    { key: 'cd', label: 'dragCoeff', kind: 'number', step: 0.05 },
  ],
  streamer: [
    { key: 'length', label: 'length', kind: 'length' },
    { key: 'width', label: 'width', kind: 'length' },
  ],
  masscomponent: [
    { key: 'mass', label: 'mass', kind: 'mass' },
    { key: 'length', label: 'length', kind: 'length' },
  ],
};

const numVal = (n: ComponentNode, key: string): number => (typeof n[key] === 'number' ? (n[key] as number) : 0);

function NumberField({ label, unit, value, step, min = 0, onChange }: {
  label: string; unit?: string; value: number; step: number; min?: number; onChange: (v: number) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3">
      <span className="text-xs text-slate-400">{label}</span>
      <span className="flex items-center gap-1">
        <input
          type="number" value={Number.isFinite(value) ? +value.toFixed(4) : 0} step={step} min={min}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          className="w-24 rounded-md bg-slate-800 px-2 py-1 text-right text-sm text-slate-100 ring-1 ring-white/10 focus:outline-none focus:ring-sky-500"
        />
        {unit && <span className="w-6 text-xs text-slate-500">{unit}</span>}
      </span>
    </label>
  );
}

/** One override (mass / CG / CD): an enable checkbox + value, and — once enabled —
 *  an "apply to all subcomponents" toggle (OpenRocket's override-subtree flag). */
function OverrideRow({ label, unit, enabled, value, step, onToggle, onValue, subLabel, sub, onSub }: {
  label: string; unit?: string; enabled: boolean; value: number; step: number;
  onToggle: (on: boolean) => void; onValue: (v: number) => void;
  subLabel: string; sub: boolean; onSub: (on: boolean) => void;
}) {
  return (
    <div className="space-y-1">
      <label className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-xs text-slate-400">
          <input type="checkbox" checked={enabled} onChange={(e) => onToggle(e.target.checked)} className="accent-sky-500" />
          {label}
        </span>
        <span className="flex items-center gap-1">
          <input
            type="number" disabled={!enabled} step={step} min={0}
            value={Number.isFinite(value) ? +value.toFixed(4) : 0}
            onChange={(e) => onValue(parseFloat(e.target.value) || 0)}
            className="w-24 rounded-md bg-slate-800 px-2 py-1 text-right text-sm text-slate-100 ring-1 ring-white/10 focus:outline-none focus:ring-sky-500 disabled:opacity-40"
          />
          {unit && <span className="w-6 text-xs text-slate-500">{unit}</span>}
        </span>
      </label>
      {enabled && (
        <label className="flex items-center gap-2 pl-6 text-[11px] text-slate-500">
          <input type="checkbox" checked={sub} onChange={(e) => onSub(e.target.checked)} className="accent-sky-500" />
          {subLabel}
        </label>
      )}
    </div>
  );
}

export function PropertyPanel({ node, onChange, onRemove, onMove, canMoveUp, canMoveDown }: {
  node: ComponentNode | null;
  onChange: (patch: Partial<ComponentNode>) => void;
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
          onChange={(e) => onChange({ name: e.target.value })}
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
              onChange={(e) => onChange({ color: e.target.value })}
              className="h-7 w-10 cursor-pointer rounded-md border border-white/10 bg-slate-800 p-0.5"
            />
            {typeof node.color === 'string' && (
              <button
                onClick={() => onChange({ color: undefined })} title={t('prop.resetColor')}
                className="rounded-md bg-slate-800 px-2 py-1 text-xs text-slate-400 ring-1 ring-white/10 hover:bg-slate-700"
              >↺</button>
            )}
          </span>
        </label>
      )}

      {hasCatalog(node.type) && (
        <ComponentPicker type={node.type as CatalogType} onApply={(p) => onChange(catalogPatch(p))} />
      )}

      {fields.map((f) => {
        if (f.kind === 'select') {
          const cur = typeof node[f.key] === 'string' ? (node[f.key] as string) : f.options[0];
          return (
            <label key={f.key} className="flex items-center justify-between gap-3">
              <span className="text-xs text-slate-400">{flabel(f)}</span>
              <select
                value={cur} onChange={(e) => onChange({ [f.key]: e.target.value })}
                className="w-32 rounded-md bg-slate-800 px-2 py-1 text-sm text-slate-100 ring-1 ring-white/10 focus:outline-none focus:ring-sky-500"
              >
                {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </label>
          );
        }
        if (f.kind === 'count') {
          return (
            <NumberField key={f.key} label={flabel(f)} value={numVal(node, f.key)} step={1}
              onChange={(v) => onChange({ [f.key]: Math.max(1, Math.round(v)) })} />
          );
        }
        if (f.kind === 'mass') {
          return (
            <NumberField key={f.key} label={flabel(f)} unit="g" value={numVal(node, f.key) * 1000} step={0.5}
              onChange={(v) => onChange({ [f.key]: v / 1000 })} />
          );
        }
        if (f.kind === 'number') {
          return (
            <NumberField key={f.key} label={flabel(f)} value={numVal(node, f.key)} step={f.step ?? 0.1}
              onChange={(v) => onChange({ [f.key]: v })} />
          );
        }
        // length: stored metres, shown mm
        return (
          <NumberField key={f.key} label={flabel(f)} unit="mm" value={numVal(node, f.key) * 1000} step={0.5}
            onChange={(v) => onChange({ [f.key]: v / 1000 })} />
        );
      })}

      {hasMaterial(node.type) && (
        <div className="border-t border-white/5 pt-3">
          <MaterialPicker
            value={typeof node.materialName === 'string' ? node.materialName : undefined}
            onChange={(name, d) => onChange({ materialName: name, density: d || undefined })}
          />
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
          onValue={(v) => onChange({ overrideMass: v / 1000 })}
          subLabel={t('override.applyAll')} sub={node.overrideSubcomponentsMass === true}
          onSub={(on) => onChange({ overrideSubcomponentsMass: on || undefined })}
        />
        <OverrideRow
          label={t(node.type === 'stage' ? 'override.cgStage' : 'override.cg')} unit="mm" step={1}
          enabled={typeof node.overrideCGX === 'number'} value={numVal(node, 'overrideCGX') * 1000}
          onToggle={(on) => onChange({ overrideCGX: on ? numVal(node, 'overrideCGX') : undefined, overrideSubcomponentsCG: on ? node.overrideSubcomponentsCG as boolean | undefined : undefined })}
          onValue={(v) => onChange({ overrideCGX: v / 1000 })}
          subLabel={t('override.applyAll')} sub={node.overrideSubcomponentsCG === true}
          onSub={(on) => onChange({ overrideSubcomponentsCG: on || undefined })}
        />
        <OverrideRow
          label={t('override.cd')} step={0.05}
          enabled={typeof node.overrideCD === 'number'} value={numVal(node, 'overrideCD')}
          onToggle={(on) => onChange({ overrideCD: on ? (numVal(node, 'overrideCD') || 0.5) : undefined, overrideSubcomponentsCD: on ? node.overrideSubcomponentsCD as boolean | undefined : undefined })}
          onValue={(v) => onChange({ overrideCD: v })}
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
              onChange={(e) => onChange({ position: { ...pos, method: e.target.value as ComponentPosition['method'] } })}
              className="w-32 rounded-md bg-slate-800 px-2 py-1 text-sm text-slate-100 ring-1 ring-white/10 focus:outline-none focus:ring-sky-500"
            >
              {(['top', 'middle', 'bottom', 'absolute'] as const).map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
          <NumberField label={t('prop.offset')} unit="mm" value={pos.offset * 1000} step={1} min={-100000}
            onChange={(v) => onChange({ position: { ...pos, offset: v / 1000 } })} />
        </div>
      )}
    </section>
  );
}
