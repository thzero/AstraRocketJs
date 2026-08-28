import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useWorkspaceStore } from './state/store';
import { useWorkspaceEffects } from './state/useWorkspaceEffects';
import { AppHeader } from './components/layout/AppHeader';
import { CenterView } from './components/canvas/CenterView';
import { EditorPanel } from './components/design/EditorPanel';
import { SimulationsPanel } from './components/sim/SimulationsPanel';
import { TabBar } from './components/layout/TabBar';

export default function App() {
  useWorkspaceEffects();
  const { t } = useTranslation();
  const tab = useWorkspaceStore((s) => s.tab);
  const err = useWorkspaceStore((s) => s.err);
  // The right (simulations) pane collapses on desktop for more design room; on
  // mobile it's a full tab, so this only gates the lg layout.
  const [simsOpen, setSimsOpen] = useState(true);

  return (
    <div className="flex h-screen flex-col bg-slate-950 text-slate-100">
      <AppHeader />

      {err && <p className="border-b border-red-500/30 bg-red-950/60 px-4 py-2 text-sm text-red-300">{err}</p>}

      {/* Mobile: one full-height pane at a time via the bottom tabs — the pane
          fills the viewport (no page scroll) so the canvas is bounded and its
          stats strip pins as a footer; only the sim form scrolls internally.
          The design editor is desktop-only. lg+: a 3-pane workbench
          (editor · canvas · motor+sim). Panels read the store — no prop-drilling. */}
      <main className={`flex min-h-0 flex-1 flex-col overflow-hidden lg:grid lg:auto-rows-fr ${simsOpen ? 'lg:grid-cols-[340px_minmax(0,1fr)_380px]' : 'lg:grid-cols-[340px_minmax(0,1fr)_2rem]'}`}>
        {/* CENTER — canvas + stability (the sole build-tab pane on mobile) */}
        <section className={`${tab === 'build' ? 'flex' : 'hidden'} min-h-0 flex-1 flex-col order-1 lg:order-none lg:col-start-2 lg:row-start-1 lg:block lg:h-full lg:overflow-hidden`}>
          <CenterView />
        </section>

        {/* LEFT — design editor (desktop only; hidden on mobile) */}
        <section className="hidden order-2 lg:order-none lg:col-start-1 lg:row-start-1 lg:block lg:h-full lg:overflow-y-auto lg:border-r lg:border-white/10">
          <EditorPanel />
        </section>

        {/* RIGHT — simulations (list + active sim's motor / launch / run / results).
            A full-height collapse handle sits on the pane's left edge (desktop
            only) — its own control, separate from the simulations list. */}
        <div className={`${tab === 'sim' ? 'flex' : 'hidden'} min-h-0 flex-1 order-3 lg:order-none lg:col-start-3 lg:row-start-1 lg:flex lg:h-full lg:border-l lg:border-white/10`}>
          <button
            onClick={() => setSimsOpen((o) => !o)}
            title={simsOpen ? t('sims.hide') : t('sims.show')}
            aria-label={simsOpen ? t('sims.hide') : t('sims.show')}
            className="hidden w-8 shrink-0 items-center justify-center text-slate-400 hover:bg-slate-800 hover:text-sky-300 lg:flex lg:border-r lg:border-white/10"
          >
            <span className="text-2xl leading-none">{simsOpen ? '›' : '‹'}</span>
          </button>
          <div className={`min-w-0 flex-1 overflow-y-auto lg:h-full ${simsOpen ? '' : 'lg:hidden'}`}>
            <SimulationsPanel />
          </div>
        </div>
      </main>

      <TabBar />
    </div>
  );
}
