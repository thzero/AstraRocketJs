import { useEffect, useRef, useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import i18nGlobal from '../i18n';
import { useWorkspaceStore, selectActive, selectExtraMotors } from './store';
import { getWorkspaceStore } from '../services/workspaceStore';
import { onStorageDegraded } from '../services/idbKeyValueStore';
import { requestPersistentStorage } from '../services/persistStorage';
import { computeStaticInfo, flightKey } from '../services/buildRocket';
import { warmSimWorker } from '../engine/simClient';
import { appName } from '../services/appInfo';

/**
 * The React-side effects for the workspace store: keep the browser title in sync,
 * hydrate + autosave to browser storage, and rebuild the engine (recomputing
 * stability) whenever the design or its motors change. Mounted once, in App.
 */
export function useWorkspaceEffects() {
  // `i18n`, never `t`: `t` gets a NEW IDENTITY on every language change, and
  // every effect below that listed it in its deps therefore re-ran on a
  // language switch. For the hydration effect that meant re-reading and
  // re-hydrating the workspace — and `hydrate` runs `sanitizeSims`, which nulls
  // every sim result, so changing language silently threw away every flight the
  // user had run (and could re-hydrate a stale design over a fresh import).
  // The MODULE singleton (`i18nGlobal`, as store.ts already uses) rather than
  // the hook's — react-i18next hands back a fresh binding on a language change,
  // so depending on it reintroduces the same re-run. `i18nGlobal.t(...)` reads
  // the current language at call time, so the message is still translated
  // without the effect being language-sensitive at all.
  //
  // `useTranslation()` stays only as the re-render subscription the title
  // effect below needs.
  const { i18n } = useTranslation();
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
  /**
   * Skip the autosave that a hydrate would otherwise trigger.
   *
   * `hydrate()` replaces tree/sims/extraMotors, which re-runs the autosave
   * effect below and schedules a write of the bytes just read — and
   * `DesignLibrary.write` stamps `updatedAt: Date.now()`. So merely OPENING the
   * app re-stamped the design, and the library's "most recently updated" order
   * silently meant "most recently opened": a design you only looked at jumped
   * above one you actually edited last week.
   */
  const skipNextSave = useRef(false);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let live = true;
    getWorkspaceStore()
      .load()
      .then((w) => {
        // Both writes belong INSIDE the guard. With them outside, StrictMode's
        // canceled first load still flipped `ready` while the tree was still
        // the default, so the rebuild effect built the default rocket and the
        // second load then built again — the exact double build the `ready`
        // gate exists to prevent.
        if (!live) return;
        if (w) {
          skipNextSave.current = true;
          useWorkspaceStore.getState().hydrate(w);
        }
        hydrated.current = true;
        setReady(true);
      })
      // Without this, a rejected load left `hydrated` and `ready` false FOREVER:
      // no autosave, no unload flush, no engine rebuild, `info` null — the app
      // sitting there with no stats and no stability badge, saving nothing, and
      // nothing on screen to say so. Degrade to a fresh workspace that still
      // saves, and tell the user their previous work could not be read.
      //
      // The STORAGE WARNING slot, not `setErr`: opening the gate immediately
      // runs the rebuild effect below, whose success path calls `setErr(null)`
      // — so an error written here was wiped before it could ever be read. The
      // warning banner survives until a save succeeds, which is exactly when
      // this message stops being true.
      .catch(() => {
        if (!live) return;
        hydrated.current = true;
        setReady(true);
        useWorkspaceStore.getState().setStorageWarning(i18nGlobal.t('storage.loadFailed'), 'loadFailed');
      });
    return () => {
      live = false;
    };
  }, []);

  const tree = useWorkspaceStore((s) => s.tree);
  const sims = useWorkspaceStore((s) => s.sims);
  const activeId = useWorkspaceStore((s) => s.activeId);
  const extraMotors = useWorkspaceStore(selectExtraMotors);
  const loadedMeta = useWorkspaceStore((s) => s.loadedMeta);
  const motor = useWorkspaceStore((s) => selectActive(s).motor);

  useEffect(() => {
    if (!hydrated.current) return;
    if (skipNextSave.current) {
      // The state this effect is reacting to IS what was just loaded. Writing it
      // back changes nothing but the timestamp. A real edit clears the flag by
      // being the next thing to run.
      skipNextSave.current = false;
      return;
    }
    const id = setTimeout(() => {
      getWorkspaceStore()
        .save({ version: 1, tree, sims, activeId, loadedMeta })
        // There is now a design worth keeping, so ask the browser not to evict
        // this origin under disk pressure. Once per session, best-effort.
        // A successful save retires a "storage full" warning and nothing else:
        // the IndexedDB-degraded and load-failed messages are facts about this
        // session that a later write does not undo (see clearSaveWarning).
        .then(() => {
          useWorkspaceStore.getState().clearSaveWarning();
          void requestPersistentStorage();
        })
        .catch(() => useWorkspaceStore.getState().setStorageWarning(i18nGlobal.t('storage.full'), 'full'));
    }, 500);
    return () => clearTimeout(id);
  }, [tree, sims, activeId, loadedMeta]);

  // IndexedDB blocked (policy, some private modes) means we are back on the 5 MB
  // localStorage cap this move existed to escape. Say so NOW rather than letting
  // the user meet it later as an unexplained failed save mid-design.
  useEffect(
    () =>
      onStorageDegraded(() =>
        useWorkspaceStore.getState().setStorageWarning(i18nGlobal.t('storage.degraded'), 'degraded'),
      ),
    [],
  );

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
  //
  // Keyed on `tree.components`, NOT on `tree`: every store action replaces the
  // tree object, so keying on it rebuilt the engine and re-ran the aero sweep for
  // a designer/comment/revision edit that cannot move a single number. Component
  // names DO stay in this key — the engine labels its per-component rows with
  // them, so a rename has to reach the engine.
  const components = tree.components;
  useEffect(() => {
    if (!ready) return; // wait for hydration so we build the real design once, not the default first
    const store = useWorkspaceStore.getState();
    // Read the tree from the store rather than closing over it, so the effect
    // does not have to depend on the whole object to use it.
    // Ignition read from the STORE, not closed over, so it need not be a
    // dependency. Ignition timing cannot move mass, CG, CP, static margin or
    // Cd - staticInfo() and aeroSweep() are geometry plus loaded-motor
    // properties - but it was in the deps, and the delay field is a raw number
    // input with a per-keystroke onChange. Typing "1.25" ran four complete
    // buildConfiguredRocket + staticInfo + aeroSweep cycles on the main thread
    // for four identical results. The handle still carries the current
    // override because it is read here at build time.
    const active = selectActive(store);
    const res = computeStaticInfo(store.tree, motor, extraMotors, {
      event: active.ignitionEvent,
      delay: active.ignitionDelay,
    });
    if ('error' in res) {
      store.applyBuild(null, null);
      store.setErr(res.error);
    } else {
      store.applyBuild(res.info, res.rocket);
      store.setErr(null);
    }
  }, [ready, components, motor, extraMotors]);

  // Editing the design invalidates every simulation's cached result.
  //
  // Keyed on what can change a FLIGHT, which is narrower still: a part rename
  // has to reach the engine (above) but must not throw away results that are
  // still perfectly valid for the geometry they were flown on.
  // JSON.stringify of the whole component tree. In the hook body it ran on
  // EVERY render, including ones caused by tab, err and storageWarning — none
  // of which can change it.
  const flight = useMemo(() => flightKey(tree), [tree]);
  // The key this effect last acted on. Needed because RESTORING a design is
  // not editing it: on mount `flight` is the DEFAULT rocket's key, `hydrate()`
  // then swaps in the saved design, the key changes, and this fired - marking
  // every result the user had already run as stale. With
  // `simulation.autoRunOutdated` on and a result view open, CenterView then
  // immediately re-flew them. The rebuild effect above already waits for
  // `ready`; this one did not.
  //
  // And not only on boot. File > Open (`openDesign`) hydrates AGAIN, with a
  // library design whose saved results are current, and its key differs from
  // the design it replaces - so a baseline seeded once, at boot, read that as
  // an edit and aged every restored flight. `hydrationGen` moves with every
  // hydrate; a change in it re-seeds the baseline instead of marking outdated.
  // Both land in the same store write, so this runs once per hydrate.
  const hydrationGen = useWorkspaceStore((s) => s.hydrationGen);
  const lastFlight = useRef<string | null>(null);
  const lastHydration = useRef<number | null>(null);
  useEffect(() => {
    if (!ready) return; // pre-hydration keys describe the default rocket
    if (lastFlight.current === null || lastHydration.current !== hydrationGen) {
      lastFlight.current = flight; // a hydrate sets the baseline; it is not an edit
      lastHydration.current = hydrationGen;
      return;
    }
    if (lastFlight.current === flight) return;
    lastFlight.current = flight;
    useWorkspaceStore.getState().markOutdated();
  }, [ready, flight, hydrationGen]);
}
