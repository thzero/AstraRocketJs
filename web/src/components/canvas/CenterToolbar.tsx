import { useTranslation } from 'react-i18next';
import { useWorkspaceStore, selectActive, selectOutdated } from '../../state/store';
import { ResultPicker } from '../sim/ResultPicker';
import { ViewToggle } from './ViewToggle';
import { ViewBtn } from './ViewBtn';
import { useViewPrefs } from './useViewPrefs';

/**
 * The center pane's header row: the result heading, the 2D presets, the
 * CG/CP · Info · ruler toggles, the slot the 2D schematic portals its controls
 * into, the view toggle and the maximize button.
 */
export function CenterToolbar({
  resultName,
  onCtrlSlot,
  maxed,
  onToggleMaxed,
}: {
  /** The shown flight's simulation name, for the Results heading. */
  resultName: string;
  /** Ref callback for the center slot the 2D schematic portals into. */
  onCtrlSlot: (el: HTMLDivElement | null) => void;
  maxed: boolean;
  onToggleMaxed: () => void;
}) {
  const { t } = useTranslation();
  const tab = useWorkspaceStore((s) => s.tab);
  const view = useWorkspaceStore((s) => s.view);
  const onView = useWorkspaceStore((s) => s.setView);
  const twoD = useWorkspaceStore((s) => s.twoD);
  const onTwoD = useWorkspaceStore((s) => s.setTwoD);
  const onResetView = useWorkspaceStore((s) => s.resetView);
  const result = useWorkspaceStore((s) => selectActive(s).result);
  const outdated = useWorkspaceStore((s) => selectOutdated(s));
  const { showMarkers, showInfoCard, rulers, toggleMarkers, toggleInfoCard, toggleRulerSide } = useViewPrefs();

  return (
    // Wraps for the same reason the app header does: the presets, the
    // portalled canvas controls and the view toggle do not fit a phone's
    // width in one row, and an unwrapped row scrolls the whole page
    // sideways.
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
            <ResultPicker fallbackName={resultName} />
            {outdated && result && (
              <span className="rounded-md bg-warn-500/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-warn-300 ring-1 ring-warn-400/30">
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
                <span className="pl-1 text-xs font-medium text-ink-muted">{t('view.rulers')}</span>
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
      <div ref={onCtrlSlot} className="flex items-center gap-1" />
      {/* ml-auto keeps it hard right even when it wraps onto a line of its
      own, where justify-between has nothing to push against. */}
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <ViewToggle view={view} onChange={onView} family={tab === 'results' ? 'result' : 'design'} />
        {/* Desktop only: there are no side columns below lg for it to
            reclaim, so the button would be a no-op there. */}
        <span className="hidden lg:block">
          <ViewBtn
            active={maxed}
            onClick={onToggleMaxed}
            title={maxed ? t('panes.restore') : t('panes.maximize')}
            label={maxed ? t('panes.restore') : t('panes.maximize')}
          >
            <span aria-hidden>{maxed ? '⤡' : '⤢'}</span>
          </ViewBtn>
        </span>
      </div>
    </div>
  );
}
