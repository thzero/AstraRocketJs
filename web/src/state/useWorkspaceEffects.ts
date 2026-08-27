import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useWorkspaceStore, selectActive } from './store';
import { getWorkspaceStore } from '../services/workspaceStore';
import { buildRocketTree } from '../engine/api';
import { findMountId, findNode } from '../services/treeEdit';
import { appName } from '../services/appInfo';

/**
 * The React-side effects for the workspace store: keep the browser title in sync,
 * hydrate + autosave to localStorage, and rebuild the engine (recomputing
 * stability) whenever the design or its motors change. Mounted once, in App.
 */
export function useWorkspaceEffects() {
  const { i18n } = useTranslation();
  useEffect(() => { document.title = appName(); }, [i18n.language]);

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

  // Rebuild + recompute static info whenever the design or motors change. The
  // primary mount takes the active sim's `motor`; other mounts take their imports.
  useEffect(() => {
    try {
      const mountId = findMountId(tree);
      const r = buildRocketTree(tree, motor, mountId);
      for (const [id, m] of Object.entries(extraMotors)) {
        if (id === mountId || !findNode(tree, id)) continue; // gone or already the primary
        r.setMotorById(id, m.spec);
        if (m.ignitionEvent) r.setMotorIgnitionById(id, m.ignitionEvent, m.ignitionDelay ?? 0);
      }
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
