import { useEffect, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { ComponentNode, ComponentType, RocketTree } from '../../engine/openRocketEngine';
import { allowedChildren, findNode } from '../../services/design/treeEdit';
import { ComponentExportButton } from './ComponentExportButton';
import { useUnits, type Units } from '../../prefs/useUnits';
import { partLabel } from '../../i18n/format';
import { isFinSet } from '../../tree/tubefins';
import { token } from '../common/colorTokens';
import type { TreeCommand } from './useTreeEdit';

// Parts offered in the "Add part" menu, grouped like OpenRocket's palette.
// Labels come from the `part.*` / `tree.*` i18n keys at render time.
const ADD_GROUPS: { group: string; items: ComponentType[] }[] = [
  { group: 'groupBody', items: ['nosecone', 'bodytube', 'transition'] },
  { group: 'groupFins', items: ['trapezoidfinset', 'ellipticalfinset', 'freeformfinset', 'tubefinset'] },
  { group: 'groupInner', items: ['innertube', 'tubecoupler', 'centeringring', 'bulkhead', 'engineblock'] },
  { group: 'groupRecovery', items: ['parachute', 'streamer'] },
  { group: 'groupOther', items: ['launchlug', 'masscomponent'] },
  { group: 'groupAssembly', items: ['podset'] },
];

/**
 * Read-only component tree for the left panel: an OpenRocket-style indented
 * hierarchy of the rocket's parts (stage > components > sub-components). Renders
 * the same `RocketTree` the 2D/3D views draw, so it works for a loaded `.ork`
 * design as well as the built-in editor design. Each row shows a category dot,
 * the part name, a "motor" tag on motor mounts, and a key dimension.
 *
 * Selection is two-way with the 2D schematic: clicking a row selects the part
 * (and the schematic outlines it); selecting in the schematic highlights the
 * row here and scrolls it into view.
 *
 * A real `tree` of `treeitem`s, not `role="button"` rows: a button may not contain
 * interactive content, which the expand toggle and the export button are, and it
 * tells a screen reader nothing about depth, folding or which row is selected. The
 * rows are a flat list; `aria-level` carries the depth, as ARIA allows for a
 * flattened tree.
 */

/**
 * The two tree walks the memos below run, at module scope. The compiler lint
 * reads a recursive arrow inside a useMemo, a closure that calls itself, as a
 * missing dependency; a plain function that takes what it needs has no closure
 * to be wrong about.
 */
/** Every id-bearing node that has children (the collapsible ones), in tree order. */
function collectBranchIds(nodes: ComponentNode[], out: string[]): string[] {
  for (const n of nodes) {
    if (typeof n.id === 'string' && (n.children?.length ?? 0) > 0) out.push(n.id);
    collectBranchIds(n.children ?? [], out);
  }
  return out;
}
/** The visible, selectable rows in the order they are drawn: children of a
 *  collapsed branch are skipped, and nothing is selectable without `onSelect`. */
function collectVisibleIds(
  nodes: ComponentNode[],
  collapsed: ReadonlySet<string>,
  selectable: boolean,
  out: string[],
): string[] {
  for (const n of nodes) {
    const nid = typeof n.id === 'string' ? n.id : undefined;
    if (nid && selectable) out.push(nid);
    const hasKids = (n.children?.length ?? 0) > 0;
    const isCollapsed = hasKids && !!nid && collapsed.has(nid);
    if (!isCollapsed) collectVisibleIds(n.children ?? [], collapsed, selectable, out);
  }
  return out;
}

/** A tree row's key dimension, in the user's length unit. */
const len = (u: Units, v: unknown): string | null =>
  typeof v === 'number' && Number.isFinite(v) ? `${u.fmtSym('length', v)}` : null;

// Category colors match the app palette: structure = sky, fins = amber,
// recovery = emerald, inner structure = slate, attachments/mass = violet.
const TYPE_COLOR: Record<string, string> = {
  stage: token('ink'),
  nosecone: token('series-1'),
  transition: token('series-1'),
  bodytube: token('series-1'),
  fairing: token('series-1'),
  trapezoidfinset: token('series-2'),
  ellipticalfinset: token('series-2'),
  freeformfinset: token('series-2'),
  tubefinset: token('series-2'),
  innertube: token('ink-muted'),
  tubecoupler: token('ink-muted'),
  centeringring: token('ink-muted'),
  bulkhead: token('ink-muted'),
  engineblock: token('ink-muted'),
  launchlug: token('series-4'),
  railbutton: token('series-4'),
  masscomponent: token('series-4'),
  parachute: token('series-3'),
  streamer: token('series-3'),
  shockcord: token('series-3'),
  podset: token('ink'),
  parallelstage: token('ink'),
};

// A distinct glyph per component type, colored by TYPE_COLOR so
// the tree reads by shape and color at a glance.
const TYPE_SYMBOL: Record<string, string> = {
  stage: '≡',
  nosecone: '▲',
  transition: '◣',
  bodytube: '▭',
  fairing: '◗',
  trapezoidfinset: '◹',
  ellipticalfinset: '◜',
  freeformfinset: '◿',
  tubefinset: '⊚',
  innertube: '▫',
  tubecoupler: '⊟',
  centeringring: '◎',
  bulkhead: '▬',
  engineblock: '⊙',
  launchlug: '▮',
  railbutton: '▪',
  masscomponent: '◆',
  parachute: '☂',
  streamer: '≈',
  shockcord: '∿',
  podset: '◧',
  parallelstage: '❚',
};

const typeLabel = (type: string, t: TFunction): string => t(`part.${type}`, { defaultValue: type });

function detail(n: ComponentNode, t: TFunction, u: Units): string {
  const ty = n.type;
  if (ty === 'nosecone')
    return [typeof n.shape === 'string' ? n.shape : null, len(u, n.length)].filter(Boolean).join(' · ');
  if (isFinSet(ty)) {
    const c = n.finCount ?? n.count;
    return typeof c === 'number' ? t('tree.fins', { count: c }) : '';
  }
  if (ty === 'parachute') {
    const d = len(u, n.diameter);
    return d ? `⌀ ${d}` : '';
  }
  if (ty === 'streamer') return len(u, n.stripLength) ?? '';
  if (ty === 'masscomponent') return typeof n.mass === 'number' ? `${u.fmtSym('mass', n.mass)}` : '';
  if (ty === 'centeringring' || ty === 'bulkhead') {
    const d = len(u, (n.outerRadius as number) * 2);
    return d ? `⌀ ${d}` : '';
  }
  return len(u, n.length) ?? '';
}

function Row({
  node,
  depth,
  selectedId,
  tabbableId,
  onSelect,
  collapsed,
  onToggleCollapse,
}: {
  node: ComponentNode;
  depth: number;
  selectedId?: string | null;
  // Roving tabindex: exactly one row carries tabIndex 0 (this id); the rest are
  // -1 and reached with the arrow keys. Keeps the whole tree to a single tab
  // stop instead of one per part.
  tabbableId?: string | null;
  onSelect?: (id: string) => void;
  collapsed: ReadonlySet<string>;
  onToggleCollapse: (id: string) => void;
}) {
  const { t } = useTranslation();
  const u = useUnits();
  const color = TYPE_COLOR[node.type] ?? token('ink-muted');
  const symbol = TYPE_SYMBOL[node.type] ?? '□';
  const label = typeLabel(node.type, t);
  const name = partLabel(t, node);
  const isMount = node.motorMount === true;
  const det = detail(node, t, u);
  const id = typeof node.id === 'string' ? node.id : undefined;
  const selected = !!id && id === selectedId;
  const hasKids = (node.children?.length ?? 0) > 0;
  // Only id-bearing nodes can be remembered as collapsed; a childless or id-less
  // node just shows a spacer so every row's label lines up.
  const isCollapsed = hasKids && !!id && collapsed.has(id);
  const selectable = !!id && !!onSelect;
  const rowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selected) rowRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selected]);
  return (
    <>
      <div
        ref={rowRef}
        role="treeitem"
        aria-level={depth + 1}
        aria-selected={selectable ? selected : undefined}
        aria-expanded={hasKids && id ? !isCollapsed : undefined}
        tabIndex={selectable ? (id === tabbableId ? 0 : -1) : undefined}
        data-tree-row={selectable ? '1' : undefined}
        data-id={selectable ? id : undefined}
        data-haskids={hasKids && id ? '1' : undefined}
        data-collapsed={isCollapsed ? '1' : undefined}
        onClick={selectable ? () => onSelect(id) : undefined}
        onKeyDown={
          selectable
            ? (e) => {
                // Keyboard selection: the 2D/3D canvases are pointer-only, so
                // without this a keyboard user could reach no component at all.
                // Keys on the row's own controls (the export button and its
                // menu) are theirs: selecting here would cancel their click.
                if (e.target !== e.currentTarget) return;
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelect(id);
                }
              }
            : undefined
        }
        className={`flex items-center gap-2 rounded-md py-1 pr-2 ${selectable ? 'cursor-pointer' : ''} ${
          selected ? 'bg-accent-600/25 ring-1 ring-inset ring-accent-500/50' : 'hover:bg-raised'
        }`}
        // 2px, not 8: at depth 0 that leading gap is pure inset against the
        // spine, and every level below inherits it. The 16 per level is the
        // indent that actually says something.
        style={{ paddingLeft: 2 + depth * 16 }}
        title={label}
      >
        {hasKids && id ? (
          <button
            onClick={(e) => {
              e.stopPropagation(); // toggle the branch without selecting the row
              onToggleCollapse(id);
            }}
            aria-label={isCollapsed ? t('tree.expand') : t('tree.collapse')}
            tabIndex={-1}
            className="w-6 shrink-0 text-center text-xl leading-none text-ink-faint hover:text-ink"
          >
            {isCollapsed ? '▸' : '▾'}
          </button>
        ) : (
          <span className="w-6 shrink-0" aria-hidden />
        )}
        <span className="w-4 shrink-0 text-center text-xs leading-none" style={{ color }} aria-hidden>
          {symbol}
        </span>
        <span className={`truncate text-sm ${selected ? 'text-accent-200' : 'text-ink'}`}>{name}</span>
        {isMount && (
          <span className="shrink-0 rounded bg-accent-500/15 px-1 text-[10px] font-medium text-accent-300">
            {t('tree.motorTag')}
          </span>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-1 pl-2">
          {det && <span className="text-[11px] tabular-nums text-ink-faint">{det}</span>}
          {/* Tabbable only on the tree's tab stop row, so the tree stays one
              stop plus the export button of the row it is on. */}
          <ComponentExportButton node={node} tabIndex={selectable && id === tabbableId ? 0 : -1} />
        </div>
      </div>
      {!isCollapsed &&
        node.children?.map((c, i) => (
          <Row
            key={c.id ?? `${c.type}-${i}`}
            node={c}
            depth={depth + 1}
            selectedId={selectedId}
            tabbableId={tabbableId}
            onSelect={onSelect}
            collapsed={collapsed}
            onToggleCollapse={onToggleCollapse}
          />
        ))}
    </>
  );
}

export function ComponentTree({
  tree,
  selectedId,
  onSelect,
  onAdd,
  onScale,
  onAddStage,
  edit,
}: {
  tree: RocketTree;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  onAdd?: (type: ComponentType) => void;
  onScale?: () => void; // open the whole-rocket scale dialog
  onAddStage?: () => void; // append a new (booster) stage at the bottom
  /** Cut, Copy, Paste and Duplicate (useTreeEdit): buttons in the header, and their shortcuts on the rows. */
  edit?: { cut: TreeCommand; copy: TreeCommand; paste: TreeCommand; duplicate: TreeCommand };
}) {
  const { t } = useTranslation();
  // Ids of collapsed (folded) branches: ephemeral view state per node id.
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const toggleCollapse = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  // Every id-bearing node that has children (the collapsible ones), so the
  // header toggle can fold or unfold the whole tree at once. Memoized: it walks
  // the whole tree and only changes when the components do, not on every
  // selection/hover re-render.
  const branchIds = useMemo(() => collectBranchIds(tree.components, []), [tree.components]);
  const allCollapsed = branchIds.length > 0 && branchIds.every((id) => collapsed.has(id));
  const toggleAll = () => setCollapsed(allCollapsed ? new Set() : new Set(branchIds));

  // Roving-tabindex arrow navigation. `orderedIds` is the visible, selectable
  // rows in the order they're drawn (children of a collapsed branch are
  // skipped). Exactly one of them is tabbable at a time; the arrow keys move
  // focus between them, so the whole tree is one tab stop, not one per part.
  const listRef = useRef<HTMLDivElement>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const orderedIds = useMemo(
    () => collectVisibleIds(tree.components, collapsed, !!onSelect, []),
    [tree.components, collapsed, onSelect],
  );
  // The single tabbable row: the last arrow-focused row if still visible, else
  // the selected row, else the first, so Tab always lands somewhere sensible.
  const tabbableId =
    (activeId && orderedIds.includes(activeId) && activeId) ||
    (selectedId && orderedIds.includes(selectedId) && selectedId) ||
    orderedIds[0] ||
    null;

  /*
   * Keep keyboard focus in the tree across an edit that rebuilds it.
   *
   * Cut removes the focused row, and undo or redo replaces the rows, so focus
   * falls to the page body and the arrow keys stop working until the user tabs
   * back in. While the tree holds focus, `ownsFocus` is set; it is cleared when
   * focus moves deliberately elsewhere (to another element, or a click on
   * something that takes no focus, which leaves the row still in the page).
   * After any change to the rows, if focus was lost from the tree, it goes to
   * the selected row, else the tab stop.
   */
  const ownsFocus = useRef(false);
  const onTreeFocus = () => {
    ownsFocus.current = true;
  };
  const onTreeBlur = (e: FocusEvent<HTMLDivElement>) => {
    const to = e.relatedTarget as Node | null;
    if (to) {
      if (!listRef.current?.contains(to)) ownsFocus.current = false;
      return;
    }
    // Nothing took focus. A row still in the page means the user clicked away;
    // a row the edit removed means focus was lost, which the effect restores.
    const from = e.target;
    setTimeout(() => {
      if (from.isConnected) ownsFocus.current = false;
    }, 0);
  };
  const focusTarget = (selectedId && orderedIds.includes(selectedId) && selectedId) || tabbableId;
  // The selection the effect last saw. Focus follows a change of selection that
  // happens while a row has focus (undo or redo restoring one), and is left
  // alone otherwise, so arrowing through the rows or folding a branch keeps it
  // where the user put it.
  const lastSelected = useRef(selectedId);
  useEffect(() => {
    const selectionMoved = lastSelected.current !== selectedId;
    lastSelected.current = selectedId;
    if (!ownsFocus.current || !focusTarget) return;
    const active = document.activeElement;
    const lost = !active || active === document.body;
    const onRow = !!active && !!listRef.current?.contains(active);
    if (!lost && !(onRow && selectionMoved)) return;
    const row = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-tree-row]') ?? []).find(
      (el) => el.getAttribute('data-id') === focusTarget,
    );
    if (!row || row === active) return;
    row.focus();
    setActiveId(focusTarget);
  }, [orderedIds, focusTarget, selectedId]);

  const onTreeKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const rowEl = (e.target as HTMLElement).closest<HTMLElement>('[data-tree-row]');
    if (!rowEl || !listRef.current?.contains(rowEl)) return;
    // Only the row itself navigates: arrows pressed inside a row's export menu
    // belong to that menu.
    if (e.target !== rowEl) return;
    // Desktop's Edit shortcuts, on the selected part, while a row has focus.
    // Scoped to the tree so text fields keep their own copy and paste, and
    // Ctrl+D here duplicates rather than bookmarking the page.
    if (edit && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
      const command = { x: edit.cut, c: edit.copy, v: edit.paste, d: edit.duplicate }[e.key.toLowerCase()];
      if (command) {
        e.preventDefault();
        if (command.enabled) command.run();
        return;
      }
    }
    const rows = Array.from(listRef.current.querySelectorAll<HTMLElement>('[data-tree-row]'));
    const idx = rows.indexOf(rowEl);
    if (idx < 0) return;
    const move = (to?: HTMLElement) => {
      if (!to) return;
      e.preventDefault();
      to.focus();
      const rid = to.getAttribute('data-id');
      if (rid) setActiveId(rid);
    };
    const rid = rowEl.getAttribute('data-id');
    const hasKids = rowEl.getAttribute('data-haskids') === '1';
    const isCollapsed = rowEl.getAttribute('data-collapsed') === '1';
    switch (e.key) {
      case 'ArrowDown':
        move(rows[idx + 1]);
        break;
      case 'ArrowUp':
        move(rows[idx - 1]);
        break;
      case 'Home':
        move(rows[0]);
        break;
      case 'End':
        move(rows[rows.length - 1]);
        break;
      case 'ArrowRight':
        // Collapsed branch: expand; otherwise step to the next row.
        if (rid && hasKids && isCollapsed) {
          e.preventDefault();
          toggleCollapse(rid);
        } else move(rows[idx + 1]);
        break;
      case 'ArrowLeft':
        // Expanded branch: collapse; otherwise step to the previous row.
        if (rid && hasKids && !isCollapsed) {
          e.preventDefault();
          toggleCollapse(rid);
        } else move(rows[idx - 1]);
        break;
    }
  };

  // Fold the whole list away (header stays) so the property editor gets the room
  // once a part is picked. Collapsed, the header names the selected part.
  const [listOpen, setListOpen] = useState(true);
  // One lookup serves both the collapsed header's name and the Add menu's parent
  // type.
  const selectedNode = selectedId ? findNode(tree, selectedId) : null;
  const selectedName = selectedNode
    ? typeof selectedNode.name === 'string' && selectedNode.name
      ? selectedNode.name
      : typeLabel(selectedNode.type, t)
    : null;

  // The Add menu is contextual: it offers only the child types valid for the
  // selected part (the stage when nothing is selected). A leaf part: no menu.
  const parentType = selectedNode?.type ?? 'stage';
  const parentLabel = typeLabel(parentType, t);
  const allowed = new Set<ComponentType>(allowedChildren(parentType));
  const groups = ADD_GROUPS.map((g) => ({ group: g.group, items: g.items.filter((ty) => allowed.has(ty)) })).filter(
    (g) => g.items.length > 0,
  );

  return (
    // p-2, not p-3. This card sits inside the pane's own padding, so every
    // pixel here is the second gutter on the same edge, and the one on the left
    // pushes the whole tree right, where it comes straight off the part names at
    // every depth.
    <section className="rounded-xl bg-surface p-2 ring-1 ring-line/10">
      {/* Everything you do to the design, on one row above the list: add a stage,
          add a component to the selected part, scale the whole rocket. One row
          reads as one group and costs no extra height.

          The three plus their gaps come to about 253px, which is what sets
          TREE_PANE_MIN: below it Scale wraps to a line of its own. They still
          wrap rather than squeeze, so a narrower panel degrades instead of
          clipping. */}
      {(onAdd || onAddStage || onScale) && (
        <div className="mb-2 flex flex-wrap items-center gap-2">
          {onAddStage && (
            <button
              onClick={onAddStage}
              title={t('tree.addStageTitle')}
              className="whitespace-nowrap rounded-md bg-raised px-2.5 py-1.5 text-xs font-medium text-accent-300 ring-1 ring-line/10 hover:bg-elevated"
            >
              {t('tree.addStage')}
            </button>
          )}
          {onAdd && (
            <select
              value=""
              disabled={groups.length === 0}
              onChange={(e) => {
                const v = e.target.value as ComponentType;
                if (v) onAdd(v);
                e.currentTarget.value = '';
              }}
              className="rounded-md bg-raised px-2.5 py-1.5 text-xs font-medium text-accent-300 ring-1 ring-line/10 focus:outline-none focus:ring-accent-500 disabled:text-ink-dim"
              title={
                groups.length ? t('tree.canHost', { parent: parentLabel }) : t('tree.cantHost', { parent: parentLabel })
              }
            >
              <option value="">{t('tree.add')}</option>
              {groups.map((g) => (
                <optgroup key={g.group} label={t(`tree.${g.group}`)}>
                  {g.items.map((ty) => (
                    <option key={ty} value={ty}>
                      {typeLabel(ty, t)}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          )}
          {onScale && (
            <button
              onClick={onScale}
              title={t('scale.title')}
              className="whitespace-nowrap rounded-md bg-raised px-2.5 py-1.5 text-xs font-medium text-accent-300 ring-1 ring-line/10 hover:bg-elevated"
            >
              {t('tree.scale')}
            </button>
          )}
        </div>
      )}
      <div className="mb-2 flex min-w-0 items-center gap-1.5">
        {/* Fold the whole tree list; the header (and this toggle) stay put.
            The button sits inside the heading, as in the disclosure pattern: a
            heading inside a button is flattened into the button's name. */}
        <h2 className="flex min-w-0">
          <button
            onClick={() => setListOpen((o) => !o)}
            aria-expanded={listOpen}
            title={listOpen ? t('tree.collapseTree') : t('tree.expandTree')}
            className="flex min-w-0 items-center gap-1.5 rounded px-1 py-0.5 hover:bg-raised"
          >
            <span className="text-base leading-none text-accent-400" aria-hidden="true">
              {listOpen ? '▾' : '▸'}
            </span>
            <span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-ink-muted">
              {t('tree.components')}
            </span>
            {!listOpen && selectedName && (
              <span className="truncate text-xs font-medium text-accent-300">· {selectedName}</span>
            )}
          </button>
        </h2>
        {listOpen && branchIds.length > 0 && (
          <button
            onClick={toggleAll}
            title={allCollapsed ? t('tree.expandAll') : t('tree.collapseAll')}
            aria-label={allCollapsed ? t('tree.expandAll') : t('tree.collapseAll')}
            className="rounded px-1 text-xl leading-none text-ink-faint hover:bg-raised hover:text-ink"
          >
            {allCollapsed ? '⊞' : '⊟'}
          </button>
        )}
        {edit && (
          <div className="ml-auto flex shrink-0 items-center gap-0.5">
            {(
              [
                // U+FE0E asks for the text glyph; without it the scissors draw as a color emoji.
                ['cut', '✂︎', edit.cut],
                ['copy', '⧉', edit.copy],
                ['paste', '⎘', edit.paste],
                ['duplicate', '❐', edit.duplicate],
              ] as const
            ).map(([key, glyph, command]) => (
              <button
                key={key}
                onClick={command.run}
                disabled={!command.enabled}
                title={command.title}
                aria-label={t(`tree.${key}`)}
                className="rounded px-1.5 py-0.5 text-sm leading-none text-ink-soft hover:bg-raised hover:text-ink disabled:cursor-not-allowed disabled:text-ink-dim disabled:hover:bg-transparent"
              >
                {glyph}
              </button>
            ))}
          </div>
        )}
      </div>
      {/* The rule is the tree's spine, so it keeps its 1px; there is no inset
          beside it, so that width goes to the names. */}
      {listOpen && (
        <div // eslint-disable-line jsx-a11y-x/interactive-supports-focus -- roving tabindex: the selected row is the tab stop, as in the ARIA tree pattern, so the container is not
          ref={listRef}
          role="tree"
          aria-label={t('tree.components')}
          onKeyDown={onTreeKeyDown}
          onFocus={onTreeFocus}
          onBlur={onTreeBlur}
          className="border-l border-line/5"
        >
          {tree.components.length ? (
            tree.components.map((c, i) => (
              <Row
                key={(c.id as string) ?? `${c.type}-${i}`}
                node={c}
                depth={0}
                selectedId={selectedId}
                tabbableId={tabbableId}
                onSelect={onSelect}
                collapsed={collapsed}
                onToggleCollapse={toggleCollapse}
              />
            ))
          ) : (
            <p className="px-2 py-1 text-sm text-ink-faint">{t('tree.noComponents')}</p>
          )}
        </div>
      )}
    </section>
  );
}
