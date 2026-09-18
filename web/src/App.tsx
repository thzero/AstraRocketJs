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
import { WorkbenchTabs } from './components/layout/WorkbenchTabs';
import { WorkInProgressDialog } from './components/layout/WorkInProgressDialog';
import { ConfirmDialog } from './components/common/ConfirmDialog';
import { UpdateToast } from './components/layout/UpdateToast';
import { useIsDesktop } from './components/common/useMediaQuery';

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

  return (
    // h-full, not h-screen: the shell follows #root's height, which index.css
    // pins to the DYNAMIC viewport on mobile. `h-screen` would re-assert 100vh
    // here and put the tab bar back under the browser chrome.
    <div className="flex h-full flex-col bg-slate-950 text-slate-100">
      <AppHeader />
      <UpdateToast />
      <WorkbenchTabs />

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
        {/* LEFT — component tree (Design tab; desktop only) */}
        <section
          className={`hidden w-[300px] shrink-0 border-r border-white/10 lg:h-full lg:overflow-y-auto ${tab === 'design' ? 'lg:block' : ''}`}
        >
          <TreePanel />
        </section>

        {/* CENTER — banner + drawing + stability, or the flight charts on Results.
            On mobile the Design half splits again into the Rocket and Sketch
            panes (see CenterView). */}
        <section className={`${onCenter ? 'flex' : 'hidden'} min-h-0 flex-1 flex-col lg:h-full lg:overflow-hidden`}>
          <CenterView />
        </section>

        {/* RIGHT — the selected part's properties (Design tab; desktop only).
            This column is what the tab split bought: the editor used to be
            stacked under the tree in the left one. */}
        <section
          className={`hidden w-[380px] shrink-0 border-l border-white/10 lg:h-full lg:overflow-y-auto ${tab === 'design' ? 'lg:block' : ''}`}
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
          <section className="w-[380px] shrink-0 overflow-y-auto border-l border-white/10 lg:h-full">
            <SimEditor />
          </section>
        )}

        {/* RIGHT — the run's numbers, beside the charts they describe (Results
            tab; desktop only — the phone puts them above the charts instead).
            Same width as the other two right columns: the tiles are a 3-up grid
            and a narrower one wraps "Static margin @ rail exit" onto three
            lines, and right columns of different widths read as an accident. */}
        <section
          className={`hidden w-[380px] shrink-0 border-l border-white/10 p-3 lg:h-full lg:overflow-y-auto ${tab === 'results' ? 'lg:block' : ''}`}
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
