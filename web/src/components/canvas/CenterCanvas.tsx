import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useWorkspaceStore, selectConfig, selectMotorDims } from '../../state/store';
import type { ResultFlight } from '../../services/flight/simulations';
import type { FlightResult } from '../../engine/openRocketEngine';
import { TreeSchematic } from './TreeSchematic';
import { AftView } from './AftView';
import { FlightChart } from './FlightChart';
import { GroundTrack } from './GroundTrack';
import { EnvironmentView } from './EnvironmentView';
import { FlightPathExport } from './FlightPathExport';
import { InfoOverlay } from './InfoOverlay';
import { AeroAnalysis } from './AeroAnalysis';
import { LazyBoundary, lazyNamed } from '../common/ErrorBoundary';
import { useExportData } from './useExportData';
import { useViewPrefs } from './useViewPrefs';
import { degToRad, radToDeg } from '../../prefs/units';
import { useUnits } from '../../prefs/useUnits';

// three.js is heavy, so the 3D views are code-split: their chunks load only when
// the user actually switches to a 3D view, keeping the default (2D) path light.
const Rocket3D = lazyNamed(() => import('./Rocket3D'), 'Rocket3D');
const FlightPath3D = lazyNamed(() => import('./FlightPath3D'), 'FlightPath3D');

// The roll slider overlays the far-left strip; reserve a gutter that width so
// the 2D drawing (and its left ruler) starts clear of it instead of underneath.
const ROLL_GUTTER = 30;

/**
 * The center pane's sized canvas box: the 2D roll slider, the info card, and
 * whichever of the 2D/3D/flight/path/ground/aero views is open.
 */
export function CenterCanvas({
  flight,
  pathResult,
  ctrlSlot,
}: {
  /** The flight the results views draw. */
  flight: ResultFlight | null;
  /** The flight the 3D path animates. */
  pathResult: FlightResult | null;
  /** Header slot the 2D schematic's control buttons portal into. */
  ctrlSlot: HTMLDivElement | null;
}) {
  const { t } = useTranslation();
  const view = useWorkspaceStore((s) => s.view);
  const twoD = useWorkspaceStore((s) => s.twoD);
  const roll = useWorkspaceStore((s) => s.roll);
  const onRollBy = useWorkspaceStore((s) => s.rollBy);
  const resetKey = useWorkspaceStore((s) => s.resetKey);
  const tree = useWorkspaceStore((s) => s.tree);
  const info = useWorkspaceStore((s) => s.info);
  const selectedId = useWorkspaceStore((s) => s.selectedId);
  const onSelect = useWorkspaceStore((s) => s.setSelectedId);
  const setErr = useWorkspaceStore((s) => s.setErr);
  const config = useWorkspaceStore(selectConfig);
  const motors = useMemo(() => selectMotorDims(tree, config), [tree, config]);
  const exportData = useExportData(motors);
  const { showMarkers, showInfoCard, rulers } = useViewPrefs();
  const loading = <div className="grid h-full place-items-center text-sm text-ink-faint">{t('view.loading3d')}</div>;
  const prompt = <div className="grid h-full place-items-center text-sm text-ink-faint">{t('sim.prompt')}</div>;

  return (
    // The view flexes to fill the pane; the stats strip below is a pinned
    // footer, so switching views never resizes the pane and the strip is
    // always visible without scrolling.
    //
    // `pb-2` to match the `pt-2`: without bottom padding a zoomed-in drawing
    // ends exactly on the pane's bottom edge, and the bottom ruler and the
    // roll slider's 360° label sit flush against the window.
    <div className="relative min-h-0 w-full flex-1 overflow-hidden px-3 pb-2 pt-2">
      {/* The roll slider belongs to the 2D view only. */}
      {view === '2d' && <RollSlider />}
      {/* Quick-glance stats card: sits inside the ruler frame on
      the 2D view (clear of the top + left rulers when they're on), and in the
      upper-left corner in 3D. Toggleable via the header Info button.

      In 3D it hangs below the view-preset row rather than level with it.
      That row is pinned top-right and the card top-left, and on a pane
      narrower than both put together they overlap; the card is z-20
      against the row's z-index 2, so level with it the card would cover
      the preset buttons and take their clicks. A readout yields to a
      control. */}
      {(view === '2d' || view === '3d') && showInfoCard && (
        <div
          className="absolute z-20"
          style={
            view === '2d'
              ? { left: (rulers.left ? 60 : 44) + ROLL_GUTTER, top: rulers.top ? 44 : 12 }
              : { left: 44, top: 44 }
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
        <LazyBoundary fallback={loading}>
          <Rocket3D
            tree={tree}
            info={info}
            motors={motors}
            selectedId={selectedId}
            onSelect={onSelect}
            showMarkers={showMarkers}
            exportData={exportData}
          />
        </LazyBoundary>
      ) : view === 'flight' ? (
        // Keyed on the simulation: a different flight gets a fresh chart
        // (trace selection and zoom start over), while a re-run of the
        // same simulation keeps its id and so keeps the view. Resetting
        // both through effects keyed on the trace list instead blanks the
        // first frame and leaves a stale zoom on re-run.
        <div className="h-full p-2">{flight ? <FlightChart key={flight.id} flight={flight} /> : prompt}</div>
      ) : view === 'path' ? (
        <div className="relative h-full p-2">
          {pathResult ? (
            <>
              <LazyBoundary fallback={loading}>
                {/* One rocket is animated, so this follows the picker's
                      first choice rather than overlaying like the charts and
                      the ground track do. */}
                <FlightPath3D
                  result={pathResult}
                  tree={tree}
                  motors={motors}
                  latitudeDeg={flight?.launch.latitudeDeg}
                  longitudeDeg={flight?.launch.longitudeDeg}
                />
              </LazyBoundary>
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
            // The coordinates come off the flight's own simulation, not
            // the active one: the Results picker can be showing a row
            // other than the one being edited.
            <GroundTrack
              flight={flight}
              latitudeDeg={flight.launch.latitudeDeg}
              longitudeDeg={flight.launch.longitudeDeg}
              launch={flight.launch}
            />
          ) : (
            prompt
          )}
        </div>
      ) : view === 'environment' ? (
        <div className="h-full">{flight ? <EnvironmentView flight={flight} /> : prompt}</div>
      ) : (
        <div className="h-full p-2">{info ? <AeroAnalysis /> : prompt}</div>
      )}
    </div>
  );
}

/** The 2D view's vertical roll slider, overlaid on the far-left gutter. */
function RollSlider() {
  const { t } = useTranslation();
  const roll = useWorkspaceStore((s) => s.roll);
  const onRollValue = useWorkspaceStore((s) => s.setRoll);
  const u = useUnits();
  // The slider runs in degrees; its labels read in the user's angle unit.
  const deg = Math.round(radToDeg(roll));
  // Whole degrees, as the slider steps; a radian needs two decimals to move.
  const digits = u.sym('angle') === '°' ? 0 : 2;
  const shown = u.fmtSym('angle', degToRad(deg), digits);
  return (
    <div
      className="absolute inset-y-2 left-1 z-10 flex w-8 flex-col items-center text-[11px] font-semibold leading-none text-ink-soft"
      title={t('view.rollHint')}
    >
      <span className="pb-1">{u.fmtSym('angle', 0, digits)}</span>
      <input
        type="range"
        min={0}
        max={360}
        step={5}
        value={deg}
        onChange={(e) => onRollValue(degToRad(parseFloat(e.target.value)))}
        title={t('view.roll', { deg: shown })}
        aria-label={t('view.rollAria')}
        className="accent-accent-500"
        style={{ writingMode: 'vertical-lr', width: '100%', flex: '1 1 0%', minHeight: 0 }}
      />
      <span className="pt-1">{u.fmtSym('angle', 2 * Math.PI, digits)}</span>
      {/* Live roll readout, centered on the slider. */}
      <span className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded bg-raised/95 px-0.5 py-0.5 text-[9px] text-accent-300 ring-1 ring-line/10">
        {shown}
      </span>
    </div>
  );
}
