import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useWorkspaceStore, selectActive } from './store';
import { getWorkspaceStore } from '../services/workspaceStore';
import { buildConfiguredRocket } from '../services/buildRocket';
import { warmSimWorker } from '../engine/simClient';
import { appName } from '../services/appInfo';

/**
 * The React-side effects for the workspace store: keep the browser title in sync,
 * hydrate + autosave to localStorage, and rebuild the engine (recomputing
 * stability) whenever the design or its motors change. Mounted once, in App.
 */
export function useWorkspaceEffects() {
  const { i18n } = useTranslation();
  useEffect(() => { document.title = appName(); }, [i18n.language]);

  // Spawn + warm the sim worker (loads its own engine off-thread) so the first
  // "Run" isn't delayed by the worker's compile. Best-effort; sims fall back to
  // spawning it lazily if this is skipped.
  useEffect(() => { warmSimWorker(); }, []);

  // Restore the saved workspace once, then autosave (debounced) on change.
  const hydrated = useRef(false);
  useEffect(() => {
    let live = true;
    getWorkspaceStore().load().then((w) => {
      if (live && w) useWorkspaceStore.getState().hydrate(w);
      hydrated.current = true;
    });
    return () => { live = false; };
  }, []);

  const tree = useWorkspaceStore((s) => s.tree);
  const sims = useWorkspaceStore((s) => s.sims);
  const activeId = useWorkspaceStore((s) => s.activeId);
  const extraMotors = useWorkspaceStore((s) => s.extraMotors);
  const loadedMeta = useWorkspaceStore((s) => s.loadedMeta);
  const motor = useWorkspaceStore((s) => selectActive(s).motor);

  useEffect(() => {
    if (!hydrated.current) return;
    const id = setTimeout(() => {
      getWorkspaceStore().save({ version: 1, tree, sims, activeId, extraMotors, loadedMeta });
    }, 500);
    return () => clearTimeout(id);
  }, [tree, sims, activeId, extraMotors, loadedMeta]);

  // Flush any change the 500ms debounce hasn't persisted yet on page unload —
  // otherwise opening a .ork and refreshing quickly would lose it. localStorage
  // writes run synchronously, so this completes before the page tears down.
  useEffect(() => {
    const flush = () => {
      if (!hydrated.current) return;
      const s = useWorkspaceStore.getState();
      getWorkspaceStore().save({ version: 1, tree: s.tree, sims: s.sims, activeId: s.activeId, extraMotors: s.extraMotors, loadedMeta: s.loadedMeta });
    };
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('beforeunload', flush);
    };
  }, []);

  // Rebuild + recompute static info whenever the design or motors change. The
  // primary mount takes the active sim's `motor`; other mounts take their imports.
  useEffect(() => {
    try {
      const r = buildConfiguredRocket(tree, motor, extraMotors);
      useWorkspaceStore.getState().applyBuild(r.staticInfo(), r);
      useWorkspaceStore.getState().setErr(null);
    } catch (e) {
      useWorkspaceStore.getState().applyBuild(null, null);
      useWorkspaceStore.getState().setErr(e instanceof Error ? e.message : String(e));
    }
  }, [tree, motor, extraMotors]);

  // Editing the design invalidates every simulation's cached result.
  useEffect(() => { useWorkspaceStore.getState().invalidateResults(); }, [tree]);
}
