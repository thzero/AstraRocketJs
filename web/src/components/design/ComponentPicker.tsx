import { useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  catalogTypeFor,
  componentsForType,
  type Component,
  type ComponentType,
  type PickerType,
  lengthOf,
  outerDiameterOf,
} from '../../services/parts/componentDb';
import {
  customRowsForType,
  deleteCustomPart,
  onSavedPartsChanged,
  savedPartsVersion,
} from '../../services/parts/customParts';
import {
  DEFAULT_CHUTE_CD,
  describeNotes,
  emptyQuery,
  fitRuleFor,
  manufacturers,
  materialFamilies,
  noseShapes,
  queryComponents,
  queryIsEmpty,
  type ComponentQuery,
  type FitContext,
  type Ranked,
  type SortKey,
} from '../../services/parts/componentFilter';
import { confirm } from '../../state/confirmStore';
import { fmtNum } from '../../i18n/format';
import { useUnits, type Units } from '../../prefs/useUnits';
import { useCatalogProgress } from '../common/CatalogLoading';
import { Dialog } from '../common/Dialog';
import { errorMessage } from '../../services/app/errorMessage';
import { progressPercent } from '../../services/app/remoteData';
import { SortHeader } from '../common/SortHeader';
import { UnitBound } from '../common/UnitBound';
import { useAsyncLoad } from '../common/useAsyncLoad';

/**
 * How many rows are rendered at once. There are 1088 body tubes and no
 * virtualization in the tree, so the list is capped. The footer reports the match
 * count and how many rows are held back, rather than printing the cap as the
 * total and making the catalog read as small.
 */
const ROW_CAP = 200;

/**
 * The catalog fetch as one state rather than three booleans, so `error &&
 * loading` cannot coexist and every branch below is one of exactly three.
 */
type CatalogState =
  { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; all: Component[] };
/** A fetch that finished, filed under the type and attempt it answers. */

/**
 * The rows for a node type: the user's own saved parts (customParts.ts) first,
 * then the manufacturer catalog. Saved first for the same reason imported
 * motors are (motorDb.loadCatalog): it is the order they are found in when
 * nothing is sorted yet, and the list is sorted by a column the moment the
 * dialog opens anyway.
 */
async function loadRows(type: PickerType): Promise<Component[]> {
  const catalogType = catalogTypeFor(type);
  const [saved, catalog] = await Promise.all([customRowsForType(catalogType), componentsForType(catalogType)]);
  return [...saved, ...catalog];
}

/**
 * Picks a real cataloged part (from the bundled OpenRocket component DB) of a
 * given type and applies it via `onApply`. Opens a modal dialog with a sortable
 * table, free-text search, a manufacturer facet, an outer-diameter range and a
 * "fits here" filter; the caller maps the chosen Component onto its target node
 * (see catalogPatch).
 */
export function ComponentPicker({
  type,
  fit,
  current,
  onApply,
}: {
  /** The node's type, not the catalog's: an inner tube is served by the body tube
   *  rows (see componentDb.catalogTypeFor) but has its own fit rule. */
  type: PickerType;
  /** Geometry around the node being filled, so the parts that actually fit can
   *  be ranked first. Absent is fine: the fit control then says so. */
  fit?: FitContext;
  /** The part this component is already linked to, so the list can mark it. */
  current?: string;
  onApply: (p: Component) => void;
}) {
  const { t } = useTranslation();
  // The catalog is fetched at runtime (see componentDb / remoteData), so load it
  // on mount and hold the result.
  // A save or a delete re-runs the load (`refresh`), but the list already in
  // hand stays ready while it does, so the open dialog is not torn down and the
  // button does not flash back to "Loading" for a change the user just made in
  // the panel behind it. A failure is reported with a retry, not swallowed:
  // swallowed, the button would read "Pick (0)" as though the catalog were empty.
  const version = useSyncExternalStore(onSavedPartsChanged, savedPartsVersion, savedPartsVersion);
  const rows = useAsyncLoad(() => loadRows(type), type, { refresh: version });
  const state: CatalogState = rows.loading
    ? { status: 'loading' }
    : rows.error !== null
      ? { status: 'error', message: rows.error }
      : { status: 'ready', all: rows.data! };
  // Live bytes for the component catalog (over 1 MB), so a slow link is legible.
  const progress = useCatalogProgress('components');
  const pct = progressPercent(progress);
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => (state.status === 'error' ? rows.retry() : setOpen(true))}
        disabled={state.status === 'loading'}
        title={state.status === 'error' ? state.message : undefined}
        className={`w-full rounded-lg px-2 py-1.5 text-xs font-medium hover:bg-elevated disabled:text-ink-faint ${
          state.status === 'error' ? 'bg-raised text-warn-300' : 'bg-raised text-ink'
        }`}
      >
        {state.status === 'error'
          ? t('catalog.retry')
          : state.status === 'loading'
            ? `${t('common.loading')}${pct == null ? '' : ` ${pct}%`}`
            : t('picker.pick', { count: state.all.length })}
      </button>

      {/* Mounted only while open: the query resets by unmount instead of by an
          effect on `open`. */}
      {open && state.status === 'ready' && (
        <PickerDialog
          type={type}
          all={state.all}
          fit={fit}
          current={current}
          onApply={(p) => {
            onApply(p);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

/** One table column: its heading, how to fill a cell, and what it sorts by. */
interface Col {
  key: string;
  head: string;
  /** Omitted for a column there is no sensible order for (notes). */
  sort?: SortKey;
  /** Numbers are right-aligned and tabular so digits line up down the column. */
  num?: boolean;
  /**
   * A fixed width, as a Tailwind class. Required on every column but the one
   * that takes up the slack, because the table is `table-fixed`.
   *
   * It has to be: with the browser's default `table-layout: auto` the widths are
   * computed from whichever rows happen to be rendered, so every keystroke in the
   * search box would relay the whole table out and the columns would jump around.
   * Fixed widths mean typing narrows the list without moving anything.
   */
  w?: string;
  /** Tailwind classes that hide the column on narrow screens. */
  hide?: string;
  cell: (r: Ranked<Component>) => string;
  /** The full value for a cell that a fixed width has to truncate, shown on
   *  hover. Omitted where the cell text is already complete. */
  title?: (r: Ranked<Component>) => string;
  /** A cell that is not text. Only the saved-part delete control needs one;
   *  it takes precedence over `cell`, which stays required so every column
   *  still has a text form. */
  render?: (r: Ranked<Component>) => ReactNode;
  /** The heading names the column for a screen reader but is not drawn: a
   *  control column has no room for a word and needs no title above it. */
  headSrOnly?: boolean;
}

/**
 * The columns for a type, in order. Per type rather than one union, because the
 * fields that identify a part differ: a centering ring is its OD/ID pair, a
 * parachute has a canopy diameter and a Cd and no length at all. One union would
 * mean a blank column for every field a type lacks.
 *
 * Dimension headings come from the `prop.*` namespace the property panel already
 * uses, so a part's bore is called the same thing in the picker as in the editor
 * it fills. The unit is named once, in the heading, rather than after every cell.
 */
function columnsFor(type: ComponentType, u: Units, t: (k: string) => string, ranked: boolean): Col[] {
  const len = (v: number | null | undefined) => (v == null ? '—' : u.fmt('length', v));
  const withUnit = (label: string) => `${label} (${u.sym('length')})`;
  const od = (r: Ranked<Component>) => outerDiameterOf(r.part);
  const inner = (r: Ranked<Component>) => ('innerDiameter' in r.part ? r.part.innerDiameter : null);
  const length = (r: Ranked<Component>) => lengthOf(r.part);

  const fitCol: Col[] = ranked
    ? [
        {
          key: 'fit',
          head: withUnit(t('picker.colFit')),
          sort: 'fit',
          num: true,
          w: 'w-20',
          // The number is the gap, so 0 is a perfect fit and blank means this
          // part is not in the running at all.
          cell: (r) => (r.fit == null ? '' : u.fmt('length', r.fit)),
        },
      ]
    : [];

  const ident: Col[] = [
    {
      key: 'mfr',
      head: t('picker.colMfr'),
      sort: 'mfr',
      w: 'w-36',
      // The star marks the user's own saved parts, the way it marks an
      // imported motor in the motor picker and a custom material in the
      // material picker. Part of the maker cell rather than a column of its
      // own: what it says is who made this, not one more dimension.
      cell: (r) => (r.part.custom ? `★ ${r.part.mfr}` : r.part.mfr),
      title: (r) => (r.part.custom ? t('picker.savedTitle') : r.part.mfr),
    },
    {
      key: 'partNo',
      head: t('picker.colPartNo'),
      sort: 'partNo',
      w: 'w-32',
      cell: (r) => r.part.partNo,
      title: (r) => r.part.partNo,
    },
  ];
  // The raw catalog name, not the family the facet groups by: `Fiberglass, G12,
  // filament wound tube` and `Fiberglass, G10` are both "Fiberglass" to the
  // filter and are not the same material to build with. Truncated to keep the
  // column still, with the whole name on hover.
  const material: Col = {
    key: 'material',
    head: t('material.title'),
    w: 'w-36',
    hide: 'hidden lg:table-cell',
    cell: (r) => ('material' in r.part ? (r.part.material ?? '—') : '—'),
    title: (r) => ('material' in r.part ? (r.part.material ?? '') : ''),
  };
  // The one column with no width: it absorbs whatever the fixed ones leave.
  const notes: Col = {
    key: 'notes',
    head: t('picker.colNotes'),
    hide: 'hidden md:table-cell',
    cell: (r) => describeNotes(r.part),
    title: (r) => r.part.desc,
  };
  const odCol: Col = {
    key: 'od',
    head: withUnit(t('picker.colOd')),
    sort: 'od',
    num: true,
    w: 'w-24',
    cell: (r) => len(od(r)),
  };
  const idCol: Col = {
    key: 'id',
    head: withUnit(t('picker.colId')),
    sort: 'id',
    num: true,
    w: 'w-24',
    cell: (r) => len(inner(r)),
  };
  const lenCol: Col = {
    key: 'length',
    head: withUnit(t('picker.colLen')),
    sort: 'length',
    num: true,
    w: 'w-28',
    cell: (r) => len(length(r)),
  };
  // A ring's and a bulkhead's `length` is its thickness; calling it "length"
  // beside a 54 mm diameter reads as a 6 mm-long tube.
  const thickCol: Col = { ...lenCol, head: withUnit(t('prop.thickness')) };

  // Shape, translated: the catalog stores the kernel's lowercase enum, and
  // rendered raw the column reads `ogive` / `haack` in every language,
  // beside translated headings.
  const shapeCol: Col = {
    key: 'shape',
    head: t('prop.shape'),
    sort: 'shape',
    w: 'w-28',
    cell: (r) => ('shape' in r.part ? t(`noseShape.${r.part.shape}`) : '—'),
  };

  switch (type) {
    case 'bodytube':
    case 'tubecoupler':
    case 'engineblock':
    case 'launchlug':
      return [...fitCol, ...ident, odCol, idCol, lenCol, material, notes];
    case 'transition':
      return [
        ...ident,
        shapeCol,
        {
          key: 'fore',
          head: withUnit(t('prop.foreDiameter')),
          sort: 'fore',
          num: true,
          w: 'w-28',
          cell: (r) => len(r.part.type === 'transition' ? r.part.foreOuterDiameter : null),
        },
        // Sorted as the OD: the aft end is the one that meets the tube below.
        { ...odCol, head: withUnit(t('prop.aftDiameter')), w: 'w-28' },
        lenCol,
        material,
        notes,
      ];
    case 'streamer':
      return [
        ...ident,
        lenCol,
        {
          key: 'width',
          head: withUnit(t('prop.width')),
          sort: 'width',
          num: true,
          w: 'w-24',
          cell: (r) => len(r.part.type === 'streamer' ? r.part.stripWidth : null),
        },
        material,
        notes,
      ];
    case 'centeringring':
      return [...fitCol, ...ident, odCol, idCol, thickCol, material, notes];
    // A rail button's length is its height off the airframe.
    case 'railbutton':
      return [...ident, odCol, idCol, { ...lenCol, head: withUnit(t('prop.height')) }, material, notes];
    case 'bulkhead':
      return [...fitCol, ...ident, odCol, thickCol, material, notes];
    case 'nosecone':
      return [...fitCol, ...ident, shapeCol, odCol, lenCol, material, notes];
    case 'parachute':
      return [
        ...ident,
        { ...odCol, head: withUnit(t('prop.diameter')), w: 'w-32' },
        {
          key: 'cd',
          head: t('prop.dragCoeff'),
          sort: 'cd',
          num: true,
          w: 'w-24',
          // A row that omits its drag coefficient shows the app's own default,
          // because that is what picking the part applies, marked as a default
          // so it does not read as manufacturer data. A stated one is shown as is.
          cell: (r) =>
            r.part.type === 'parachute'
              ? r.part.cd == null
                ? `(${fmtNum(DEFAULT_CHUTE_CD, 2)})`
                : fmtNum(r.part.cd, 2)
              : '—',
          title: (r) => (r.part.type === 'parachute' && r.part.cd == null ? t('picker.cdDefault') : ''),
        },
        notes,
      ];
  }
}

function PickerDialog({
  type,
  all,
  fit,
  current,
  onApply,
  onClose,
}: {
  type: PickerType;
  all: Component[];
  fit?: FitContext;
  current?: string;
  onApply: (p: Component) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const u = useUnits();
  // Whether this type and this context can judge fit at all. When they cannot,
  // there is no Fit column and no toggle, rather than a control that filters
  // everything away for reasons the user cannot see.
  const canFit = fitRuleFor(type, fit) != null;
  // Fit ranks by default; it does not hide. Defaulting the filter on would be
  // wrong: no nose cone in the catalog is within 0.6 mm of a 54.66 mm airframe,
  // because manufacturers' nominal sizes cluster in families that do not line
  // up, so a picker that hid everything else would open empty on a perfectly
  // ordinary design. Sorting by fit puts the five couplers that suit a
  // 51.5 mm bore at the top of 237 and still lets an unusual build scroll past
  // them. The toggle is there for anyone who does want the hard filter.
  const [q, setQ] = useState<ComponentQuery>({ ...emptyQuery, sort: canFit ? 'fit' : 'mfr' });
  const set = (patch: Partial<ComponentQuery>) => setQ((prev) => ({ ...prev, ...patch }));

  // Two names on purpose: the fit rule is the node's business, the columns are
  // the catalog's. They differ for an inner tube, which reads body tube rows.
  const catType = catalogTypeFor(type);
  const mfrs = useMemo(() => manufacturers(all), [all]);
  // Facets built from what is actually in this type's rows, so the dropdown never
  // offers a value that would return nothing: body tubes have six material
  // families, bulkheads five, and they are not the same five.
  const mats = useMemo(() => materialFamilies(all), [all]);
  const shapes = useMemo(() => noseShapes(all), [all]);
  const ranked = useMemo(() => queryComponents(all, q, type, fit), [all, q, type, fit]);
  const shown = ranked.slice(0, ROW_CAP);
  const baseCols = useMemo(() => columnsFor(catType, u, t, canFit), [catType, u, t, canFit]);
  // A refused delete is not always "storage full" (see the store), so the
  // store's own message is shown rather than a guess, and the part stays in
  // the list until the write actually succeeds.
  const [delErr, setDelErr] = useState<string | null>(null);
  const remove = async (p: Component) => {
    if (!p.id) return;
    // Asked here as well as in the manage dialog: a saved part can be the only
    // copy of geometry somebody worked out, if the design it came from has
    // since been deleted, and this ✕ sits one row away from the part they
    // meant to apply.
    const ok = await confirm({
      message: t('picker.deleteSavedConfirm', { name: p.partNo }),
      confirmLabel: t('common.delete'),
      danger: true,
    });
    if (!ok) return;
    setDelErr(null);
    try {
      // The list refreshes through the version counter the outer component
      // subscribes to, so there is nothing to re-fetch here.
      await deleteCustomPart(p.id);
    } catch (e) {
      setDelErr(errorMessage(e));
    }
  };
  // The delete column exists only when there is something to delete, so an
  // untouched catalog keeps every pixel of its width for the part.
  const hasSaved = useMemo(() => all.some((p) => p.custom), [all]);
  const cols: Col[] = hasSaved
    ? [
        ...baseCols,
        {
          key: 'del',
          head: t('common.delete'),
          headSrOnly: true,
          w: 'w-10',
          cell: () => '',
          render: (r) =>
            r.part.custom ? (
              <button
                onClick={(e) => {
                  e.stopPropagation(); // a click on the row applies the part
                  void remove(r.part);
                }}
                aria-label={t('picker.deleteSaved', { name: r.part.partNo })}
                className="text-danger-400 hover:text-danger-300"
              >
                ✕
              </button>
            ) : null,
        },
      ]
    : baseCols;

  /** Clicking a heading sorts by it; clicking the active one flips direction. */
  const sortBy = (key: SortKey) => set(key === q.sort ? { dir: q.dir === 1 ? -1 : 1 } : { sort: key, dir: 1 });

  return (
    <Dialog
      id="componentPicker"
      title={t('picker.dialogTitle')}
      onClose={onClose}
      size="4xl"
      toolbar={
        // Filters on two rows: free text above, facets below. On one row, a
        // search box, three dropdowns, two number fields, a checkbox and a
        // button wrap unpredictably and read as a wall of controls.
        // Sorting is not here at all; it lives on the column headings. The rule
        // under it comes from the shell's toolbar band.
        <div className="flex flex-col gap-2 p-3">
          <input
            value={q.text}
            onChange={(e) => set({ text: e.target.value })}
            autoFocus
            placeholder={t('picker.search')}
            aria-label={t('picker.search')}
            className="w-full rounded-lg bg-canvas px-3 py-2 text-sm text-ink-strong ring-1 ring-line/10 placeholder:text-ink-faint focus:outline-none focus:ring-accent-500"
          />
          {/* The narrowing controls, with Clear pushed to the far right by
              `ml-auto` so it reads as the way out rather than as one more filter. */}
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={q.mfr}
              onChange={(e) => set({ mfr: e.target.value })}
              aria-label={t('picker.colMfr')}
              className="rounded-lg bg-raised px-2 py-2 text-xs text-ink ring-1 ring-line/10 focus:outline-none focus:ring-accent-500"
            >
              <option value="">{t('picker.allMfrs')}</option>
              {mfrs.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            {mats.length > 1 && (
              <select
                value={q.material}
                onChange={(e) => set({ material: e.target.value })}
                aria-label={t('material.title')}
                className="rounded-lg bg-raised px-2 py-2 text-xs text-ink ring-1 ring-line/10 focus:outline-none focus:ring-accent-500"
              >
                <option value="">{t('picker.allMaterials')}</option>
                {mats.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            )}
            {shapes.length > 1 && (
              <select
                value={q.shape}
                onChange={(e) => set({ shape: e.target.value })}
                aria-label={t('prop.shape')}
                className="rounded-lg bg-raised px-2 py-2 text-xs text-ink ring-1 ring-line/10 focus:outline-none focus:ring-accent-500"
              >
                <option value="">{t('picker.allShapes')}</option>
                {shapes.map((sh) => (
                  <option key={sh} value={sh}>
                    {t(`noseShape.${sh}`)}
                  </option>
                ))}
              </select>
            )}
            <span className="flex items-center gap-1 text-xs text-ink-muted">
              <span className="text-ink-faint">⌀</span>
              <UnitBound
                quantity="length"
                value={q.odMin}
                onChange={(si) => set({ odMin: si })}
                placeholder={t('picker.odFrom')}
                ariaLabel={t('picker.odFrom')}
                className="w-16 rounded-md bg-canvas px-2 py-1.5 text-right tabular-nums text-ink-strong ring-1 ring-line/10 focus:outline-none focus:ring-accent-500"
              />
              <span aria-hidden="true">–</span>
              <UnitBound
                quantity="length"
                value={q.odMax}
                onChange={(si) => set({ odMax: si })}
                placeholder={t('picker.odTo')}
                ariaLabel={t('picker.odTo')}
                className="w-16 rounded-md bg-canvas px-2 py-1.5 text-right tabular-nums text-ink-strong ring-1 ring-line/10 focus:outline-none focus:ring-accent-500"
              />
              <span className="text-ink-faint">{u.sym('length')}</span>
            </span>
            {canFit && (
              <label className="flex items-center gap-1.5 text-xs text-ink-soft" title={t('picker.fitsHint')}>
                <input
                  type="checkbox"
                  checked={q.fitsOnly}
                  onChange={(e) => set({ fitsOnly: e.target.checked })}
                  className="accent-accent-500"
                />
                {t('picker.fitsOnly')}
              </label>
            )}
            {!queryIsEmpty(q) && (
              <button
                onClick={() =>
                  set({ text: '', mfr: '', material: '', shape: '', odMin: null, odMax: null, fitsOnly: false })
                }
                className="ml-auto rounded-md bg-raised px-2 py-1.5 text-xs text-ink-soft hover:bg-elevated"
              >
                {t('picker.clear')}
              </button>
            )}
          </div>
        </div>
      }
      footer={
        <div className="p-2 text-center text-[11px] uppercase tracking-wide text-ink-faint">
          {ranked.length > shown.length
            ? t('picker.showing', { shown: shown.length, total: ranked.length })
            : t('picker.results', { count: ranked.length })}
          {/* A delete that the storage layer refused. It belongs here rather
              than beside the row, which is gone from view the moment the list
              is scrolled or filtered. */}
          {delErr && <div className="mt-1 normal-case tracking-normal text-danger-400">{delErr}</div>}
        </div>
      }
    >
      {/* `table-fixed`: see Col.w. Auto layout would re-measure the columns from
          whichever rows are rendered, so they would jump on every keystroke. */}
      <table className="w-full table-fixed border-collapse text-sm">
        <thead className="sticky top-0 z-10 bg-surface text-[11px] uppercase tracking-wide text-ink-muted">
          <tr>
            {cols.map((c) => (
              <SortHeader
                key={c.key}
                className={`border-b border-line/10 px-2 py-2 font-medium ${c.num ? 'text-right' : 'text-left'} ${c.w ?? ''} ${c.hide ?? ''}`}
                active={c.sort === q.sort}
                dir={q.dir === 1 ? 1 : -1}
                onSort={c.sort ? () => sortBy(c.sort!) : undefined}
              >
                {c.headSrOnly && !c.sort ? <span className="sr-only">{c.head}</span> : c.head}
              </SortHeader>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((r, i) => (
            <tr
              // A saved part has a real id; a catalog row is identified by the
              // pair it publishes, with the index to separate the duplicates
              // the catalog does contain.
              key={r.part.id ?? `${r.part.mfr}:${r.part.partNo}:${i}`}
              // The row is what a pointer aims at; the part-number button is
              // what a keyboard reaches and a screen reader announces. A row
              // that is itself a button would flatten its cells and swallow
              // the delete button inside it.
              onClick={() => onApply(r.part)}
              // The one this component is already built from, marked rather than
              // merely present: opening a list of hundreds of parts to find out which one
              // you are on is not an answer.
              aria-current={r.part.partNo === current ? 'true' : undefined}
              className={`cursor-pointer border-b border-line/5 hover:bg-raised focus-within:bg-raised ${
                r.part.partNo === current ? 'bg-raised font-semibold text-accent-300' : 'text-ink-soft'
              }`}
            >
              {cols.map((c) => (
                <td
                  key={c.key}
                  // Truncated rather than wrapped: a row that grows taller
                  // when a long material name lands in it is the same
                  // jumping-layout problem one axis over.
                  title={c.title?.(r) || undefined}
                  className={`truncate px-2 py-1.5 ${c.num ? 'text-right tabular-nums' : ''} ${
                    c.key === 'partNo' ? 'font-medium text-ink-strong' : ''
                  } ${c.key === 'notes' || c.key === 'material' ? 'text-ink-faint' : ''} ${c.hide ?? ''}`}
                >
                  {c.key === 'partNo' ? (
                    <button
                      onClick={(e) => {
                        e.stopPropagation(); // the row's own click would apply it twice
                        onApply(r.part);
                      }}
                      aria-current={r.part.partNo === current ? 'true' : undefined}
                      className="max-w-full truncate text-left focus:outline-none focus-visible:underline"
                    >
                      {c.cell(r)}
                    </button>
                  ) : c.render ? (
                    c.render(r)
                  ) : (
                    c.cell(r)
                  )}
                </td>
              ))}
            </tr>
          ))}
          {shown.length === 0 && (
            <tr>
              <td colSpan={cols.length} className="px-3 py-8 text-center text-sm text-ink-faint">
                {t('picker.noResults')}
                {/* With the fit filter on, it is the likeliest reason for an
                        empty list. Name it. */}
                {q.fitsOnly && <div className="mt-1 text-xs text-ink-dim">{t('picker.fitsHint')}</div>}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </Dialog>
  );
}
