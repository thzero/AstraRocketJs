import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  catalogTypeFor,
  componentsForType,
  type Component,
  type ComponentType,
  type PickerType,
} from '../../services/componentDb';
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
} from '../../services/componentFilter';
import { fmtNum } from '../../i18n/format';
import { useUnits, type Units } from '../../prefs/useUnits';
import { useCatalogProgress } from '../common/CatalogLoading';
import { Dialog } from '../common/Dialog';

/**
 * How many rows are rendered at once. There are 1088 body tubes and no
 * virtualization in the tree, so the list is capped — but the footer reports the
 * MATCH count and says how many it is holding back. The old picker sliced to 300
 * and then printed that number as the total, so the catalog read as small.
 */
const ROW_CAP = 200;

/**
 * The catalog fetch as ONE state rather than three booleans, so `error &&
 * loading` cannot coexist and every branch below is one of exactly three.
 */
type CatalogState =
  { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; all: Component[] };
/** A fetch that finished, filed under the type and attempt it answers. */
type CatalogLanded = { type: PickerType; attempt: number; result: Exclude<CatalogState, { status: 'loading' }> };

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
  onApply,
}: {
  /** The NODE's type, not the catalog's: an inner tube is served by the body tube
   *  rows (see componentDb.catalogTypeFor) but has its own fit rule. */
  type: PickerType;
  /** Geometry around the node being filled, so the parts that actually fit can
   *  be ranked first. Absent is fine: the fit control then says so. */
  fit?: FitContext;
  onApply: (p: Component) => void;
}) {
  const { t } = useTranslation();
  // The catalog is fetched at runtime (see componentDb / remoteData), so load it
  // on mount and hold the result. Same trigger as before (this picker is itself
  // lazy-loaded); it's just async now.
  // Bumped by the retry button to re-run the load effect.
  const [attempt, setAttempt] = useState(0);
  // The outcome of the latest fetch that LANDED. `loading` is derived from it
  // (the landed fetch is not for this type and attempt) rather than set at the
  // top of the effect: that was a synchronous setState in an effect, which is
  // a cascading render the compiler lint rejects.
  const [landed, setLanded] = useState<CatalogLanded | null>(null);
  const state: CatalogState =
    landed && landed.type === type && landed.attempt === attempt ? landed.result : { status: 'loading' };
  useEffect(() => {
    let ok = true;
    componentsForType(catalogTypeFor(type))
      .then((all) => ok && setLanded({ type, attempt, result: { status: 'ready', all } }))
      .catch((e: unknown) => {
        if (!ok) return;
        // Previously swallowed, leaving the button reading "Pick (0)" as though
        // the catalog were simply empty. Say what happened and offer a retry.
        setLanded({
          type,
          attempt,
          result: { status: 'error', message: e instanceof Error ? e.message : String(e) },
        });
      });
    return () => {
      ok = false;
    };
  }, [type, attempt]);
  // Live bytes for the ~1 MB component catalog, so a slow link is legible.
  const progress = useCatalogProgress('components');
  const pct = progress?.total ? Math.min(100, Math.round((progress.loaded / progress.total) * 100)) : null;
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => (state.status === 'error' ? setAttempt((n) => n + 1) : setOpen(true))}
        disabled={state.status === 'loading'}
        title={state.status === 'error' ? state.message : undefined}
        className={`w-full rounded-lg px-2 py-1.5 text-xs font-medium hover:bg-slate-700 disabled:text-slate-500 ${
          state.status === 'error' ? 'bg-slate-800 text-amber-300' : 'bg-slate-800 text-slate-200'
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
   * A FIXED width, as a Tailwind class. Required on every column but the one
   * that takes up the slack, because the table is `table-fixed`.
   *
   * It has to be: with the browser's default `table-layout: auto` the widths are
   * computed from whichever rows happen to be rendered, so every keystroke in the
   * search box relaid the whole table out and the columns visibly jumped around.
   * Fixed widths mean typing narrows the list without moving anything.
   */
  w?: string;
  /** Tailwind classes that hide the column on narrow screens. */
  hide?: string;
  cell: (r: Ranked<Component>) => string;
  /** The full value for a cell that a fixed width has to truncate, shown on
   *  hover. Omitted where the cell text is already complete. */
  title?: (r: Ranked<Component>) => string;
}

/**
 * The columns for a type, in order. Per type rather than one union, because the
 * fields that identify a part differ: a centering ring IS its OD/ID pair, a
 * parachute has a canopy diameter and a Cd and no length at all, and showing a
 * blank column for the ones a type lacks is how the old single-line layout ended
 * up hiding the bore in prose.
 *
 * Dimension headings come from the `prop.*` namespace the property panel already
 * uses, so a part's bore is called the same thing in the picker as in the editor
 * it fills. The unit is named ONCE, in the heading, rather than after every cell.
 */
function columnsFor(type: ComponentType, u: Units, t: (k: string) => string, ranked: boolean): Col[] {
  const len = (v: number | null | undefined) => (v == null ? '—' : u.fmt('length', v));
  const withUnit = (label: string) => `${label} (${u.sym('length')})`;
  const od = (r: Ranked<Component>) => (r.part.type === 'parachute' ? r.part.diameter : r.part.outerDiameter);
  const inner = (r: Ranked<Component>) => ('innerDiameter' in r.part ? r.part.innerDiameter : null);
  const length = (r: Ranked<Component>) => (r.part.type === 'parachute' ? null : r.part.length);

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
    { key: 'mfr', head: t('picker.colMfr'), sort: 'mfr', w: 'w-36', cell: (r) => r.part.mfr, title: (r) => r.part.mfr },
    {
      key: 'partNo',
      head: t('picker.colPartNo'),
      sort: 'partNo',
      w: 'w-32',
      cell: (r) => r.part.partNo,
      title: (r) => r.part.partNo,
    },
  ];
  // The RAW catalog name, not the family the facet groups by: `Fiberglass, G12,
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
  // A ring's and a bulkhead's `length` IS its thickness; calling it "length"
  // beside a 54 mm diameter reads as a 6 mm-long tube.
  const thickCol: Col = { ...lenCol, head: withUnit(t('prop.thickness')) };

  switch (type) {
    case 'bodytube':
    case 'tubecoupler':
      return [...fitCol, ...ident, odCol, idCol, lenCol, material, notes];
    case 'centeringring':
      return [...fitCol, ...ident, odCol, idCol, thickCol, material, notes];
    case 'bulkhead':
      return [...fitCol, ...ident, odCol, thickCol, material, notes];
    case 'nosecone':
      return [
        ...fitCol,
        ...ident,
        {
          key: 'shape',
          head: t('prop.shape'),
          sort: 'shape',
          w: 'w-28',
          // The catalog stores the kernel's lowercase enum; it used to be
          // rendered raw, so the column read `ogive` / `haack` in every
          // language beside translated headings.
          cell: (r) => (r.part.type === 'nosecone' ? t(`noseShape.${r.part.shape}`) : '—'),
        },
        odCol,
        lenCol,
        material,
        notes,
      ];
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
          // Every parachute the catalog ships omits its drag coefficient, so this
          // is almost always the app's own default rather than a published spec.
          // It is shown because it IS what picking the part applies, and marked
          // as a default so it does not read as manufacturer data.
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
  onApply,
  onClose,
}: {
  type: PickerType;
  all: Component[];
  fit?: FitContext;
  onApply: (p: Component) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const u = useUnits();
  // Whether this type and this context can judge fit at all. When they cannot,
  // there is no Fit column and no toggle, rather than a control that filters
  // everything away for reasons the user cannot see.
  const canFit = fitRuleFor(type, fit) != null;
  // Fit RANKS by default; it does not hide. Defaulting the filter on looked
  // tempting and is wrong: no nose cone in the catalog is within 0.6 mm of a
  // 54.66 mm airframe, because manufacturers' nominal sizes cluster in families
  // that do not line up, so a picker that hid everything else opened empty on a
  // perfectly ordinary design. Sorting by fit puts the five couplers that suit a
  // 51.5 mm bore at the top of 237 and still lets an unusual build scroll past
  // them. The toggle is there for anyone who does want the hard filter.
  const [q, setQ] = useState<ComponentQuery>({ ...emptyQuery, sort: canFit ? 'fit' : 'mfr' });
  const set = (patch: Partial<ComponentQuery>) => setQ((prev) => ({ ...prev, ...patch }));

  // Two names on purpose: the fit rule is the NODE's business, the columns are
  // the catalog's. They differ for an inner tube, which reads body tube rows.
  const catType = catalogTypeFor(type);
  const mfrs = useMemo(() => manufacturers(all), [all]);
  // Facets built from what is actually in THIS type's rows, so the dropdown never
  // offers a value that would return nothing: body tubes have six material
  // families, bulkheads five, and they are not the same five.
  const mats = useMemo(() => materialFamilies(all), [all]);
  const shapes = useMemo(() => noseShapes(all), [all]);
  const ranked = useMemo(() => queryComponents(all, q, type, fit), [all, q, type, fit]);
  const shown = ranked.slice(0, ROW_CAP);
  const cols = useMemo(() => columnsFor(catType, u, t, canFit), [catType, u, t, canFit]);

  /** Clicking a heading sorts by it; clicking the active one flips direction. */
  const sortBy = (key: SortKey) => set(key === q.sort ? { dir: q.dir === 1 ? -1 : 1 } : { sort: key, dir: 1 });
  /** Length typed in the user's own unit, held as meters. */
  const odBound = (text: string): number | null => {
    const n = Number(text);
    return text.trim() === '' || !Number.isFinite(n) ? null : u.fromUi('length', n);
  };
  const boundText = (si: number | null) => (si == null ? '' : String(Number(u.toUi('length', si).toFixed(3))));

  return (
    <Dialog
      id="componentPicker"
      title={t('picker.dialogTitle')}
      onClose={onClose}
      size="4xl"
      toolbar={
        // Filters on TWO rows: free text above, facets below. One row ran to a
        // search box, three dropdowns, two number fields, a checkbox and a
        // button, which wrapped unpredictably and read as a wall of controls.
        // Sorting is not here at all; it lives on the column headings. The rule
        // under it comes from the shell's toolbar band.
        <div className="flex flex-col gap-2 p-3">
          <input
            value={q.text}
            onChange={(e) => set({ text: e.target.value })}
            autoFocus
            placeholder={t('picker.search')}
            aria-label={t('picker.search')}
            className="w-full rounded-lg bg-slate-950 px-3 py-2 text-sm text-slate-100 ring-1 ring-white/10 placeholder:text-slate-500 focus:outline-none focus:ring-sky-500"
          />
          {/* The narrowing controls, with Clear pushed to the far right by
              `ml-auto` so it reads as the way out rather than as one more filter. */}
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={q.mfr}
              onChange={(e) => set({ mfr: e.target.value })}
              aria-label={t('picker.colMfr')}
              className="rounded-lg bg-slate-800 px-2 py-2 text-xs text-slate-200 ring-1 ring-white/10 focus:outline-none focus:ring-sky-500"
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
                className="rounded-lg bg-slate-800 px-2 py-2 text-xs text-slate-200 ring-1 ring-white/10 focus:outline-none focus:ring-sky-500"
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
                className="rounded-lg bg-slate-800 px-2 py-2 text-xs text-slate-200 ring-1 ring-white/10 focus:outline-none focus:ring-sky-500"
              >
                <option value="">{t('picker.allShapes')}</option>
                {shapes.map((sh) => (
                  <option key={sh} value={sh}>
                    {t(`noseShape.${sh}`)}
                  </option>
                ))}
              </select>
            )}
            <span className="flex items-center gap-1 text-xs text-slate-400">
              <span className="text-slate-500">⌀</span>
              <input
                type="number"
                inputMode="decimal"
                value={boundText(q.odMin)}
                onChange={(e) => set({ odMin: odBound(e.target.value) })}
                placeholder={t('picker.odFrom')}
                aria-label={t('picker.odFrom')}
                className="w-16 rounded-md bg-slate-950 px-2 py-1.5 text-right tabular-nums text-slate-100 ring-1 ring-white/10 focus:outline-none focus:ring-sky-500"
              />
              <span aria-hidden="true">–</span>
              <input
                type="number"
                inputMode="decimal"
                value={boundText(q.odMax)}
                onChange={(e) => set({ odMax: odBound(e.target.value) })}
                placeholder={t('picker.odTo')}
                aria-label={t('picker.odTo')}
                className="w-16 rounded-md bg-slate-950 px-2 py-1.5 text-right tabular-nums text-slate-100 ring-1 ring-white/10 focus:outline-none focus:ring-sky-500"
              />
              <span className="text-slate-500">{u.sym('length')}</span>
            </span>
            {canFit && (
              <label className="flex items-center gap-1.5 text-xs text-slate-300" title={t('picker.fitsHint')}>
                <input
                  type="checkbox"
                  checked={q.fitsOnly}
                  onChange={(e) => set({ fitsOnly: e.target.checked })}
                  className="accent-sky-500"
                />
                {t('picker.fitsOnly')}
              </label>
            )}
            {!queryIsEmpty(q) && (
              <button
                onClick={() =>
                  set({ text: '', mfr: '', material: '', shape: '', odMin: null, odMax: null, fitsOnly: false })
                }
                className="ml-auto rounded-md bg-slate-800 px-2 py-1.5 text-xs text-slate-300 hover:bg-slate-700"
              >
                {t('picker.clear')}
              </button>
            )}
          </div>
        </div>
      }
      footer={
        <div className="p-2 text-center text-[11px] uppercase tracking-wide text-slate-500">
          {ranked.length > shown.length
            ? t('picker.showing', { shown: shown.length, total: ranked.length })
            : t('picker.results', { count: ranked.length })}
        </div>
      }
    >
      {/* `table-fixed`: see Col.w. Auto layout re-measured the columns from
          whichever rows were rendered, so they jumped on every keystroke. */}
      <table className="w-full table-fixed border-collapse text-sm">
        <thead className="sticky top-0 z-10 bg-slate-900 text-[11px] uppercase tracking-wide text-slate-400">
          <tr>
            {cols.map((c) => (
              <th
                key={c.key}
                scope="col"
                aria-sort={c.sort !== q.sort ? 'none' : q.dir === 1 ? 'ascending' : 'descending'}
                className={`border-b border-white/10 px-2 py-2 font-medium ${c.num ? 'text-right' : 'text-left'} ${c.w ?? ''} ${c.hide ?? ''}`}
              >
                {c.sort ? (
                  <button
                    onClick={() => sortBy(c.sort!)}
                    className={`hover:text-slate-200 ${c.sort === q.sort ? 'text-sky-400' : ''}`}
                  >
                    {c.head}
                    {c.sort === q.sort && <span aria-hidden="true">{q.dir === 1 ? ' ▲' : ' ▼'}</span>}
                  </button>
                ) : (
                  c.head
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((r, i) => (
            <tr
              key={`${r.part.mfr}:${r.part.partNo}:${i}`}
              onClick={() => onApply(r.part)}
              tabIndex={0}
              role="button"
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onApply(r.part);
                }
              }}
              className="cursor-pointer border-b border-white/5 text-slate-300 hover:bg-slate-800 focus:bg-slate-800 focus:outline-none"
            >
              {cols.map((c) => (
                <td
                  key={c.key}
                  // Truncated rather than wrapped: a row that grows taller
                  // when a long material name lands in it is the same
                  // jumping-layout problem one axis over.
                  title={c.title?.(r) || undefined}
                  className={`truncate px-2 py-1.5 ${c.num ? 'text-right tabular-nums' : ''} ${
                    c.key === 'partNo' ? 'font-medium text-slate-100' : ''
                  } ${c.key === 'notes' || c.key === 'material' ? 'text-slate-500' : ''} ${c.hide ?? ''}`}
                >
                  {c.cell(r)}
                </td>
              ))}
            </tr>
          ))}
          {shown.length === 0 && (
            <tr>
              <td colSpan={cols.length} className="px-3 py-8 text-center text-sm text-slate-500">
                {t('picker.noResults')}
                {/* The likeliest reason for an empty list is the fit filter,
                        which is ON by default when it can judge. Name it. */}
                {q.fitsOnly && <div className="mt-1 text-xs text-slate-600">{t('picker.fitsHint')}</div>}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </Dialog>
  );
}
