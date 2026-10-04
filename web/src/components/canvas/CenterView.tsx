import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useWorkspaceStore, selectActive, selectDesignName } from '../../state/store';
import { confirm } from '../../state/confirmStore';
import { useSettings } from '../../state/SettingsProvider';
import { StabilityBadge } from './StabilityBadge';
import { DesignWarnings } from './DesignWarnings';
import { LoadedBanner } from './LoadedBanner';
import { CenterToolbar } from './CenterToolbar';
import { CenterCanvas } from './CenterCanvas';
import { FlightEventsTable } from '../sim/FlightEventsTable';
import { SimSummary } from '../sim/SimSummary';
import { useIsDesktop } from '../common/useMediaQuery';
import { FlightWarnings } from '../sim/FlightWarnings';
import { useResultFlight } from './useResultFlight';
import { useRecoveryMass } from './useRecoveryMass';
import { useMaximizeCenter } from './useMaximizeCenter';
import { useAutoRunOutdated } from './useAutoRunOutdated';

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
  const resetWorkspace = useWorkspaceStore((s) => s.resetWorkspace);
  // "Close" discards the loaded design and resets to a fresh one — confirm first.
  const onCloseLoaded = async () => {
    if (await confirm({ message: t('banner.closeConfirm'), confirmLabel: t('common.discard'), danger: true })) {
      resetWorkspace();
    }
  };
  const view = useWorkspaceStore((s) => s.view);
  const info = useWorkspaceStore((s) => s.info);
  const result = useWorkspaceStore((s) => selectActive(s).result);
  const designName = useWorkspaceStore(selectDesignName);
  const simName = useWorkspaceStore((s) => selectActive(s).name);
  const { flight, pathResult } = useResultFlight();
  const { recoveryWeight, recoveryEstimated } = useRecoveryMass();
  const { settings, update } = useSettings();
  const { maxed, toggleMaxed } = useMaximizeCenter();
  useAutoRunOutdated();

  // Header slot the 2D schematic's control buttons (calipers, zoom, export)
  // portal into, so they sit centered in the same row as the view toggle.
  const [ctrlSlot, setCtrlSlot] = useState<HTMLDivElement | null>(null);
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
          <FlightEventsTable sim={result} simName={flight?.name ?? simName} designName={designName} />
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
          <CenterToolbar
            resultName={flight?.name ?? simName}
            onCtrlSlot={setCtrlSlot}
            maxed={maxed}
            onToggleMaxed={toggleMaxed}
          />
          <CenterCanvas flight={flight} pathResult={pathResult} ctrlSlot={ctrlSlot} />
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
          recoveryEstimated={recoveryEstimated}
          expanded={settings.showStats}
          onToggle={() => update({ showStats: !settings.showStats })}
        />
      </div>
    </div>
  );
}
