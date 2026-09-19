import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useWorkspaceStore, selectActive } from './state/store';
import { useWorkspaceEffects } from './state/useWorkspaceEffects';
import { AppHeader } from './components/layout/AppHeader';
import { CenterView } from './components/canvas/CenterView';
import { TreePanel } from './components/design/TreePanel';
import { PropertyPane } from './components/design/PropertyPane';
import { SimulationsPane } from './components/sim/SimulationsPane';
import { SimEditor } from './components/sim/SimEditor';
import { SimSummary } from './components/sim/SimSummary';
import { FlightWarnings } from './components/sim/FlightWarnings';
import { TabBar } from './components/layout/TabBar';
import { WorkInProgressDialog } from './components/layout/WorkInProgressDialog';
import { ConfirmDialog } from './components/common/ConfirmDialog';
import { UpdateToast } from './components/layout/UpdateToast';
import { useIsDesktop } from './components/common/useMediaQuery';
import { PaneSplitter } from './components/layout/PaneSplitter';
import { useSettings } from './state/SettingsProvider';
import {
  CENTER_PANE_MIN,
  SIDE_PANE_DEFAULT,
  SIDE_PANE_MAX,
  SIDE_PANE_MIN,
  TREE_PANE_DEFAULT,
  TREE_PANE_MAX,
  TREE_PANE_MIN,
} from './services/settings';

export default function App() {
  useWorkspaceEffects();
  const { t } = useTranslation();
  const tab = useWorkspaceStore((s) => s.tab);
  const err = useWorkspaceStore((s) => s.err);
  const storageWarning = useWorkspaceStore((s) => s.storageWarning);
  const result = useWorkspaceStore((s) => selectActive(s).result);

  // The center pane backs BOTH the Design and Results tabs, and stays mounted
  // across the switch: the 2D/3D canvases are expensive to build, and remounting
  // one on every tab change would re-run the engine for a design that didn't
  // change. Same reason the sim pane below is hidden rather than unmounted.
  const onCenter = tab === 'design' || tab === 'results';
  // The sim editor lives in exactly one place, and which place depends on the
  // breakpoint (see components/common/useMediaQuery). Everything else here is
  // plain `lg:` classes.
  const desktop = useIsDesktop();

  // Both side columns are user-sized. The committed widths are settings; the
  // `drag*` values hold the in-flight one so a drag repaints at pointer speed
  // without writing localStorage on every move (see PaneSplitter).
  const { settings, update } = useSettings();
  const [dragTree, setDragTree] = useState<number | null>(null);
  const [dragSide, setDragSide] = useState<number | null>(null);
  const treeW = dragTree ?? settings.treePaneWidth;
  const sideW = dragSide ?? settings.sidePaneWidth;
  const treeRef = useRef<HTMLElement>(null);
  // One ref per right column, because which one is mounted depends on the tab.
  const propsRef = useRef<HTMLElement>(null);
  const simEditRef = useRef<HTMLElement>(null);
  const summaryRef = useRef<HTMLElement>(null);

  // The three right columns share ONE width, so the divider is the same control
  // wherever it appears. The left column only exists on Design, so it only
  // reserves room there.
  // `reserve` and the CSS cap are the same rule, said twice: the splitter
  // enforces it during a drag, and CSS enforces it for a width that was stored
  // on a wider window than this one. It counts the PANES; the dividers
  // themselves (5px each) come out of the center's share, so on the narrowest
  // window at the furthest drag the center keeps about 310 rather than exactly
  // CENTER_PANE_MIN.
  const sideReserve = (tab === 'design' ? treeW : 0) + CENTER_PANE_MIN;

  // Maximized: the center pane takes the window and both side columns step
  // aside. Only where the center pane actually IS - on Simulations the flag is
  // ignored, because the toolbar carrying the way back is not on that tab and
  // the simulation editor would be stranded.
  const maxed = settings.maximizeCenter && onCenter;
  const sideStyle = { width: sideW, maxWidth: `calc(100vw - ${sideReserve}px)` };
  const sideSplitter = (paneRef: typeof propsRef) => (
    <PaneSplitter
      side="right"
      paneRef={paneRef}
      width={sideW}
      min={SIDE_PANE_MIN}
      max={SIDE_PANE_MAX}
      reserve={sideReserve}
      fallback={SIDE_PANE_DEFAULT}
      label={t('panes.resizeSide')}
      onDrag={setDragSide}
      onCommit={(w) => {
        setDragSide(null);
        update({ sidePaneWidth: w });
      }}
    />
  );

  return (
    // h-full, not h-screen: the shell follows #root's height, which index.css
    // pins to the DYNAMIC viewport on mobile. `h-screen` would re-assert 100vh
    // here and put the tab bar back under the browser chrome.
    <div className="flex h-full flex-col bg-slate-950 text-slate-100">
      <AppHeader />
      <UpdateToast />

      {/* Two banners, not one. The storage warning outlives the transient error:
          it says the user's work is not being kept, which stays true until a
          save succeeds, while `err` is about the last thing they did. */}
      {storageWarning && (
        <p role="status" className="border-b border-amber-500/30 bg-amber-950/60 px-4 py-2 text-sm text-amber-200">
          {storageWarning}
        </p>
      )}
      {err && <p className="border-b border-red-500/30 bg-red-950/60 px-4 py-2 text-sm text-red-300">{err}</p>}

      {/*
        One row of panes; the TAB decides which of them are in it, so each tab
        gets the column layout it actually wants instead of all three sharing one
        fixed grid. Design is tree · canvas · properties, Simulations is a single
        full-width pane, Results is charts · summary.

        On a phone exactly one pane is ever visible (the side columns are
        desktop-only), so source order is the phone's order and no reordering is
        needed. Panels read the store — no prop-drilling.
      */}
      <main className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
        {/* LEFT — component tree (Design tab; desktop only).

            User-sized, from a 360px default. It was a fixed 300, which left the
            content 252px after two layers of padding: too narrow for + Stage,
            + Add and Scale to share the row above the list, and tight enough
            that a nested part's name truncated to about four characters. Those
            layers are 16px lighter now, but a deep tree still wants more than
            any one default can be right about, hence the splitter below. */}
        <section
          ref={treeRef}
          // The width is a preference, so it is an inline style rather than a
          // class. `maxWidth` is the same cap the splitter applies while
          // dragging, restated in CSS: a width stored on a wide monitor must not
          // crush the center pane when the same browser profile opens on a
          // narrow one.
          style={{ width: treeW, maxWidth: `calc(100vw - ${sideW + CENTER_PANE_MIN}px)` }}
          className={`hidden shrink-0 lg:h-full lg:overflow-y-auto ${tab === 'design' && !maxed ? 'lg:block' : ''}`}
        >
          <TreePanel />
        </section>
        {/* The divider is also the rule between the two panes, which is why the
            column above no longer carries a border-r: two of them would read as
            a groove. Design tab only, since that is the only tab this column is
            on. */}
        {tab === 'design' && !maxed && (
          <PaneSplitter
            paneRef={treeRef}
            width={treeW}
            min={TREE_PANE_MIN}
            max={TREE_PANE_MAX}
            reserve={sideW + CENTER_PANE_MIN}
            fallback={TREE_PANE_DEFAULT}
            label={t('panes.resizeTree')}
            onDrag={setDragTree}
            onCommit={(w) => {
              setDragTree(null);
              update({ treePaneWidth: w });
            }}
          />
        )}

        {/* CENTER — banner + drawing + stability, or the flight charts on Results.
            On mobile the Design half splits again into the Rocket and Sketch
            panes (see CenterView). */}
        <section className={`${onCenter ? 'flex' : 'hidden'} min-h-0 flex-1 flex-col lg:h-full lg:overflow-hidden`}>
          <CenterView />
        </section>

        {/* RIGHT — the selected part's properties (Design tab; desktop only).
            This column is what the tab split bought: the editor used to be
            stacked under the tree in the left one. */}
        {tab === 'design' && !maxed && sideSplitter(propsRef)}
        <section
          ref={propsRef}
          style={sideStyle}
          className={`hidden shrink-0 lg:h-full lg:overflow-y-auto ${tab === 'design' && !maxed ? 'lg:block' : ''}`}
        >
          <PropertyPane />
        </section>

        {/* SIMULATIONS — toolbar + the table of runs. Its own tab, so the table
            gets the full width rather than the 380px column the whole sim panel
            used to be squeezed into. */}
        <section
          className={`${tab === 'sim' ? 'flex' : 'hidden'} min-h-0 flex-1 flex-col lg:h-full lg:overflow-hidden`}
        >
          <SimulationsPane />
        </section>

        {/* RIGHT — the selected simulation's editor (Simulations tab; desktop
            only). On a phone it is inline under the table instead, so a phone
            can still change a motor. */}
        {desktop && tab === 'sim' && (
          <>
            {sideSplitter(simEditRef)}
            <section ref={simEditRef} style={sideStyle} className="shrink-0 overflow-y-auto lg:h-full">
              <SimEditor />
            </section>
          </>
        )}

        {/* RIGHT — the run's numbers, beside the charts they describe (Results
            tab; desktop only — the phone puts them above the charts instead).
            Same width as the other two right columns, because they share the
            one setting: right columns of different widths read as an accident.
            The tiles are a 3-up grid, which is what SIDE_PANE_MIN protects -
            narrower and "Static margin @ rail exit" wraps onto three lines. */}
        {tab === 'results' && !maxed && sideSplitter(summaryRef)}
        <section
          ref={summaryRef}
          style={sideStyle}
          className={`hidden shrink-0 p-3 lg:h-full lg:overflow-y-auto ${tab === 'results' && !maxed ? 'lg:block' : ''}`}
          aria-label={t('tabs.results')}
        >
          <div className="space-y-4">
            {/* Above the numbers: a warning changes how you read them, so it has
                to be seen first. Once, here or on the phone's copy of this block
                in CenterView - never both. A hidden duplicate is still in the
                document, and its text still answers to a search for it. See
                useMediaQuery. */}
            {desktop && <FlightWarnings sim={result} />}
            <SimSummary sim={result} />
          </div>
        </section>
      </main>

      <TabBar />
      <WorkInProgressDialog />
      <ConfirmDialog />
    </div>
  );
}
