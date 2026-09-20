import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { componentsForType, filterComponents, type ComponentType, type Component } from '../../services/componentDb';
import { fmtNum } from '../../i18n/format';
import { useUnits } from '../../prefs/useUnits';
import { useCatalogProgress } from '../common/CatalogLoading';
import { useFocusTrap } from '../common/useFocusTrap';

/**
 * The catalog fetch as ONE state rather than three booleans, so `error &&
 * loading` cannot coexist and every branch below is one of exactly three.
 */
type CatalogState =
  { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; all: Component[] };
/** A fetch that finished, filed under the type and attempt it answers. */
type CatalogLanded = { type: ComponentType; attempt: number; result: Exclude<CatalogState, { status: 'loading' }> };

/**
 * Picks a real cataloged part (from the bundled OpenRocket component DB) of a
 * given type and applies it via `onApply`. Opens a modal dialog with a live
 * search over manufacturer / part number / description; the caller maps the
 * chosen Component onto its target node (see catalogPatch).
 */
export function ComponentPicker({ type, onApply }: { type: ComponentType; onApply: (p: Component) => void }) {
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
    componentsForType(type)
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

      {/* Mounted only while open: the search text resets by unmount instead
          of by an effect on `open`. */}
      {open && state.status === 'ready' && (
        <PickerDialog
          all={state.all}
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

function PickerDialog({
  all,
  onApply,
  onClose,
}: {
  all: Component[];
  onApply: (p: Component) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const u = useUnits();
  // The trap goes on the PANEL, not the backdrop: anchored on the overlay it
  // treated the whole viewport as the dialog, and role/aria-modal sat on an
  // element with no accessible name.
  const panelRef = useFocusTrap<HTMLDivElement>(true, { onEscape: onClose });
  const [q, setQ] = useState('');
  const matches = useMemo(() => filterComponents(all, q).slice(0, 300), [all, q]);

  const dims = (p: Component): string => {
    // The catalog is SI; `sym` is appended once at the end so a two-dimension
    // line reads "24 x 70 mm" rather than repeating the unit.
    const L = (v: number) => u.fmt('length', v);
    const sym = u.sym('length');
    if (p.type === 'parachute') return `⌀ ${L(p.diameter)} ${sym} · Cd ${fmtNum(p.cd ?? 0.8, 2)}`;
    if (p.type === 'nosecone') return `${p.shape} · ⌀ ${L(p.outerDiameter)} × ${L(p.length)} ${sym}`;
    return `⌀ ${L(p.outerDiameter)} × ${L(p.length)} ${sym}`;
  };

  return (
    <div
      className="dialog-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="component-picker-title"
        className="dialog-panel flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-xl bg-slate-900 ring-1 ring-white/10"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 border-b border-white/10 p-3">
          <h2 id="component-picker-title" className="text-sm font-semibold text-slate-200">
            {t('picker.dialogTitle')}
          </h2>
          <button
            onClick={onClose}
            aria-label={t('picker.close')}
            className="rounded-md bg-slate-800 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700"
          >
            ✕
          </button>
        </div>

        <div className="p-3">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoFocus
            placeholder={t('picker.search')}
            className="w-full rounded-lg bg-slate-950 px-3 py-2 text-sm text-slate-100 ring-1 ring-white/10 placeholder:text-slate-500 focus:outline-none focus:ring-sky-500"
          />
        </div>

        <ul className="min-h-0 flex-1 divide-y divide-white/5 overflow-y-auto">
          {matches.map((p, i) => (
            <li key={`${p.mfr}:${p.partNo}:${i}`}>
              <button
                onClick={() => onApply(p)}
                className="flex w-full flex-col gap-0.5 px-3 py-2 text-left hover:bg-slate-800"
              >
                <span className="flex items-center justify-between gap-2 text-sm">
                  <span className="min-w-0 truncate">
                    <span className="text-slate-500">{p.mfr}</span>{' '}
                    <span className="font-medium text-slate-100">{p.partNo}</span>
                  </span>
                  <span className="shrink-0 tabular-nums text-xs text-slate-400">{dims(p)}</span>
                </span>
                {p.desc && <span className="truncate text-xs text-slate-500">{p.desc}</span>}
              </button>
            </li>
          ))}
          {matches.length === 0 && (
            <li className="px-3 py-8 text-center text-sm text-slate-500">{t('picker.noResults')}</li>
          )}
        </ul>

        <div className="border-t border-white/10 p-2 text-center text-[11px] uppercase tracking-wide text-slate-500">
          {t('picker.results', { count: matches.length })}
        </div>
      </div>
    </div>
  );
}
