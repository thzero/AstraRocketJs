import { useWorkspaceStore } from './state/store';
import { useWorkspaceEffects } from './state/useWorkspaceEffects';
import { AppHeader } from './components/layout/AppHeader';
import { CenterView } from './components/canvas/CenterView';
import { EditorPanel } from './components/design/EditorPanel';
import { SimulationsPanel } from './components/sim/SimulationsPanel';
import { TabBar } from './components/layout/TabBar';

export default function App() {
  useWorkspaceEffects();
  const tab = useWorkspaceStore((s) => s.tab);
  const err = useWorkspaceStore((s) => s.err);

  return (
    <div className="flex h-screen flex-col bg-slate-950 text-slate-100">
      <AppHeader />

      {err && <p className="border-b border-red-500/30 bg-red-950/60 px-4 py-2 text-sm text-red-300">{err}</p>}

      {/* Mobile: one section at a time via the bottom tabs. lg+: a 3-pane
          workbench (editor · canvas · motor+sim), each pane scrolling on its own.
          Panels read the workspace store directly — no prop-drilling. */}
      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-24 lg:grid lg:grid-cols-[340px_minmax(0,1fr)_380px] lg:overflow-hidden lg:pb-0">
        {/* CENTER — canvas + stability (first on mobile) */}
        <section className={`${tab === 'build' ? '' : 'hidden'} order-1 lg:order-none lg:col-start-2 lg:row-start-1 lg:block lg:h-full lg:overflow-y-auto`}>
          <CenterView />
        </section>

        {/* LEFT — design editor */}
        <section className={`${tab === 'build' ? '' : 'hidden'} order-2 lg:order-none lg:col-start-1 lg:row-start-1 lg:block lg:h-full lg:overflow-y-auto lg:border-r lg:border-white/10`}>
          <EditorPanel />
        </section>

        {/* RIGHT — simulations (list + active sim's motor / launch / run / results) */}
        <div className={`${tab === 'sim' ? '' : 'hidden'} order-3 lg:order-none lg:col-start-3 lg:row-start-1 lg:block lg:h-full lg:overflow-y-auto lg:border-l lg:border-white/10`}>
          <SimulationsPanel />
        </div>
      </main>

      <TabBar />
    </div>
  );
}
