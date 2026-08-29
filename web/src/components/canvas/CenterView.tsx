import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useWorkspaceStore, selectActive, selectMotorDims } from '../../state/store';
import { useSettings } from '../../state/SettingsProvider';
import { TreeSchematic } from './TreeSchematic';
import { AftView } from './AftView';
import { FlightChart } from './FlightChart';
import { ViewToggle } from './ViewToggle';
import { StabilityBadge } from './StabilityBadge';
import { InfoOverlay } from './InfoOverlay';
import { DragAnalysis } from './DragAnalysis';
import { LoadedBanner } from './LoadedBanner';

// three.js is heavy, so the 3D views are code-split — their chunks load only when
// the user actually switches to a 3D view, keeping the default (2D) path light.
const Rocket3D = lazy(() => import('./Rocket3D').then((m) => ({ default: m.Rocket3D })));
const FlightPath3D = lazy(() => import('./FlightPath3D').then((m) => ({ default: m.FlightPath3D })));

/**
 * The center workbench pane: an import banner, the 2D/3D/flight/path view switch,
 * the sized canvas box (with the 2D roll slider + Side/Aft/Reset presets), and the
 * stability readout. Reads the workspace store directly.
 */
export function CenterView() {
  const { t } = useTranslation();
  const loadedMeta = useWorkspaceStore((s) => s.loadedMeta);
  const onCloseLoaded = useWorkspaceStore((s) => s.resetWorkspace);
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
  const motor = useWorkspaceStore((s) => selectActive(s).motor);
  const extraMotors = useWorkspaceStore((s) => s.extraMotors);
  const motors = useMemo(() => selectMotorDims(tree, motor, extraMotors), [tree, motor, extraMotors]);

  // Optionally auto-run an outdated (never-run/stale) sim when a results view opens.
  const { settings } = useSettings();
  const runSim = useWorkspaceStore((s) => s.runSim);
  const busy = useWorkspaceStore((s) => s.simBusy);
  useEffect(() => {
    if (settings.simulation.autoRunOutdated && (view === 'flight' || view === 'path') && !result && info && !busy) {
      runSim(settings.simulation);
    }
  }, [view, result, info, busy, settings.simulation, runSim]);

  // Flight / 3D-path only exist while a result does. If the active result goes
  // away (a design edit invalidates it) while one of those views is open, fall
  // back to the design view — unless auto-run is about to refill it.
  useEffect(() => {
    const onResultView = view === 'flight' || view === 'path';
    const willAutoRun = settings.simulation.autoRunOutdated && !!info;
    if (onResultView && !result && !busy && !willAutoRun) onView('2d');
  }, [view, result, busy, info, settings.simulation.autoRunOutdated, onView]);

  // Header slot the 2D schematic's control buttons (calipers, zoom, export)
  // portal into, so they sit centred in the same row as the view toggle.
  const [ctrlSlot, setCtrlSlot] = useState<HTMLDivElement | null>(null);
  const deg = Math.round((roll * 180) / Math.PI);
  const loading = <div className="grid h-full place-items-center text-sm text-slate-500">{t('view.loading3d')}</div>;
  const prompt = <div className="grid h-full place-items-center text-sm text-slate-500">{t('sim.prompt')}</div>;

  return (
    <div className="flex h-full flex-col">
      {loadedMeta && <LoadedBanner loaded={loadedMeta} onClose={onCloseLoaded} />}
      <div className="flex shrink-0 items-center justify-between gap-2 px-3 pt-3">
        {/* 2D view presets, left-justified in the same row as the view toggle. */}
        <div className="flex gap-1">
          {view === '2d' && (
            <>
              <ViewBtn onClick={onResetView}>{t('view.reset')}</ViewBtn>
              <ViewBtn active={twoD === 'side'} onClick={() => onTwoD('side')}>{t('view.side')}</ViewBtn>
              <ViewBtn active={twoD === 'aft'} onClick={() => onTwoD('aft')}>{t('view.aft')}</ViewBtn>
            </>
          )}
        </div>
        {/* Center slot: the 2D schematic portals its caliper / zoom / export buttons here. */}
        <div ref={setCtrlSlot} className="flex items-center gap-1" />
        <ViewToggle view={view} onChange={onView} hasResult={!!result} />
      </div>
      {/* The view flexes to fill the pane; the stats strip below is a pinned
          footer, so switching views never resizes the pane and the strip is
          always visible without scrolling. */}
      <div className="relative min-h-0 w-full flex-1 overflow-hidden px-3 pt-2">
        {view === '2d' && (
          <>
            <div
              className="absolute inset-y-2 left-1 z-10 flex w-8 flex-col items-center text-[11px] font-semibold leading-none text-slate-300"
              title={t('view.rollHint')}
            >
              <span className="pb-1">0°</span>
              <input
                type="range" min={0} max={360} step={5}
                value={deg}
                onChange={(e) => onRollValue((parseFloat(e.target.value) * Math.PI) / 180)}
                title={t('view.roll', { deg })}
                aria-label={t('view.rollAria')}
                className="accent-sky-500"
                style={{ writingMode: 'vertical-lr', width: '100%', flex: '1 1 0%', minHeight: 0 }}
              />
              <span className="pt-1">360°</span>
              {/* Live roll readout, centred on the slider. */}
              <span className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded bg-slate-800/95 px-0.5 py-0.5 text-[9px] text-sky-300 ring-1 ring-white/10">{deg}°</span>
            </div>
            {/* Quick-glance stats box, upper-left (mmrocket-style). */}
            <div className="absolute left-11 top-3 z-10">
              <InfoOverlay info={info} />
            </div>
          </>
        )}
        {view === '2d'
          ? (twoD === 'side'
              ? <TreeSchematic key={`side-${resetKey}`} tree={tree} info={info} motors={motors} fillHeight roll={roll} onRoll={onRollBy} selectedId={selectedId} onSelect={onSelect} controlsSlot={ctrlSlot} />
              : <AftView key={`aft-${resetKey}`} tree={tree} roll={roll} motors={motors} onRoll={onRollBy} />)
          : view === '3d'
            ? <Suspense fallback={loading}><Rocket3D tree={tree} info={info} motors={motors} selectedId={selectedId} onSelect={onSelect} /></Suspense>
            : view === 'flight'
              ? <div className="h-full p-2">{result ? <FlightChart result={result} /> : prompt}</div>
              : view === 'path'
                ? <div className="h-full p-2">{result ? <Suspense fallback={loading}><FlightPath3D result={result} tree={tree} motors={motors} /></Suspense> : prompt}</div>
                : <div className="h-full p-2">{info ? <DragAnalysis /> : prompt}</div>}
      </div>
      <div className="shrink-0">
        <StabilityBadge info={info} />
      </div>
    </div>
  );
}

/** Small overlay button for the 2D view presets (Side / Aft / Reset). */
function ViewBtn({ active, onClick, children }: { active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md px-2 py-1 text-xs font-medium ring-1 ring-white/10 ${active ? 'bg-sky-600 text-white' : 'bg-slate-800/90 text-slate-200'}`}
    >
      {children}
    </button>
  );
}
