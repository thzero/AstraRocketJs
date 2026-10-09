import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18nGlobal from '../i18n';
import { useWorkspaceStore, selectConfig, saveFailure, workspaceSnapshot } from './store';
import type { RocketTree } from '../engine/openRocketEngine';

import { useEngineStore } from './engineStore';
import { getWorkspaceStore } from '../services/storage/workspaceStore';
import { onStorageDegraded } from '../services/storage/idbKeyValueStore';
import { requestPersistentStorage } from '../services/storage/persistStorage';
import { computeStaticInfo, buildKey } from '../services/design/buildRocket';
import { designBlockerText } from '../services/flight/runnability';
import { useSettings } from './SettingsProvider';
import { warmSimWorker } from '../engine/simClient';
import { appName } from '../services/app/appInfo';

/**
 * How long the design must sit still before the engine rebuilds it. Long enough
 * to span the gap between keystrokes or slider events, short enough that the
 * figures follow a pause without a visible wait.
 */
export const REBUILD_DEBOUNCE_MS = 150;

/**
 * The React-side effects for the workspace store: keep the browser title in sync,
 * hydrate + autosave to browser storage, and rebuild the engine (recomputing
 * stability) whenever the design or its motors change. Mounted once, in App.
 */
export function useWorkspaceEffects() {
  // `i18n`, never `t`: `t` gets a new identity on every language change, and
  // any effect below that listed it in its deps would re-run on a language
  // switch. For the hydration effect that would mean re-reading and
  // re-hydrating the workspace, which can hydrate a stale design over a fresh
  // import.
  // The module singleton (`i18nGlobal`, as store.ts uses) rather than the
  // hook's: react-i18next hands back a fresh binding on a language change,
  // so depending on it causes the same re-run. `i18nGlobal.t(...)` reads
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
  // `ready` (state) gates the rebuild effect so it fires once, after hydration;
  // otherwise it builds the default rocket + drag sweep, then hydrate swaps in
  // the real design and it builds again (two full engine builds on every load).
  const hydrated = useRef(false);
  /**
   * The store's `quietReplace` as the autosave effect last saw it. A swap that
   * bumps it (a load, or New) re-runs the effect below, which takes the change
   * as the signal to skip the write that swap would otherwise schedule:
   * `DesignLibrary.write` stamps `updatedAt`, so writing a design straight back
   * re-stamps one that was only opened.
   */
  const seenQuiet = useRef(useWorkspaceStore.getState().quietReplace);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let live = true;
    getWorkspaceStore()
      .load()
      .then((w) => {
        // Both writes belong inside the guard. Outside it, StrictMode's
        // canceled first load would flip `ready` while the tree was still
        // the default, so the rebuild effect would build the default rocket and
        // the second load build again: the double build the `ready` gate
        // exists to prevent.
        if (!live) return;
        if (w) useWorkspaceStore.getState().hydrate(w);
        hydrated.current = true;
        setReady(true);
      })
      // Without this, a rejected load would leave `hydrated` and `ready` false
      // forever: no autosave, no unload flush, no engine rebuild, `info` null,
      // the app sitting there with no stats and no stability badge, saving
      // nothing, and nothing on screen to say so. Degrade to a fresh workspace
      // that still saves, and tell the user their previous work could not be read.
      //
      // The storage warning slot, not `setErr`: an action error is cleared by
      // the first edit, and this message stays true until a save succeeds,
      // which is when the warning banner retires.
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
  const configs = useWorkspaceStore((s) => s.configs);
  const loadedMeta = useWorkspaceStore((s) => s.loadedMeta);
  const quietReplace = useWorkspaceStore((s) => s.quietReplace);
  // Every configuration input the engine build reads: the seated motors with
  // their ignition, and the grounded stages (see buildRocket.buildKey). A
  // string, because zustand v5 compares a selector's result by identity and
  // this is derived per call.
  //
  // A key without `grounded` would not rebuild when a booster is grounded: the
  // worker would fly the sustainer while `info` still described the whole stack.
  const buildInputs = useWorkspaceStore((s) => buildKey(s.tree, selectConfig(s)));
  // The rebuild effect below is the app's one engine caller on the main thread,
  // so it is where "the kernel is not up yet" is handled.
  const enginePhase = useEngineStore((s) => s.phase);

  useEffect(() => {
    if (seenQuiet.current !== quietReplace) {
      // The state this effect is reacting to is what was just loaded, or a blank
      // design nobody has touched. Writing it back changes nothing but the
      // timestamp. A real edit is saved by being the next thing to run.
      seenQuiet.current = quietReplace;
      return;
    }
    if (!hydrated.current) return;
    const id = setTimeout(() => {
      getWorkspaceStore()
        .save(workspaceSnapshot({ tree, sims, configs, activeId, loadedMeta }))
        // There is now a design worth keeping, so ask the browser not to evict
        // this origin under disk pressure. Once per session, best-effort.
        // A successful save retires a "storage full" warning and nothing else:
        // the IndexedDB-degraded and load-failed messages are facts about this
        // session that a later write does not undo (see clearSaveWarning).
        .then(() => {
          useWorkspaceStore.getState().clearSaveWarning();
          // The header's save status reads this. It is the only thing that
          // reports a save, since the File menu has no Save item, so it is
          // set here, where a write actually landed, rather than anywhere that
          // merely asked for one.
          useWorkspaceStore.getState().markSaved();
          void requestPersistentStorage();
        })
        .catch((e: unknown) => {
          const { msg, kind } = saveFailure(e);
          useWorkspaceStore.getState().setStorageWarning(msg, kind);
        });
    }, 500);
    return () => clearTimeout(id);
  }, [tree, sims, configs, activeId, loadedMeta, quietReplace]);

  // IndexedDB blocked (policy, some private modes) means we are back on the 5 MB
  // localStorage cap. Say so now rather than letting
  // the user meet it later as an unexplained failed save mid-design.
  useEffect(
    () =>
      onStorageDegraded(() =>
        useWorkspaceStore.getState().setStorageWarning(i18nGlobal.t('storage.degraded'), 'degraded'),
      ),
    [],
  );

  // Flush any change the 500ms debounce hasn't persisted yet on page unload;
  // otherwise opening a .ork and refreshing quickly would lose it.
  //
  // The store is IndexedDB-backed and an async write cannot finish while the
  // page tears down, so this takes the store's synchronous path (a localStorage
  // journal the next load folds back in). `visibilitychange` gets the ordinary
  // async save too: on mobile, hidden is often the last event before the tab is
  // discarded outright, and there it still has time to complete.
  useEffect(() => {
    const snapshot = () => workspaceSnapshot(useWorkspaceStore.getState());
    const flush = () => {
      if (!hydrated.current) return;
      const store = getWorkspaceStore();
      if (store.saveSync) store.saveSync(snapshot());
      else store.save(snapshot()).catch(() => {}); // unloading; nothing to surface
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
  // motors come from the configuration the active simulation flies.
  //
  // Keyed on `tree.components`, not on `tree`: every store action replaces the
  // tree object, so keying on it would rebuild the engine and re-run the aero
  // sweep for a designer/comment/revision edit that cannot move a single number.
  // Component names do stay in this key: the engine labels its per-component
  // rows with them, so a rename has to reach the engine.
  const components = tree.components;
  // Whether the design has been built since the engine came up. The first build
  // runs at once so boot shows numbers without a wait; every one after it is
  // debounced (REBUILD_DEBOUNCE_MS).
  const builtOnce = useRef(false);
  /**
   * The design as it stood when the standing action error was posted. A build
   * that succeeds clears that error only for a design edited since: the edit is
   * the user moving on from it, and a build of the same design is not.
   */
  const errTree = useRef<RocketTree | null>(null);
  useEffect(
    () =>
      useWorkspaceStore.subscribe((st, prev) => {
        if (st.err && st.err !== prev.err) errTree.current = st.tree;
      }),
    [],
  );
  useEffect(() => {
    if (!ready) return; // wait for hydration so we build the real design once, not the default first
    // And wait for the kernel, which the app does not block on before mounting
    // (main.tsx). Building without one throws, and computeStaticInfo would turn
    // that into a red error banner over what is really just "not loaded yet" -
    // EngineNotice says that, and says it once. `enginePhase` is a dependency,
    // so the design builds itself the moment the engine arrives.
    if (enginePhase !== 'ready') {
      builtOnce.current = false;
      return;
    }
    const build = () => {
      const store = useWorkspaceStore.getState();
      // Tree and configuration read from the store rather than closed over, so the
      // effect need not depend on either object to use them: `components` and
      // `buildInputs` are the narrow keys that say when a rebuild is owed. The handle
      // still carries the current ignition overrides, because the configuration is
      // read here at build time.
      const res = computeStaticInfo(store.tree, selectConfig(store));
      if ('error' in res) {
        store.applyBuild(null, null);
        // The design's own explanation when it has one. The engine's message for
        // a zero dimension names no part ("The number NaN cannot be converted to
        // a BigInt" for a tube fin set with no length), and the Run button
        // already says which part and which field, in those words.
        store.setBuildErr(
          res.bad?.length
            ? designBlockerText({ kind: 'badGeometry', bad: res.bad }, i18nGlobal.t.bind(i18nGlobal))
            : res.error,
        );
      } else {
        store.applyBuild(res.info, res.rocket);
        store.setBuildErr(null);
        if (store.err && store.tree !== errTree.current) store.setErr(null);
      }
    };
    if (!builtOnce.current) {
      builtOnce.current = true;
      build();
      return;
    }
    // A build is a full kernel run on the main thread, and a typed or dragged
    // dimension changes the design once per input event. Each change cancels the
    // pending build, so a burst of edits costs one build after the last. Until it
    // lands, `info` and `rocket` describe the design as it was before the burst.
    const id = setTimeout(build, REBUILD_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [ready, enginePhase, components, buildInputs]);

  /**
   * Mirror the global run preferences into the store, which compares each result
   * against them (`selectOutdated`). `setSimPrefs` ignores a settings object
   * whose flight keys did not move: the settings store hands out a new
   * `simulation` object on every unrelated change in it, such as a unit switch.
   */
  const { settings } = useSettings();
  const simPrefs = settings.simulation;
  useEffect(() => {
    useWorkspaceStore.getState().setSimPrefs(simPrefs);
  }, [simPrefs]);
}
