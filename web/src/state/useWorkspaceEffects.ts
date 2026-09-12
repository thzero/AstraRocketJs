import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useWorkspaceStore, selectActive } from './store';
import { getWorkspaceStore } from '../services/workspaceStore';
import { onStorageDegraded } from '../services/idbKeyValueStore';
import { requestPersistentStorage } from '../services/persistStorage';
import { computeStaticInfo } from '../services/buildRocket';
import { warmSimWorker } from '../engine/simClient';
import { appName } from '../services/appInfo';

/**
 * The React-side effects for the workspace store: keep the browser title in sync,
 * hydrate + autosave to browser storage, and rebuild the engine (recomputing
 * stability) whenever the design or its motors change. Mounted once, in App.
 */
export function useWorkspaceEffects() {
  const { t, i18n } = useTranslation();
  useEffect(() => {
    document.title = appName();
  }, [i18n.language]);

  // Spawn + warm the sim worker (loads its own engine off-thread) so the first
  // "Run" isn't delayed by the worker's compile. Best-effort; sims fall back to
  // spawning it lazily if this is skipped.
  useEffect(() => {
    warmSimWorker();
  }, []);

  // Restore the saved workspace once, then autosave (debounced) on change.
  // `ready` (state) gates the rebuild effect so it fires ONCE, after hydration —
  // otherwise it builds the default rocket + drag sweep, then hydrate swaps in
  // the real design and it builds again (two full engine builds on every load).
  const hydrated = useRef(false);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let live = true;
    getWorkspaceStore()
      .load()
      .then((w) => {
        if (live && w) useWorkspaceStore.getState().hydrate(w);
        hydrated.current = true;
        setReady(true);
      });
    return () => {
      live = false;
    };
  }, []);

  const tree = useWorkspaceStore((s) => s.tree);
  const sims = useWorkspaceStore((s) => s.sims);
  const activeId = useWorkspaceStore((s) => s.activeId);
  const extraMotors = useWorkspaceStore((s) => s.extraMotors);
  const loadedMeta = useWorkspaceStore((s) => s.loadedMeta);
  const motor = useWorkspaceStore((s) => selectActive(s).motor);
  const ignitionEvent = useWorkspaceStore((s) => selectActive(s).ignitionEvent);
  const ignitionDelay = useWorkspaceStore((s) => selectActive(s).ignitionDelay);

  useEffect(() => {
    if (!hydrated.current) return;
    const id = setTimeout(() => {
      getWorkspaceStore()
        .save({ version: 1, tree, sims, activeId, extraMotors, loadedMeta })
        // There is now a design worth keeping, so ask the browser not to evict
        // this origin under disk pressure. Once per session, best-effort.
        .then(() => void requestPersistentStorage())
        .catch(() => useWorkspaceStore.getState().setErr(t('storage.full')));
    }, 500);
    return () => clearTimeout(id);
  }, [t, tree, sims, activeId, extraMotors, loadedMeta]);

  // IndexedDB blocked (policy, some private modes) means we are back on the 5 MB
  // localStorage cap this move existed to escape. Say so NOW rather than letting
  // the user meet it later as an unexplained failed save mid-design.
  useEffect(() => onStorageDegraded(() => useWorkspaceStore.getState().setErr(t('storage.degraded'))), [t]);

  // Flush any change the 500ms debounce hasn't persisted yet on page unload —
  // otherwise opening a .ork and refreshing quickly would lose it.
  //
  // The store is IndexedDB-backed and an async write CANNOT finish while the
  // page tears down, so this takes the store's synchronous path (a localStorage
  // journal the next load folds back in). `visibilitychange` gets the ordinary
  // async save too: on mobile, hidden is often the last event before the tab is
  // discarded outright, and there it still has time to complete.
  useEffect(() => {
    const snapshot = () => {
      const s = useWorkspaceStore.getState();
      return {
        version: 1 as const,
        tree: s.tree,
        sims: s.sims,
        activeId: s.activeId,
        extraMotors: s.extraMotors,
        loadedMeta: s.loadedMeta,
      };
    };
    const flush = () => {
      if (!hydrated.current) return;
      const store = getWorkspaceStore();
      if (store.saveSync) store.saveSync(snapshot());
      else store.save(snapshot()).catch(() => {}); // unloading — nothing to surface
    };
    const onHidden = () => {
      if (!hydrated.current || document.visibilityState !== 'hidden') return;
      getWorkspaceStore()
        .save(snapshot())
        .catch(() => {});
      flush();
    };
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('beforeunload', flush);
      document.removeEventListener('visibilitychange', onHidden);
    };
  }, []);

  // Rebuild + recompute static info whenever the design or motors change. The
  // primary mount takes the active sim's `motor`; other mounts take their imports.
  useEffect(() => {
    if (!ready) return; // wait for hydration so we build the real design once, not the default first
    const store = useWorkspaceStore.getState();
    const res = computeStaticInfo(tree, motor, extraMotors, { event: ignitionEvent, delay: ignitionDelay });
    if ('error' in res) {
      store.applyBuild(null, null);
      store.setErr(res.error);
    } else {
      store.applyBuild(res.info, res.rocket);
      store.setErr(null);
    }
  }, [ready, tree, motor, extraMotors, ignitionEvent, ignitionDelay]);

  // Editing the design invalidates every simulation's cached result.
  useEffect(() => {
    useWorkspaceStore.getState().invalidateResults();
  }, [tree]);
}
