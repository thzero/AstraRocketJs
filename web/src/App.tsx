import { useWorkspace } from './state/useWorkspace';
import { AppHeader } from './components/layout/AppHeader';
import { CenterView } from './components/canvas/CenterView';
import { EditorPanel } from './components/design/EditorPanel';
import { SimulationsPanel } from './components/sim/SimulationsPanel';
import { TabBar } from './components/layout/TabBar';

export default function App() {
  const w = useWorkspace();

  return (
    <div className="flex h-screen flex-col bg-slate-950 text-slate-100">
      <AppHeader canSave={!!w.info} onNew={w.newWorkspace} onOpenFile={w.openOrkFile} onSave={w.saveOrk} />

      {w.err && <p className="border-b border-red-500/30 bg-red-950/60 px-4 py-2 text-sm text-red-300">{w.err}</p>}

      {/* Mobile: one section at a time via the bottom tabs. lg+: a 3-pane
          workbench (editor · canvas · motor+sim), each pane scrolling on its own. */}
      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-24 lg:grid lg:grid-cols-[340px_minmax(0,1fr)_380px] lg:overflow-hidden lg:pb-0">
        {/* CENTER — canvas + stability (first on mobile) */}
        <section className={`${w.tab === 'build' ? '' : 'hidden'} order-1 lg:order-none lg:col-start-2 lg:row-start-1 lg:block lg:h-full lg:overflow-y-auto`}>
          <CenterView
            loadedMeta={w.loadedMeta} onCloseLoaded={w.resetWorkspace}
            view={w.view} onView={w.setView} twoD={w.twoD} onTwoD={w.setTwoD}
            roll={w.roll} onRollValue={w.setRoll} onRollBy={w.rollBy} onResetView={w.resetView} resetKey={w.resetKey}
            tree={w.tree} info={w.info} motors={w.motorsForView} selectedId={w.selectedId} onSelect={w.setSelectedId}
            result={w.active.result}
          />
        </section>

        {/* LEFT — design editor */}
        <section className={`${w.tab === 'build' ? '' : 'hidden'} order-2 lg:order-none lg:col-start-1 lg:row-start-1 lg:block lg:h-full lg:overflow-y-auto lg:border-r lg:border-white/10`}>
          <EditorPanel
            tree={w.tree} selectedId={w.selectedId} onSelect={w.setSelectedId} onAdd={w.addPartToTree}
            onRenameDesign={w.renameDesign}
            node={w.selectedNode} onChange={w.patchSelected} onRemove={w.removeSelected} onMove={w.moveSelected}
            canMoveUp={!!w.sib && w.sib.index > 0} canMoveDown={!!w.sib && w.sib.index < w.sib.count - 1}
          />
        </section>

        {/* RIGHT — simulations (list + active sim's motor / launch / run / results) */}
        <div className={`${w.tab === 'sim' ? '' : 'hidden'} order-3 lg:order-none lg:col-start-3 lg:row-start-1 lg:block lg:h-full lg:overflow-y-auto lg:border-l lg:border-white/10`}>
          <SimulationsPanel
            sims={w.sims} activeId={w.active.id} motor={w.motor} launch={w.launch} runLabel={w.active.name}
            result={w.active.result} info={w.info} busy={w.simBusy}
            onSelectSim={w.setActiveId} onAddSim={w.addSim} onDeleteSim={w.deleteSim} onRenameSim={w.renameSim}
            onMotorChange={w.setActiveMotor} onLaunchChange={w.patchLaunch} onRun={w.runSim} onError={w.setErr}
          />
        </div>
      </main>

      <TabBar tab={w.tab} onTab={w.setTab} />
    </div>
  );
}
