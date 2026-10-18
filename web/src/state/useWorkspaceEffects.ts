import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18nGlobal, { isLanguageReady, languageReady } from '../i18n';
import { useWorkspaceStore, selectConfig, saveFailure, workspaceSnapshot, type WorkspaceState } from './store';
import { simPrefsOf } from './workspaceSelectors';
import { currentAutosaveToken, markWritten, savesHeld, unchangedSinceWrite } from './writtenWorkspace';
import { setKernelLengthUnit, type RocketTree } from '../engine/openRocketEngine';

import { useEngineStore } from './engineStore';
import { getWorkspaceStore } from '../services/storage/workspaceStore';
import { onStorageDegraded } from '../services/storage/idbKeyValueStore';
import { requestPersistentStorage } from '../services/storage/persistStorage';
import { computeStaticInfo, buildKey } from '../services/design/buildRocket';
import { buildFailureText } from '../services/flight/runnability';
import { useSettings } from './SettingsProvider';
import { warmSimWorker } from '../engine/simClient';
import { appName, defaultDesignName } from '../services/app/appInfo';
import { defaultStageName } from '../services/design/orkTree';

/**
 * How long the design must sit still before the engine rebuilds it. Long enough
 * to span the gap between keystrokes or slider events, short enough that the
 * figures follow a pause without a visible wait.
 */
export const REBUILD_DEBOUNCE_MS = 150;

type Boot = Pick<WorkspaceState, 'tree' | 'sims' | 'configs'>;

/**
 * Whether the design on screen is still the one the store built at boot.
 * Every edit replaces the object it changes, so an identity match means
 * nothing has been touched since.
 */
function untouchedSinceBoot(boot: Boot): boolean {
  const s = useWorkspaceStore.getState();
  return s.tree === boot.tree && s.sims === boot.sims && s.configs === boot.configs;
}

/**
 * The default design named in the language now loaded, while it is still
 * untouched since boot.
 *
 * The store builds it as the app mounts, before the language's bundle has
 * landed, so a first run in another language gets the English fallback for
 * the design, its stage and its simulation, and the first edit saves them.
 * Bumps `quietReplace`, as New does, so the renaming alone is not saved.
 */
function nameDefaultDesign(boot: Boot): void {
  if (!untouchedSinceBoot(boot)) return;
  const s = useWorkspaceStore.getState();
  const [stage, ...rest] = s.tree.components;
  const [sim, ...others] = s.sims;
  if (!stage || !sim) return;
  const name = defaultDesignName();
  const stageName = defaultStageName(0);
  const simName = i18nGlobal.t('sims.untitled', { n: 1 });
  if (s.tree.name === name && stage.name === stageName && sim.name === simName) return;
  useWorkspaceStore.setState({
    tree: { ...s.tree, name, components: [{ ...stage, name: stageName }, ...rest] },
    sims: [{ ...sim, name: simName }, ...others],
    quietReplace: s.quietReplace + 1,
  });
}

/**
 * Write the workspace and record the outcome where the UI reads it: the
 * written marker, the header's save status and the storage warning slot.
 *
 * A successful save retires a "storage full" or conflict warning and nothing
 * else: the IndexedDB-degraded and load-failed messages are facts about this
 * session that a later write does not undo (see clearSaveWarning). It also
 * asks the browser not to evict this origin under disk pressure, since there
 * is now a design worth keeping. Once per session, best-effort.
 */
function persist(fields: Parameters<typeof workspaceSnapshot>[0]): void {
  getWorkspaceStore()
    .save(workspaceSnapshot(fields))
    .then(() => {
      markWritten(fields);
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
}

/**
 * The React-side effects for the workspace store: keep the browser title in sync,
 * hydrate + autosave to browser storage, and rebuild the engine (recomputing
 * stability) whenever the design or its motors change. Mounted once, in App.
 */
export function useWorkspaceEffects() {
  // The effects below translate through the module singleton (`i18nGlobal`,
  // as store.ts uses), never the hook's `t` or `i18n`: react-i18next hands
  // back fresh ones on a language change, and an effect that listed one in its
  // deps would re-run on a language switch. For the hydration effect that
  // would mean re-reading and re-hydrating the workspace, which can hydrate a
  // stale design over a fresh import. `i18nGlobal.t(...)` reads the current
  // language at call time, so messages are still translated.
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
    // Hydrate keeps text as strings (the repair notes, the load-failed warning),
    // so it waits for the language's bundle, up to a ceiling. The read starts
    // now; only what is kept from it waits.
    const language = languageReady();
    const boot: Boot = useWorkspaceStore.getState();
    getWorkspaceStore()
      .load()
      .then(async (w) => {
        await language;
        // Both writes belong inside the guard. Outside it, StrictMode's
        // canceled first load would flip `ready` while the tree was still
        // the default, so the rebuild effect would build the default rocket and
        // the second load build again: the double build the `ready` gate
        // exists to prevent.
        if (!live) return;
        if (w && untouchedSinceBoot(boot)) useWorkspaceStore.getState().hydrate(w);
        else if (w) {
          // The editor is live while the read and the language wait run, and
          // nothing autosaves until this resolves, so a part added in those
          // seconds exists only on screen. Hydrating now would replace it with
          // the stored design. The design on screen stays, detached from the
          // stored one's library entry so the write below creates an entry of
          // its own and the stored design keeps its own, unchanged.
          getWorkspaceStore().setActiveId?.(null);
          persist(useWorkspaceStore.getState());
        } else if (untouchedSinceBoot(boot)) {
          nameDefaultDesign(boot);
          // Nothing stored: the default rocket is not worth storing until it is
          // edited, as after New (see `writtenWorkspace`). Edited while the read
          // and the language wait ran, the design on screen is the user's and
          // stays unwritten, as after a rejected load: marked written, the
          // autosave (which does not run before this resolves), the unload
          // flush and the hidden-tab save would all skip it.
          markWritten(useWorkspaceStore.getState());
        }
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
      // the first edit, and this message is a fact about the session that a
      // later save does not undo (see clearSaveWarning).
      // Detached first: the store can still hold the design that failed to
      // open (the read succeeded and `hydrate` threw), and the first edit would
      // autosave the default rocket over it. Detached, that edit creates a new
      // design and the unreadable one stays in the library.
      .catch(async () => {
        await language;
        if (!live) return;
        getWorkspaceStore().setActiveId?.(null);
        if (untouchedSinceBoot(boot)) {
          nameDefaultDesign(boot);
          // The default rocket on screen is no more worth storing than after an
          // empty load: hiding the tab must not save it as a library entry.
          markWritten(useWorkspaceStore.getState());
        }
        // Edited while the load ran: the design on screen is the user's and
        // stays unwritten, so the next autosave or the unload flush stores it,
        // detached, as a design of its own.
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
  // The configuration inputs that owe a rebuild: the seated motors and the
  // grounded stages (see buildRocket.buildKey). Ignition is left out; only the
  // worker's build reads it. A string, because zustand v5 compares a
  // selector's result by identity and this is derived per call.
  //
  // A key without `grounded` would not rebuild when a booster is grounded: the
  // worker would fly the sustainer while `info` still described the whole stack.
  const buildInputs = useWorkspaceStore((s) => buildKey(s.tree, selectConfig(s)));
  // The rebuild effect below is the app's one engine caller on the main thread,
  // so it is where "the kernel is not up yet" is handled.
  const enginePhase = useEngineStore((s) => s.phase);
  // The kernel decides and words its airframe-step warnings in this unit
  // (setKernelLengthUnit), so a change of unit rebuilds the design.
  const lengthUnit = useSettings().settings.units.length;
  // An abandoned or failed import can reset the engine under the open design
  // (fileSlice `rebuildSeq`); its handle is void until this builds it again.
  const rebuildSeq = useWorkspaceStore((s) => s.rebuildSeq);

  useEffect(() => {
    if (seenQuiet.current !== quietReplace) {
      // The state this effect is reacting to is what was just loaded, or a blank
      // design nobody has touched. Writing it back changes nothing but the
      // timestamp. A real edit is saved by being the next thing to run.
      seenQuiet.current = quietReplace;
      return;
    }
    if (!hydrated.current) return;
    // A switch, a delete or a swap that starts before this fires voids it (see
    // `voidPendingAutosave`): by then the store may point at another design.
    const token = currentAutosaveToken();
    const id = setTimeout(() => {
      if (token !== currentAutosaveToken() || savesHeld()) return;
      persist({ tree, sims, configs, activeId, loadedMeta });
    }, 500);
    return () => clearTimeout(id);
  }, [tree, sims, configs, activeId, loadedMeta, quietReplace]);

  // IndexedDB blocked (policy, some private modes) means we are back on the 5 MB
  // localStorage cap. Say so now rather than letting the user meet it later as
  // an unexplained failed save mid-design.
  // Kept as a string, so worded once the language's bundle is in.
  useEffect(
    () =>
      onStorageDegraded(() => {
        const warn = () => useWorkspaceStore.getState().setStorageWarning(i18nGlobal.t('storage.degraded'), 'degraded');
        if (isLanguageReady()) warn();
        else void languageReady().then(warn);
      }),
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
  //
  // Neither writes a workspace storage already holds (`unchangedSinceWrite`).
  useEffect(() => {
    const snapshot = () => workspaceSnapshot(useWorkspaceStore.getState());
    const flush = () => {
      if (!hydrated.current || savesHeld() || unchangedSinceWrite(useWorkspaceStore.getState())) return;
      const store = getWorkspaceStore();
      if (store.saveSync) store.saveSync(snapshot());
      else store.save(snapshot()).catch(() => {}); // unloading; nothing to surface
    };
    const onHidden = () => {
      if (!hydrated.current || savesHeld() || document.visibilityState !== 'hidden') return;
      const fields = useWorkspaceStore.getState();
      if (unchangedSinceWrite(fields)) return;
      getWorkspaceStore()
        .save(workspaceSnapshot(fields))
        .then(() => {
          markWritten(fields);
          useWorkspaceStore.getState().clearSaveWarning();
        })
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
      // A retry resets the engine (resetEngineInit), which voids every handle
      // the old one issued, so a build kept here is a dead handle: the Aero
      // view's Worst button throws on it and an input change blanks the pane
      // until the new engine lands. Cleared to the not-built state instead.
      const store = useWorkspaceStore.getState();
      if (store.rocket || store.info) store.applyBuild(null, null);
      return;
    }
    const build = () => {
      setKernelLengthUnit(lengthUnit);
      const store = useWorkspaceStore.getState();
      // Tree and configuration read from the store rather than closed over, so the
      // effect need not depend on either object to use them: `components` and
      // `buildInputs` are the narrow keys that say when a rebuild is owed. Ignition is
      // not in those keys, so an ignition edit alone does not rebuild and this
      // handle keeps the ignition of its last build; the worker reads it per flight.
      const res = computeStaticInfo(store.tree, selectConfig(store));
      if ('error' in res) {
        store.applyBuild(null, null);
        // The design's own explanation when it has one, in the Run button's
        // words: the engine's message for a zero dimension or an overturned fin
        // set names no part.
        store.setBuildErr(buildFailureText(res, i18nGlobal.t.bind(i18nGlobal)));
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
  }, [ready, enginePhase, components, buildInputs, lengthUnit, rebuildSeq]);

  /**
   * Mirror the global run preferences into the store, which compares each result
   * against them (`selectOutdated`). `setSimPrefs` ignores a settings object
   * whose flight keys did not move: the settings store hands out a new
   * `simulation` object on every unrelated change in it, such as a unit switch.
   */
  const { settings } = useSettings();
  useEffect(() => {
    useWorkspaceStore.getState().setSimPrefs(simPrefsOf(settings));
  }, [settings]);
}
