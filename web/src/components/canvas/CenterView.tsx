import { lazy, Suspense, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useWorkspaceStore, selectActive, selectMotorDims } from '../../state/store';
import { TreeSchematic } from './TreeSchematic';
import { AftView } from './AftView';
import { FlightChart } from './FlightChart';
import { ViewToggle } from './ViewToggle';
import { StabilityBadge } from './StabilityBadge';
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

  const deg = Math.round((roll * 180) / Math.PI);
  const loading = <div className="grid h-full place-items-center text-sm text-slate-500">{t('view.loading3d')}</div>;
  const prompt = <div className="grid h-full place-items-center text-sm text-slate-500">{t('sim.prompt')}</div>;

  return (
    <>
      {loadedMeta && <LoadedBanner loaded={loadedMeta} onClose={onCloseLoaded} />}
      <div className="flex justify-end px-3 pt-3">
        <ViewToggle view={view} onChange={onView} />
      </div>
      {/* All views share one sized box so switching doesn't resize the pane. */}
      <div className="relative h-[70vh] min-h-[420px] w-full px-3 pt-2 lg:h-[calc(100vh_-_14rem)]">
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
            </div>
            {/* View presets, upper-left (mirrors the 3D view's buttons). */}
            <div className="absolute left-11 top-3 z-10 flex gap-1">
              <ViewBtn onClick={onResetView}>{t('view.reset')}</ViewBtn>
              <ViewBtn active={twoD === 'side'} onClick={() => onTwoD('side')}>{t('view.side')}</ViewBtn>
              <ViewBtn active={twoD === 'aft'} onClick={() => onTwoD('aft')}>{t('view.aft')}</ViewBtn>
            </div>
            {/* Always-visible current roll readout. */}
            <div className="absolute left-11 top-12 z-10 rounded-md bg-slate-800/90 px-2 py-0.5 text-xs font-semibold text-sky-300 ring-1 ring-white/10">
              {t('view.roll', { deg })}
            </div>
          </>
        )}
        {view === '2d'
          ? (twoD === 'side'
              ? <TreeSchematic key={`side-${resetKey}`} tree={tree} info={info} motors={motors} fillHeight roll={roll} onRoll={onRollBy} selectedId={selectedId} onSelect={onSelect} />
              : <AftView key={`aft-${resetKey}`} tree={tree} roll={roll} motors={motors} onRoll={onRollBy} />)
          : view === '3d'
            ? <Suspense fallback={loading}><Rocket3D tree={tree} info={info} motors={motors} selectedId={selectedId} onSelect={onSelect} /></Suspense>
            : view === 'flight'
              ? <div className="h-full p-2">{result ? <FlightChart result={result} /> : prompt}</div>
              : <div className="h-full p-2">{result ? <Suspense fallback={loading}><FlightPath3D result={result} tree={tree} motors={motors} /></Suspense> : prompt}</div>}
      </div>
      <StabilityBadge info={info} />
    </>
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
