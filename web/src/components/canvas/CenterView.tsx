import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useWorkspaceStore,
  selectActive,
  selectExtraMotors,
  selectMotorDims,
  selectRunFailed,
} from '../../state/store';
import { confirm } from '../../state/confirmStore';
import { useSettings } from '../../state/SettingsProvider';
import { useUnits } from '../../prefs/useUnits';
import { APP_VERSION, appName } from '../../services/appInfo';
import { descentMass } from '../../services/recoverySizing';
import { resultFlight, type ResultFlight } from '../../services/simulations';
import { TreeSchematic } from './TreeSchematic';
import { AftView } from './AftView';
import { FlightChart } from './FlightChart';
import { GroundTrack } from './GroundTrack';
import { ResultPicker } from '../sim/ResultPicker';
import { FlightPathExport } from './FlightPathExport';
import { ViewToggle, isResultView } from './ViewToggle';
import { StabilityBadge } from './StabilityBadge';
import { DesignWarnings } from './DesignWarnings';
import { InfoOverlay } from './InfoOverlay';
import { AeroAnalysis } from './AeroAnalysis';
import { LoadedBanner } from './LoadedBanner';
import { SimSummary } from '../sim/SimSummary';
import { useIsDesktop } from '../common/useMediaQuery';
import { FlightWarnings } from '../sim/FlightWarnings';

// three.js is heavy, so the 3D views are code-split — their chunks load only when
// the user actually switches to a 3D view, keeping the default (2D) path light.
const Rocket3D = lazy(() => import('./Rocket3D').then((m) => ({ default: m.Rocket3D })));
const FlightPath3D = lazy(() => import('./FlightPath3D').then((m) => ({ default: m.FlightPath3D })));

/**
 * The center workbench pane: an import banner, the 2D/3D/flight/path view switch,
 * the sized canvas box (with the 2D roll slider + Side/Aft/Reset presets), and the
 * stability readout. Reads the workspace store directly.
 *
 * On a phone this one pane backs two tabs — Rocket (banner + stats) and Sketch
 * (the drawing) — because a phone has no room for both at once. At lg+ the tabs
 * are gone and everything shows together, exactly as before.
 */
export function CenterView() {
  const { t } = useTranslation();
  const tab = useWorkspaceStore((s) => s.tab);
  const designPane = useWorkspaceStore((s) => s.designPane);
  // The warnings block below is rendered once for the whole app - here on a
  // phone, in the Results column at lg+ (App.tsx). See useMediaQuery.
  const desktop = useIsDesktop();
  const loadedMeta = useWorkspaceStore((s) => s.loadedMeta);
  const setErr = useWorkspaceStore((s) => s.setErr);
  const resetWorkspace = useWorkspaceStore((s) => s.resetWorkspace);
  // "Close" discards the loaded design and resets to a fresh one — confirm first.
  const onCloseLoaded = async () => {
    if (await confirm({ message: t('banner.closeConfirm'), confirmLabel: t('common.discard'), danger: true })) {
      resetWorkspace();
    }
  };
  const view = useWorkspaceStore((s) => s.view);
  const onView = useWorkspaceStore((s) => s.setView);
  const twoD = useWorkspaceStore((s) => s.twoD);
  const onTwoD = useWorkspaceStore((s) => s.setTwoD);
  const roll = useWorkspaceStore((s) => s.roll);
  const onRollValue = useWorkspaceStore((s) => s.setRoll);
  const onRollBy = useWorkspaceStore((s) => s.rollBy);
  const onResetView = useWorkspaceStore((s) => s.resetView);
  const resetKey = useWorkspaceStore((s) => s.resetKey);
  const tree = useWorkspaceStore((s) => s.tree);
  const info = useWorkspaceStore((s) => s.info);
  const selectedId = useWorkspaceStore((s) => s.selectedId);
  const onSelect = useWorkspaceStore((s) => s.setSelectedId);
  const result = useWorkspaceStore((s) => selectActive(s).result);
  const sims = useWorkspaceStore((s) => s.sims);
  const activeId = useWorkspaceStore((s) => selectActive(s).id);
  const resultSimId = useWorkspaceStore((s) => s.resultSimId);
  const outdated = useWorkspaceStore((s) => selectActive(s).outdated);
  const simName = useWorkspaceStore((s) => selectActive(s).name);
  const motor = useWorkspaceStore((s) => selectActive(s).motor);
  const extraMotors = useWorkspaceStore(selectExtraMotors);
  const motors = useMemo(() => selectMotorDims(tree, motor, extraMotors), [tree, motor, extraMotors]);

  /**
   * The flight every results view draws, chosen in the Results picker.
   *
   * Built here with useMemo rather than as a store selector: a selector that
   * builds a fresh object is compared by reference by zustand, so subscribing to
   * one re-renders forever (see `selectRunIds`).
   */
  const flight = useMemo<ResultFlight | null>(
    () => resultFlight(sims, resultSimId, activeId),
    [sims, resultSimId, activeId],
  );

  /**
   * The flight the 3D path animates: the one being SHOWN, falling back to the
   * active row's own result.
   *
   * Bound once so the guard and the view cannot disagree. They did: the guard
   * asked the active simulation for a result while the view below it drew this
   * expression, so adding a second row after a run - or picking another row in
   * the Results picker - left the 3D path saying "run a simulation" while the
   * charts beside it drew the flight.
   */
  const pathResult = flight?.result ?? result;

  /**
   * The header block the 2D/3D image exports stamp on the page — name, the
   * static numbers, the user's units, the app version.
   *
   * This existed unreachable: `TreeSchematic` and `Rocket3D` gate their export
   * buttons on `exportData` and nothing ever passed it, so `⬇ SVG`, `⬇ Image`,
   * `📷 Image`, `ImageExportMenu`, `schematicSvg`, `svgToImage` and
   * `snapshotWithHeader` — several hundred lines plus a whole service — were
   * shipped and unusable. `git log -S exportData` says it was never wired.
   */
  const units = useUnits();
  const exportData = useMemo(
    () => ({
      name: loadedMeta?.name || (typeof tree.name === 'string' && tree.name) || appName(),
      info,
      units: units.all,
      withMotors: Object.keys(motors).length > 0,
      appVersion: APP_VERSION,
    }),
    [loadedMeta, tree.name, info, units.all, motors],
  );
  // Recovery weight = loaded mass − the propellant that burns off (every motor's
  // loaded-minus-burnout mass). Undefined with no motor loaded — nothing to
  // subtract — so the tile shows a "needs a motor" hint instead of a wrong number.
  const recoveryWeight = useMemo(
    () => descentMass(info?.mass, [motor, ...Object.values(extraMotors).map((e) => e.spec)]) ?? undefined,
    [info?.mass, motor, extraMotors],
  );

  // Optionally auto-run an outdated (never-run/stale) sim when a results view opens.
  const { settings, update } = useSettings();
  // CG/CP markers + info-card visibility are user preferences (persist across reloads).
  const showMarkers = settings.showMarkers;
  const showInfoCard = settings.showInfoCard;
  const rulers = settings.rulers;
  const toggleMarkers = () => update({ showMarkers: !settings.showMarkers });
  const toggleInfoCard = () => update({ showInfoCard: !settings.showInfoCard });
  const toggleRulerSide = (side: keyof typeof rulers) =>
    update({ rulers: { ...settings.rulers, [side]: !settings.rulers[side] } });

  // Give the drawing the whole window: both side columns step aside (App.tsx
  // reads the same flag). An airframe is far longer than it is wide, so the
  // horizontal space is what it is short of.
  const maxed = settings.maximizeCenter;
  const toggleMaxed = () => update({ maximizeCenter: !maxed });
  // Escape gets out, because a mode that hides two panels needs a way back that
  // does not depend on finding one small button. Ignored while a dialog is open:
  // dialogs take Escape for themselves, and this would close both at once.
  useEffect(() => {
    if (!maxed) return;
    const esc = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('[role="dialog"]')) return;
      update({ maximizeCenter: false });
    };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [maxed, update]);
  const runSim = useWorkspaceStore((s) => s.runSim);
  const busy = useWorkspaceStore((s) => s.simBusy);
  // A run that threw leaves exactly the state auto-run fires on (no result, not
  // busy, result view open), so without this it retried the same failing design
  // forever -- each iteration spawning another full flight sim.
  const runFailed = useWorkspaceStore(selectRunFailed);
  // Asks "is there a design?" as a BOOLEAN, never the `info` object: an engine
  // rebuild (applyBuild) hands the store a fresh info identity, and depending on
  // that re-fires the effect for a design that hasn't actually changed.
  const hasDesign = !!info;
  // "Run outdated simulations automatically" — which, until results were kept
  // across an edit, could only ever mean "never run": an edit destroyed the
  // result, so the only state this could see was a missing one. Now it covers
  // both, which is what the setting has always said.
  const needsRun = !result || !!outdated;
  useEffect(() => {
    if (settings.simulation.autoRunOutdated && isResultView(view) && needsRun && hasDesign && !busy && !runFailed) {
      runSim(settings.simulation);
    }
  }, [view, needsRun, hasDesign, busy, runFailed, settings.simulation, runSim]);

  // There used to be a second effect here that walked you off a result view when
  // the result vanished under you. Nothing vanishes any more — an edit ages the
  // numbers instead of deleting them — and a simulation that has never been run
  // shows the "run one" prompt below rather than an empty pane.

  // Header slot the 2D schematic's control buttons (calipers, zoom, export)
  // portal into, so they sit centered in the same row as the view toggle.
  const [ctrlSlot, setCtrlSlot] = useState<HTMLDivElement | null>(null);
  const deg = Math.round((roll * 180) / Math.PI);
  // The roll slider overlays the far-left strip; reserve a gutter that width so
  // the 2D drawing (and its left ruler) starts clear of it instead of underneath.
  const ROLL_GUTTER = 30;
  // Which views are turned a quarter turn on a portrait phone: the design views.
  // All three want to be wide — the 2D schematic and the 3D model because a
  // hobby airframe is 15-25x longer than it is wide, the aero charts because
  // they sweep Mach across the x axis. The flight views stay upright.
  const sideways = view === '2d' || view === '3d' || view === 'drag';
  // This pane backs two tabs, and on the Design one a phone shows only half of
  // it at a time. At lg+ `designPane` is ignored and Design shows both halves,
  // which is what the `lg:` overrides below say. Results shows only the drawing
  // half (the banner and the stats strip describe the DESIGN, not the run).
  const onDesign = tab === 'design';
  const showStats = onDesign && designPane === 'stats';
  const showDrawing = (onDesign && designPane === 'sketch') || tab === 'results';
  const loading = <div className="grid h-full place-items-center text-sm text-slate-500">{t('view.loading3d')}</div>;
  const prompt = <div className="grid h-full place-items-center text-sm text-slate-500">{t('sim.prompt')}</div>;

  return (
    <div className="flex h-full flex-col">
      {/* Always: it carries the design's NAME and the ✎ that edits it, which
          used to sit in the component tree's header. The import label, the notes
          and Close only appear when the design came from a file. */}
      <div className={`${showStats ? '' : 'hidden'} shrink-0 ${onDesign ? 'lg:block' : ''}`}>
        <LoadedBanner loaded={loadedMeta} onClose={onCloseLoaded} />
      </div>
      {/* The run's numbers head the mobile Results tab, above the charts they
          describe — they are what you look at first, and reading them used to
          mean going back to the Simulate tab. `lg:hidden` because the desktop
          Results tab has them in its own right-hand column (see App.tsx).
          Capped at 45% and scrolling: the tiles are a fixed ~300px, which on a
          568-tall phone left the chart 91px of a pane it is supposed to fill. */}
      {tab === 'results' && (
        <div className="max-h-[45%] shrink-0 space-y-3 overflow-y-auto px-3 pt-3 lg:hidden">
          {!desktop && <FlightWarnings sim={result} />}
          <SimSummary sim={result} />
        </div>
      )}
      {/* Everything from here to the stats strip is the DRAWING half: the view
          switch and the canvas. On a phone the Design tab shows it on the Sketch
          half; at lg+ Design always shows it, and so does Results.

          The whole half turns as ONE piece on a portrait phone (see
          .sketch-rotate) — toolbar included, so the toolbar always sits along
          the long edge of the screen, at the top of the drawing it controls,
          whichever view is open. Turning the canvas alone would leave the
          toolbar across the short edge, detached from what it acts on, and
          moving it whenever the view changed. */}
      <div
        className={`${showDrawing ? 'flex' : 'hidden'} ${sideways ? 'sketch-stage' : ''} min-h-0 w-full flex-1 flex-col overflow-hidden lg:flex`}
      >
        <div className={sideways ? 'sketch-rotate flex flex-col' : 'flex min-h-0 flex-1 flex-col'}>
          {/* Wraps for the same reason the app header does: the presets, the
          portalled canvas controls and the view toggle do not fit a phone's
          width in one row, and an unwrapped row scrolls the whole page
          sideways. */}
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 px-3 pt-3">
            {/* 2D view presets + the CG/CP · Info toggles, left-justified in the
            same row as the view toggle. The toggles apply to both 2D and 3D. */}
            <div className="flex flex-wrap items-center gap-1">
              {/* Whose flight this is. The design views are about the one rocket
              on screen and need no label, but a result belongs to a named
              simulation, and with several of them the charts are otherwise
              unattributed. The stale marker rides along because results now
              survive a design edit — the numbers stay readable, so the tab has
              to say when they no longer describe the rocket. */}
              {tab === 'results' && (
                <div className="flex items-center gap-2">
                  {/* A heading, not a span: it titles the whole pane, and a
                  screen reader should be able to jump to it. Once a second
                  simulation has flown the picker BECOMES the heading — the name
                  and a dropdown showing the same name beside it said one thing
                  twice. `ResultPicker` renders its own h2 in that case. */}
                  <ResultPicker fallbackName={flight?.name ?? simName} />
                  {outdated && result && (
                    <span className="rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-300 ring-1 ring-amber-400/30">
                      {t('sims.statusOutdated')}
                    </span>
                  )}
                </div>
              )}
              {view === '2d' && (
                <>
                  <ViewBtn onClick={onResetView}>{t('view.reset')}</ViewBtn>
                  <ViewBtn active={twoD === 'side'} onClick={() => onTwoD('side')}>
                    {t('view.side')}
                  </ViewBtn>
                  <ViewBtn active={twoD === 'aft'} onClick={() => onTwoD('aft')}>
                    {t('view.aft')}
                  </ViewBtn>
                </>
              )}
              {(view === '2d' || view === '3d') && (
                <>
                  <ViewBtn active={showMarkers} onClick={toggleMarkers} title={t('view.markersTitle')}>
                    {t('view.markers')}
                  </ViewBtn>
                  <ViewBtn active={showInfoCard} onClick={toggleInfoCard} title={t('view.infoCardTitle')}>
                    {t('view.infoCard')}
                  </ViewBtn>
                  {/* Rulers only frame the 2D side view; one toggle per side (T/B/L/R). */}
                  {view === '2d' && (
                    <div className="flex items-center gap-1">
                      <span className="pl-1 text-xs font-medium text-slate-400">{t('view.rulers')}</span>
                      {(['top', 'bottom', 'left', 'right'] as const).map((side) => (
                        <ViewBtn
                          key={side}
                          active={rulers[side]}
                          onClick={() => toggleRulerSide(side)}
                          title={t(`view.ruler_${side}`)}
                        >
                          {t(`view.ruler_${side}_abbr`)}
                        </ViewBtn>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
            {/* Center slot: the 2D schematic portals its caliper / zoom / export buttons here. */}
            <div ref={setCtrlSlot} className="flex items-center gap-1" />
            {/* ml-auto keeps it hard right even when it wraps onto a line of its
            own, where justify-between has nothing to push against. */}
            <div className="ml-auto flex shrink-0 items-center gap-1">
              <ViewToggle view={view} onChange={onView} family={tab === 'results' ? 'result' : 'design'} />
              {/* Desktop only: there are no side columns below lg for it to
                  reclaim, so the button would be a no-op there. */}
              <span className="hidden lg:block">
                <ViewBtn
                  active={maxed}
                  onClick={toggleMaxed}
                  title={maxed ? t('panes.restore') : t('panes.maximize')}
                  label={maxed ? t('panes.restore') : t('panes.maximize')}
                >
                  <span aria-hidden>{maxed ? '⤡' : '⤢'}</span>
                </ViewBtn>
              </span>
            </div>
          </div>
          {/* The view flexes to fill the pane; the stats strip below is a pinned
          footer, so switching views never resizes the pane and the strip is
          always visible without scrolling.

          `pb-2` to match the `pt-2`: this box had padding on three sides, so a
          zoomed-in drawing ended exactly ON the pane's bottom edge - the bottom
          ruler and the roll slider's 360° label sat flush against the window
          with nothing under them. */}
          <div className="relative min-h-0 w-full flex-1 overflow-hidden px-3 pb-2 pt-2">
            {/* Canvas parts can be dragged to reposition them (a design edit), so
            lock the design views while a sim runs. Results views (flight/path)
            don't mutate the design, so they stay interactive. */}
            {view === '2d' && (
              <>
                <div
                  className="absolute inset-y-2 left-1 z-10 flex w-8 flex-col items-center text-[11px] font-semibold leading-none text-slate-300"
                  title={t('view.rollHint')}
                >
                  <span className="pb-1">0°</span>
                  <input
                    type="range"
                    min={0}
                    max={360}
                    step={5}
                    value={deg}
                    onChange={(e) => onRollValue((parseFloat(e.target.value) * Math.PI) / 180)}
                    title={t('view.roll', { deg })}
                    aria-label={t('view.rollAria')}
                    className="accent-sky-500"
                    style={{ writingMode: 'vertical-lr', width: '100%', flex: '1 1 0%', minHeight: 0 }}
                  />
                  <span className="pt-1">360°</span>
                  {/* Live roll readout, centered on the slider. */}
                  <span className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded bg-slate-800/95 px-0.5 py-0.5 text-[9px] text-sky-300 ring-1 ring-white/10">
                    {deg}°
                  </span>
                </div>
              </>
            )}
            {/* Quick-glance stats card (mmrocket-style): sits INSIDE the ruler frame on
            the 2D view (clear of the top + left rulers when they're on), and in the
            upper-left corner in 3D. Toggleable via the header Info button. */}
            {(view === '2d' || view === '3d') && showInfoCard && (
              <div
                className="absolute z-20"
                style={
                  view === '2d'
                    ? { left: (rulers.left ? 60 : 44) + ROLL_GUTTER, top: rulers.top ? 44 : 12 }
                    : { left: 44, top: 12 }
                }
              >
                <InfoOverlay info={info} />
              </div>
            )}
            {view === '2d' ? (
              // Left-padded so the drawing clears the roll slider's gutter.
              <div className="h-full" style={{ paddingLeft: ROLL_GUTTER }}>
                {twoD === 'side' ? (
                  <TreeSchematic
                    key={`side-${resetKey}`}
                    tree={tree}
                    info={info}
                    motors={motors}
                    fillHeight
                    roll={roll}
                    onRoll={onRollBy}
                    selectedId={selectedId}
                    onSelect={onSelect}
                    controlsSlot={ctrlSlot}
                    showMarkers={showMarkers}
                    rulers={rulers}
                    exportData={exportData}
                    onError={setErr}
                  />
                ) : (
                  <AftView key={`aft-${resetKey}`} tree={tree} roll={roll} motors={motors} onRoll={onRollBy} />
                )}
              </div>
            ) : view === '3d' ? (
              <Suspense fallback={loading}>
                <Rocket3D
                  tree={tree}
                  info={info}
                  motors={motors}
                  selectedId={selectedId}
                  onSelect={onSelect}
                  showMarkers={showMarkers}
                  exportData={exportData}
                />
              </Suspense>
            ) : view === 'flight' ? (
              // Keyed on the simulation: a different flight gets a fresh chart
              // (trace selection and zoom start over), while a re-run of the
              // SAME simulation keeps its id and so keeps the view. FlightChart
              // used to reset both through effects keyed on the trace list,
              // which blanked the first frame and left a stale zoom on re-run.
              <div className="h-full p-2">{flight ? <FlightChart key={flight.id} flight={flight} /> : prompt}</div>
            ) : view === 'path' ? (
              <div className="relative h-full p-2">
                {pathResult ? (
                  <>
                    <Suspense fallback={loading}>
                      {/* One rocket is animated, so this follows the picker's
                          FIRST choice rather than overlaying like the charts and
                          the ground track do. */}
                      <FlightPath3D
                        result={pathResult}
                        tree={tree}
                        motors={motors}
                        latitudeDeg={flight?.launch.latitudeDeg}
                        longitudeDeg={flight?.launch.longitudeDeg}
                      />
                    </Suspense>
                    <div className="pointer-events-none absolute inset-x-0 top-5 z-10 flex justify-center">
                      <div className="pointer-events-auto">
                        <FlightPathExport variant="overlay" />
                      </div>
                    </div>
                  </>
                ) : (
                  prompt
                )}
              </div>
            ) : view === 'ground' ? (
              <div className="h-full p-2">
                {flight ? (
                  // The coordinates come off the flight's OWN simulation, not
                  // the active one: the Results picker can be showing a row
                  // other than the one being edited.
                  <GroundTrack
                    flight={flight}
                    latitudeDeg={flight.launch.latitudeDeg}
                    longitudeDeg={flight.launch.longitudeDeg}
                  />
                ) : (
                  prompt
                )}
              </div>
            ) : (
              <div className="h-full p-2">{info ? <AeroAnalysis /> : prompt}</div>
            )}
          </div>
        </div>
      </div>
      {/* Static statistics + design warnings. Out of the way when maximized: they
          are a footer about the design, not part of the drawing, and at full
          width they took 175px off the top of the very thing the expand was
          meant to give room to. The `lg:` gate alone, so a phone (where the
          Sketch/Stats split decides this instead) is untouched. */}
      <div
        className={`${showStats ? '' : 'hidden'} min-h-0 flex-1 overflow-y-auto lg:flex-none lg:overflow-visible ${
          onDesign && !maxed ? 'lg:block' : ''
        } ${maxed ? 'lg:hidden' : ''}`}
      >
        <DesignWarnings />
        <StabilityBadge
          info={info}
          recoveryWeight={recoveryWeight}
          expanded={settings.showStats}
          onToggle={() => update({ showStats: !settings.showStats })}
        />
      </div>
    </div>
  );
}

/** Small overlay button for the 2D view presets (Side / Aft / Reset) and the
 *  CG/CP · Info view toggles. */
function ViewBtn({
  active,
  onClick,
  title,
  label,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  title?: string;
  /** Accessible name, for a button whose content is a bare glyph. */
  label?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={label}
      aria-pressed={active}
      className={`rounded-md px-2 py-1 text-xs font-medium ring-1 ring-white/10 ${active ? 'bg-sky-600 text-white' : 'bg-slate-800/90 text-slate-200'}`}
    >
      {children}
    </button>
  );
}
