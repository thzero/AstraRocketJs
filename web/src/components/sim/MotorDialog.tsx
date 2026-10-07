import { useLatest } from '../common/useLatest';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NumberInput } from '../common/NumberInput';
import { hasCurve, importCustomMotors, deleteCustomMotor, type CatalogMotor } from '../../services/motors/motorDb';
import { fetchMotorSpec } from '../../services/motors/thrustcurve';
import { MAX_IDX, parseDelays, type MountFit } from '../../services/motors/motorPicker';
import { PLUGGED_DELAY, type MotorSpec } from '../../engine/openRocketEngine';
import { useUnits } from '../../prefs/useUnits';
import { Dialog } from '../common/Dialog';
import { CatalogLoading, CatalogError } from '../common/CatalogLoading';
import { MotorDetail } from './MotorDetail';
import { keyOf } from './motorKey';
import { useCatalog } from './useCatalog';
import {
  ClassChips,
  DiameterRange,
  FitsMount,
  ImpulseRange,
  ManufacturerMenu,
  PluggedFilter,
  useMotorFilter,
} from './MotorFilterBar';
import { readFileText } from '../../services/files/decodeText';
import { loadDia, loadMfrs, saveDia, saveMfrs } from './motorPrefs';
import { errorMessage } from '../../services/app/errorMessage';
import { useFilePick } from '../common/useFilePick';
import { ToggleButton } from '../common/ToggleButton';

/** The delay a motor with no delay data starts at (a common mid-range charge). */
const DEFAULT_DELAY = 3;

/**
 * The catalog row a seated motor came from, for pre-selecting it.
 *
 * A MotorSpec carries no `code`, so a spec built from the bundled catalog says
 * "AeroTech F67" for both the F67W and the F67C, which are one common name
 * in one bore. Match on the common name OR the full code (a spec resolved from
 * thrustcurve.org carries the full designation), then narrow same-name pairs
 * by bore and by the curve source the spec was built from. Two motors sharing
 * all of manufacturer, name, bore and curve label remain indistinguishable
 * from the spec alone, and the first catalog match wins.
 */
function findSeated(catalog: CatalogMotor[], cur: MotorSpec): CatalogMotor | undefined {
  const named = catalog.filter(
    (m) => m.manufacturer === cur.manufacturer && (m.designation === cur.designation || m.code === cur.designation),
  );
  if (named.length <= 1) return named[0];
  const mm = Math.round(cur.diameter * 1000);
  const byBore = named.filter((m) => m.diameter === mm);
  const pool = byBore.length ? byBore : named;
  return (cur.curveSrc && pool.find((m) => m.curves?.some((c) => c.src === cur.curveSrc))) || pool[0];
}

/**
 * Modal motor picker. Filters the catalog by engine code (text), manufacturer(s),
 * impulse class, total impulse, diameter, whether the motor comes plugged, and
 * (by default) whether it fits the mount; imports a custom .eng; resolves the
 * chosen motor's thrust curve via `onSelect`.
 *
 * Mounted only while open (`{open && <MotorDialog />}`), so every piece of
 * state here starts fresh per opening and nothing has to be reset on close.
 * The previous "reseed on open" effects left the last motor's ejection delay
 * on the next pick after a reopen.
 */
export function MotorDialog({
  onClose,
  onSelect,
  onError,
  mount,
  current,
}: {
  onClose: () => void;
  onSelect: (m: MotorSpec) => void;
  onError: (msg: string | null) => void;
  /**
   * The mount being loaded: its bore and the length it has room for, in mm. What
   * the "fits the mount" filter measures against. Null when the geometry cannot
   * be read, and the filter is then not offered rather than guessing at it.
   */
  mount?: MountFit | null;
  /** The motor already seated on this mount, pre-selected when the dialog opens. */
  current?: MotorSpec | null;
}) {
  const { t } = useTranslation();
  const u = useUnits();
  const [delay, setDelay] = useState(DEFAULT_DELAY);
  // The highlighted (but not yet applied) motor. Applying happens via the
  // Select button, so a click just previews the choice. Identified by keyOf,
  // so the highlight survives a filter change that reorders the list.
  const [selected, setSelected] = useState<CatalogMotor | null>(null);
  // Which of the motor's thrust curves to use (some motors have several).
  const [curveIdx, setCurveIdx] = useState(0);
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  // The pick in flight. fetchMotorSpec can take seconds over the network, and a
  // result that lands after the user canceled (this dialog is unmounted on
  // close) must not be applied to the mount.
  const pickWrite = useLatest();

  // Opening from a card with a motor already on it pre-selects that motor,
  // highlighted in the list with its curve and delay restored, so "Change..."
  // resumes from the current choice instead of a blank detail pane. Done when
  // the catalog lands: the one moment the list exists and nothing has been
  // clicked yet, so no later click has to know about it.
  const { catalog, setCatalog, loading, error, retry } = useCatalog({
    onLoaded: (c) => {
      const m = current && findSeated(c, current);
      if (!m) return;
      setSelected(m);
      setDelay(current.ejectionDelay);
      const ci = m.curves?.findIndex((cv) => cv.src === current.curveSrc) ?? -1;
      setCurveIdx(ci >= 0 ? ci : 0);
    },
  });
  /**
   * The remembered diameter range is a plain PREFERENCE, never defaulted from the
   * mount: a top stop seeded from a 29 mm mount reads as the user's own setting
   * and then follows them to a 54 mm mount, hiding every motor that mount exists
   * to fly. Capping by the mount is the fit checkbox's job, which is per-mount,
   * visible, and can be turned off.
   */
  const [filterInit] = useState(() => ({
    mfrs: loadMfrs(),
    dia: loadDia() ?? ([0, MAX_IDX] as [number, number]),
    mount: mount && mount.bore > 0 ? mount : null,
  }));
  const {
    text,
    setText,
    cls,
    setCls,
    mfrs,
    setMfrs,
    dia,
    setDia,
    diaSaved,
    imp,
    setImp,
    plugged,
    setPlugged,
    fits,
    setFits,
    mount: fitMount,
    classes,
    manufacturers,
    matches,
  } = useMotorFilter(catalog, filterInit);

  // Persist the manufacturer selection and diameter range across sessions.
  useEffect(() => {
    saveMfrs(mfrs);
  }, [mfrs]);
  // `diaSaved`, not the displayed range: while the fit box is ticked the slider
  // is showing the MOUNT's ceiling, and saving that would write a machine's
  // choice into the user's preference, which is the bug this whole control
  // replaced.
  useEffect(() => {
    saveDia(diaSaved);
  }, [diaSaved]);

  // Clicking a DIFFERENT motor starts from its own defaults: the best (first)
  // curve, and a mid value of its own delay charges, or plugged for a
  // plugged-only motor. In the handler, not an effect keyed on the selection,
  // so the seeded values above are never stomped and never leak forward.
  const choose = (m: CatalogMotor) => {
    setSelected(m);
    setCurveIdx(0);
    const { delays, plugged } = parseDelays(m.delays);
    if (delays.length) setDelay(delays[Math.floor(delays.length / 2)]!);
    else if (plugged) setDelay(PLUGGED_DELAY);
    else setDelay(DEFAULT_DELAY);
  };

  const pick = async (m: CatalogMotor, curveIndex = 0) => {
    const mine = pickWrite.claim();
    setLoadingKey(keyOf(m));
    onError(null);
    try {
      const spec = await fetchMotorSpec(m, delay, curveIndex);
      // Canceled, or superseded by another pick, while the fetch was out.
      if (!mine()) return;
      onSelect(spec);
      onClose();
    } catch (e) {
      if (!mine()) return;
      onError(errorMessage(e));
    } finally {
      if (mine()) setLoadingKey(null);
    }
  };

  /** What the last import did, shown where the motor count is. */
  const [note, setNote] = useState<string | null>(null);
  // Which catalog write is current. Separate from `pickWrite`: an import and a
  // motor pick are different attempts and neither should cancel the other.
  const catalogWrite = useLatest();

  const onImport = async (file: File) => {
    onError(null);
    setNote(null);
    // A file read plus an IndexedDB write per motor, and a manufacturer range is
    // hundreds of them. Guarded the same way `pick` above is: a result landing on
    // a closed dialog, or behind a second import, is discarded.
    const mine = catalogWrite.claim();
    try {
      const { catalog, imported } = await importCustomMotors(await readFileText(file));
      if (!mine()) return;
      setCatalog(catalog);
      // Reported in the dialog rather than through onError, which is the
      // simulation panel behind it: a RockSim engine-database file can hold a
      // manufacturer whole range, and one motor landing looks exactly like
      // forty in a list of 800.
      setNote(t('motor.importedN', { count: imported }));
    } catch (err) {
      if (!mine()) return;
      onError(errorMessage(err));
    }
  };
  const motorFile = useFilePick({ accept: '.eng,.ENG,.rse,.RSE', onFile: (f) => void onImport(f) });

  const onDelete = async (m: CatalogMotor) => {
    if (!m.id) return;
    onError(null);
    const mine = catalogWrite.claim();
    try {
      const catalog = await deleteCustomMotor(m.id);
      if (!mine()) return;
      setCatalog(catalog);
    } catch (err) {
      if (!mine()) return;
      onError(errorMessage(err));
    }
  };

  // What the dialog acts on is the highlight the user can SEE. `selected` is
  // kept across filter changes so clearing a filter brings the highlight back,
  // but while the filter hides that row there is no visible highlight, and the
  // Select button must not apply a motor that is not on screen (the seated C6
  // while the list shows A8s). Derived, not cleared, so nothing has to be reset
  // when the filter changes back.
  const selectedKey = selected ? keyOf(selected) : null;
  const shown = selected && matches.some((m) => keyOf(m) === selectedKey) ? selected : null;

  return (
    <Dialog
      id="motorPicker"
      title={t('motorDlg.title')}
      onClose={onClose}
      size="4xl"
      // List beside detail, each scrolling itself and reaching the panel's
      // edges: the body takes the height and does its own padding.
      layout="fill"
      // Fixed rather than the viewport's height: the list is the working surface
      // and it should not become a screen-tall column on a large monitor.
      height={720}
    >
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {/* LEFT: filters + list + count */}
        <div
          className={`flex min-h-0 flex-col md:w-[360px] md:shrink-0 md:border-r md:border-line/10 ${shown ? 'hidden md:flex' : 'flex'}`}
        >
          <div className="space-y-2 p-3">
            <div className="flex gap-2">
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                autoFocus
                placeholder={t('motorDlg.searchCode')}
                className="min-w-0 flex-1 rounded-lg bg-canvas px-3 py-2 text-sm text-ink-strong ring-1 ring-line/10 placeholder:text-ink-faint focus:outline-none focus:ring-accent-500"
              />
              <button
                onClick={motorFile.pick}
                className="shrink-0 rounded-lg bg-raised px-3 py-2 text-xs font-medium text-ink hover:bg-elevated"
              >
                {t('motor.import')}
              </button>
              {motorFile.input}
            </div>

            <div className="flex gap-2">
              <ManufacturerMenu
                manufacturers={manufacturers}
                mfrs={mfrs}
                onChange={setMfrs}
                className="min-w-0 flex-1"
              />
            </div>

            <div className="flex flex-wrap gap-1">
              <ClassChips classes={classes} cls={cls} onChange={setCls} />
            </div>

            {/* Impulse sits with the class chips it refines and above the
                diameter, which is a property of the mount rather than of how
                much motor this is. */}
            <ImpulseRange imp={imp} onChange={setImp} />
            <DiameterRange dia={dia} onChange={setDia} />
            {/* Both boxes on one row: two short labels, and stacked they pushed
                the list itself another line down a 360px column. */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              {fitMount && <FitsMount mount={fitMount} fits={fits} onChange={setFits} />}
              <PluggedFilter plugged={plugged} onChange={setPlugged} />
            </div>
          </div>

          {error ? (
            <div className="grid min-h-0 flex-1 place-items-center p-6">
              <CatalogError message={`${t('catalog.failedMotors')} ${error}`} onRetry={retry} />
            </div>
          ) : loading ? (
            <div className="grid min-h-0 flex-1 place-items-center p-6">
              <CatalogLoading name="motors" label={t('motorDlg.loadingCatalog')} />
            </div>
          ) : (
            <ul className="min-h-0 flex-1 divide-y divide-line/5 overflow-y-auto">
              {matches.map((m) => {
                const k = keyOf(m);
                const isLoading = loadingKey === k;
                return (
                  <li key={k} className="flex items-stretch">
                    <button
                      onClick={() => choose(m)}
                      onDoubleClick={() => pick(m)}
                      disabled={loadingKey !== null}
                      aria-pressed={selectedKey === k}
                      className={`flex min-w-0 flex-1 items-center justify-between gap-2 px-3 py-2 text-left text-sm disabled:opacity-50 ${
                        selectedKey === k ? 'bg-accent-600/25 ring-1 ring-inset ring-accent-500/50' : 'hover:bg-raised'
                      }`}
                    >
                      <span className="min-w-0">
                        {m.custom && (
                          <span className="mr-1 text-warn-400" title={t('motor.importedTitle')}>
                            ★
                          </span>
                        )}
                        <span className="font-medium text-ink-strong">{m.code || m.designation}</span>
                        <span className="ml-2 text-xs text-ink-faint">{m.manufacturer}</span>
                        {!m.custom && !hasCurve(m) && (
                          <span
                            className="ml-2 rounded bg-elevated px-1 py-0.5 text-[9px] uppercase tracking-wide text-ink-muted"
                            title={t('motorDlg.noBundledCurve')}
                          >
                            {t('dash.noCurve')}
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 text-xs tabular-nums text-ink-muted">
                        {isLoading
                          ? t('motorDlg.loading')
                          : `${u.fmtSym('impulse', m.impulse, m.impulse < 10 ? 1 : 0)} · ${u.fmtSym('motorDimensions', m.diameter / 1000, 0)}`}
                      </span>
                    </button>
                    {m.custom && (
                      <button
                        onClick={() => onDelete(m)}
                        aria-label={t('motor.deleteTitle', { name: m.designation })}
                        className="shrink-0 px-3 text-danger-400 hover:bg-raised"
                      >
                        ✕
                      </button>
                    )}
                  </li>
                );
              })}
              {matches.length === 0 && (
                <li className="px-3 py-8 text-center text-sm text-ink-faint">
                  {t('motorDlg.noResults')}
                  {/* The likeliest reason for an empty list is the fit filter,
                      which is on by default whenever there is a mount to judge
                      against. Name it, rather than leaving a blank panel. */}
                  {fits && <div className="mt-1 text-xs text-ink-dim">{t('motorDlg.fitsMountHint')}</div>}
                </li>
              )}
            </ul>
          )}

          <div className="border-t border-line/10 p-2 text-center text-[11px] uppercase tracking-wide text-ink-faint">
            {loading ? '' : (note ?? t('motor.count', { total: matches.length }))}
          </div>
        </div>
        {/* end LEFT */}

        {/* RIGHT: detail + apply */}
        <div className={`min-h-0 min-w-0 flex-1 flex-col ${shown ? 'flex' : 'hidden md:flex'}`}>
          {shown ? (
            <>
              <MotorDetail
                motor={shown}
                onBack={() => setSelected(null)}
                curveIndex={curveIdx}
                onCurveChange={setCurveIdx}
              />
              <div className="flex shrink-0 items-center justify-between gap-2 border-t border-line/10 p-2">
                <DelayControl motor={shown} delay={delay} onDelay={setDelay} />
                <button
                  onClick={() => pick(shown, curveIdx)}
                  disabled={loadingKey !== null}
                  className="shrink-0 rounded-lg bg-accent-600 px-5 py-1.5 text-sm font-medium text-on-accent hover:bg-accent-500 disabled:cursor-not-allowed disabled:bg-raised disabled:text-ink-faint"
                >
                  {loadingKey !== null ? t('motorDlg.loading') : t('motorDlg.select')}
                </button>
              </div>
            </>
          ) : (
            <div className="grid flex-1 place-items-center p-6 text-center text-sm text-ink-faint">
              {t('motorDlg.pickHint')}
            </div>
          )}
        </div>
      </div>
      {/* end two-pane */}
    </Dialog>
  );
}

/** Delay picker for the selected motor: its own charges as quick chips (default
 *  a mid value), an optional Plugged chip, and a manual override. Plugged-only
 *  motors have no ejection charge, so nothing is shown. */
function DelayControl({ motor, delay, onDelay }: { motor: CatalogMotor; delay: number; onDelay: (d: number) => void }) {
  const { t } = useTranslation();
  const { delays, plugged } = parseDelays(motor.delays);
  if (plugged && delays.length === 0) return <span />; // plugged-only: already plugged, no choice to make
  const chip = 'rounded px-1.5 py-0.5 text-xs font-medium';
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1 text-xs text-ink-muted">
      <span className="text-ink-faint">{t('sims.delay')}</span>
      {delays.map((d) => (
        <ToggleButton key={d} active={delay === d} onClick={() => onDelay(d)} className={chip}>
          {d}
        </ToggleButton>
      ))}
      {/* Any motor can be flown plugged (no ejection charge), not just ones whose
          spec lists it: useful for staging / alternate recovery triggers. */}
      <ToggleButton active={delay >= PLUGGED_DELAY} onClick={() => onDelay(PLUGGED_DELAY)} className={chip}>
        {t('motor.plugged')}
      </ToggleButton>
      {/* `NumberInput`, not a raw <input>: this was the one data-entry box in the
          app that was not, and it committed a 0-second charge the moment the
          field was CLEARED to retype - an ejection charge that fires at burnout,
          on a motor the user was in the middle of choosing a delay for. The draft
          buffer exists for exactly that, and a blank box now means "no change"
          until a number is typed.

          Clamped at PLUGGED_DELAY rather than left open: every consumer already
          reads a delay at or above it as plugged (`toKernelDelay`), so an absurd
          typed number lands on the meaning it already had instead of arriving as
          an Infinity. */}
      <NumberInput
        min={0}
        max={PLUGGED_DELAY}
        step={0.5}
        value={delay >= PLUGGED_DELAY ? null : delay}
        onChange={(v) => {
          if (v !== null) onDelay(v);
        }}
        placeholder={t('motorDlg.custom')}
        ariaLabel={t('sims.delay')}
        className="w-14 rounded bg-canvas px-1.5 py-0.5 text-right tabular-nums text-ink-strong ring-1 ring-line/10 focus:outline-none focus:ring-accent-500"
      />
    </div>
  );
}
