import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { ComponentNode, ComponentType, RocketTree } from '../../engine/openRocketEngine';
import { allowedChildren, findNode } from '../../services/treeEdit';
import { fmtNum } from '../../i18n/format';

// Parts offered in the "Add part" menu, grouped like OpenRocket's palette.
// Labels come from the `part.*` / `tree.*` i18n keys at render time.
const ADD_GROUPS: { group: string; items: ComponentType[] }[] = [
  { group: 'groupBody', items: ['nosecone', 'bodytube', 'transition'] },
  { group: 'groupFins', items: ['trapezoidfinset', 'ellipticalfinset', 'freeformfinset', 'tubefinset'] },
  { group: 'groupInner', items: ['innertube', 'tubecoupler', 'centeringring', 'bulkhead', 'engineblock'] },
  { group: 'groupRecovery', items: ['parachute', 'streamer'] },
  { group: 'groupOther', items: ['launchlug', 'masscomponent'] },
];

/**
 * Read-only component tree for the left panel — an OpenRocket-style indented
 * hierarchy of the rocket's parts (stage → components → sub-components). Renders
 * the same `RocketTree` the 2D/3D views draw, so it works for a loaded `.ork`
 * design as well as the built-in editor design. Each row shows a category dot,
 * the part name, a "motor" tag on motor mounts, and a key dimension.
 *
 * Selection is two-way with the 2D schematic: clicking a row selects the part
 * (and the schematic outlines it); selecting in the schematic highlights the
 * row here and scrolls it into view.
 */

const mm = (v: unknown): string | null => {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const x = v * 1000;
  return `${fmtNum(x, x < 10 ? 1 : 0)} mm`;
};

// Category colors match the app palette: structure = sky, fins = amber,
// recovery = emerald, inner structure = slate, attachments/mass = violet.
const TYPE_COLOR: Record<string, string> = {
  stage: '#e2e8f0', nosecone: '#38bdf8', transition: '#38bdf8', bodytube: '#38bdf8', fairing: '#38bdf8',
  trapezoidfinset: '#fbbf24', ellipticalfinset: '#fbbf24', freeformfinset: '#fbbf24', tubefinset: '#fbbf24',
  innertube: '#94a3b8', tubecoupler: '#94a3b8', centeringring: '#94a3b8', bulkhead: '#94a3b8', engineblock: '#94a3b8',
  launchlug: '#a78bfa', railbutton: '#a78bfa', masscomponent: '#a78bfa',
  parachute: '#34d399', streamer: '#34d399', shockcord: '#34d399',
  podset: '#e2e8f0', parallelstage: '#e2e8f0',
};

// A distinct glyph per component type (mmrocket-style), coloured by TYPE_COLOR so
// the tree reads by shape AND colour at a glance.
const TYPE_SYMBOL: Record<string, string> = {
  stage: '≡',
  nosecone: '▲', transition: '◣', bodytube: '▭', fairing: '◗',
  trapezoidfinset: '◹', ellipticalfinset: '◜', freeformfinset: '◿', tubefinset: '⊚',
  innertube: '▫', tubecoupler: '⊟', centeringring: '◎', bulkhead: '▬', engineblock: '⊙',
  launchlug: '▮', railbutton: '▪', masscomponent: '◆',
  parachute: '☂', streamer: '≈', shockcord: '∿',
  podset: '◧', parallelstage: '❚',
};

const partLabel = (type: string, t: TFunction): string => t(`part.${type}`, { defaultValue: type });

function detail(n: ComponentNode, t: TFunction): string {
  const ty = n.type;
  if (ty === 'nosecone') return [typeof n.shape === 'string' ? n.shape : null, mm(n.length)].filter(Boolean).join(' · ');
  if (ty.endsWith('finset')) {
    const c = (n.finCount ?? n.count) as unknown;
    return typeof c === 'number' ? t('tree.fins', { count: c }) : '';
  }
  if (ty === 'parachute') { const d = mm(n.diameter); return d ? `⌀ ${d}` : ''; }
  if (ty === 'streamer') return mm(n.stripLength) ?? '';
  if (ty === 'masscomponent') return typeof n.mass === 'number' ? `${fmtNum(n.mass * 1000, 1)} g` : '';
  if (ty === 'centeringring' || ty === 'bulkhead') { const d = mm((n.outerRadius as number) * 2); return d ? `⌀ ${d}` : ''; }
  return mm(n.length) ?? '';
}

function Row({ node, depth, selectedId, onSelect, t }: {
  node: ComponentNode; depth: number; selectedId?: string | null; onSelect?: (id: string) => void; t: TFunction;
}) {
  const color = TYPE_COLOR[node.type] ?? '#94a3b8';
  const symbol = TYPE_SYMBOL[node.type] ?? '□';
  const label = partLabel(node.type, t);
  const name = typeof node.name === 'string' && node.name ? node.name : label;
  const isMount = node.motorMount === true;
  const det = detail(node, t);
  const id = typeof node.id === 'string' ? node.id : undefined;
  const selected = !!id && id === selectedId;
  const rowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selected) rowRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selected]);
  return (
    <>
      <div
        ref={rowRef}
        onClick={id && onSelect ? () => onSelect(id) : undefined}
        className={`flex items-center gap-2 rounded-md py-1 pr-2 ${id && onSelect ? 'cursor-pointer' : ''} ${
          selected ? 'bg-sky-600/25 ring-1 ring-inset ring-sky-500/50' : 'hover:bg-slate-800'
        }`}
        style={{ paddingLeft: 8 + depth * 16 }}
        title={label}
      >
        <span className="w-4 shrink-0 text-center text-xs leading-none" style={{ color }} aria-hidden>{symbol}</span>
        <span className={`truncate text-sm ${selected ? 'text-sky-200' : 'text-slate-200'}`}>{name}</span>
        {isMount && (
          <span className="shrink-0 rounded bg-sky-500/15 px-1 text-[10px] font-medium text-sky-300">{t('tree.motorTag')}</span>
        )}
        {det && <span className="ml-auto shrink-0 pl-2 text-[11px] tabular-nums text-slate-500">{det}</span>}
      </div>
      {node.children?.map((c, i) => (
        <Row key={(c.id as string) ?? `${c.type}-${i}`} node={c} depth={depth + 1} selectedId={selectedId} onSelect={onSelect} t={t} />
      ))}
    </>
  );
}

export function ComponentTree({ tree, selectedId, onSelect, onAdd, onRenameDesign, onCommit }: {
  tree: RocketTree; selectedId?: string | null; onSelect?: (id: string) => void;
  onAdd?: (type: ComponentType) => void;
  onRenameDesign?: (name: string) => void;
  onCommit?: () => void; // close the rename's undo entry when the field blurs
}) {
  const { t } = useTranslation();
  // The Add menu is contextual: it offers only the child types valid for the
  // selected part (the stage when nothing is selected). A leaf part → no menu.
  const parent = selectedId ? findNode(tree, selectedId) : null;
  const parentType = parent?.type ?? 'stage';
  const parentLabel = partLabel(parentType, t);
  const allowed = new Set<ComponentType>(allowedChildren(parentType));
  const groups = ADD_GROUPS
    .map((g) => ({ group: g.group, items: g.items.filter((ty) => allowed.has(ty)) }))
    .filter((g) => g.items.length > 0);

  return (
    <section className="rounded-xl bg-slate-900 p-3 ring-1 ring-white/10">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">{t('tree.components')}</h2>
        {onAdd && (
          <select
            value=""
            disabled={groups.length === 0}
            onChange={(e) => { const v = e.target.value as ComponentType; if (v) onAdd(v); e.currentTarget.value = ''; }}
            className="rounded-md bg-slate-800 px-2 py-1 text-xs font-medium text-sky-300 ring-1 ring-white/10 focus:outline-none focus:ring-sky-500 disabled:text-slate-600"
            title={groups.length ? t('tree.canHost', { parent: parentLabel }) : t('tree.cantHost', { parent: parentLabel })}
          >
            <option value="">{groups.length ? t('tree.addTo', { parent: parentLabel }) : t('tree.nothingToAdd')}</option>
            {groups.map((g) => (
              <optgroup key={g.group} label={t(`tree.${g.group}`)}>
                {g.items.map((ty) => <option key={ty} value={ty}>{partLabel(ty, t)}</option>)}
              </optgroup>
            ))}
          </select>
        )}
      </div>
      <div className="flex items-center gap-2 px-2 pb-1">
        <span className="text-sm">🚀</span>
        {onRenameDesign ? (
          <input
            value={tree.name || ''}
            onChange={(e) => onRenameDesign(e.target.value)} onBlur={onCommit}
            placeholder={t('tree.rocket')} aria-label={t('prop.name')} title={t('prop.name')}
            className="min-w-0 flex-1 truncate rounded bg-transparent px-1 text-sm font-semibold text-sky-400 hover:bg-slate-800/60 focus:bg-slate-800 focus:outline-none focus:ring-1 focus:ring-sky-500"
          />
        ) : (
          <span className="truncate text-sm font-semibold text-sky-400">{tree.name || t('tree.rocket')}</span>
        )}
      </div>
      <div className="border-l border-white/5 pl-1">
        {tree.components.length
          ? tree.components.map((c, i) => (
              <Row key={(c.id as string) ?? `${c.type}-${i}`} node={c} depth={0} selectedId={selectedId} onSelect={onSelect} t={t} />
            ))
          : <p className="px-2 py-1 text-sm text-slate-500">{t('tree.noComponents')}</p>}
      </div>
    </section>
  );
}
