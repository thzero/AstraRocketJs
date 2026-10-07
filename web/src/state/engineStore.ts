import { create } from 'zustand';
import { initEngine, resetEngineInit, type EngineLoadStatus } from '../engine/openRocketEngine';
import { errorMessage } from '../services/app/errorMessage';

/**
 * Where the physics kernel is, as UI state.
 *
 * The engine is a 2.3 MB WASM module (or a 1 MB JS chunk when that is not
 * available), and it used to be loaded BEFORE React mounted. That made every
 * way the download can go wrong a way the whole app can fail to appear, and the
 * worst of them is silent: a stalled fetch neither resolves nor rejects, so the
 * splash simply stayed up forever with nothing on screen and no way out.
 *
 * So the app mounts first and reads this instead. The tree, the drawing, the
 * library and every import/export path need no kernel; the static numbers and
 * the simulations do, and they stay absent until `phase` is 'ready'.
 */
export type EnginePhase = 'loading' | 'ready' | 'failed';

/**
 * How long a load may run before the UI stops saying "loading" and offers a way
 * out. A stall never reports anything, so elapsed time is the ONLY signal that
 * separates it from a slow link, and neither one can be waited out silently.
 */
const SLOW_AFTER_MS = 15_000;

interface EngineState {
  phase: EnginePhase;
  /** Which backend won, once one has. */
  backend: 'wasm' | 'js' | null;
  /** The latest load step, for the progress line. Null once settled. */
  status: EngineLoadStatus | null;
  /** True once this load has outrun SLOW_AFTER_MS without settling. */
  slow: boolean;
  /** Why the load failed, when it failed rather than stalled. */
  error: string | null;
  /** Begin the first load. Called once, from main.tsx. */
  start: () => void;
  /** Abandon whatever is in flight and load again from scratch. */
  retry: () => void;
}

export const useEngineStore = create<EngineState>((set) => {
  // Bumped per attempt. An abandoned load keeps running - that is the whole
  // problem with a stall - and both its status callbacks and its eventual
  // settlement have to be ignored rather than allowed to overwrite a newer one.
  let attempt = 0;
  let slowTimer: ReturnType<typeof setTimeout> | null = null;

  const clearSlowTimer = () => {
    if (slowTimer !== null) clearTimeout(slowTimer);
    slowTimer = null;
  };

  const run = () => {
    const mine = attempt;
    clearSlowTimer();
    slowTimer = setTimeout(() => {
      if (mine === attempt) set({ slow: true });
    }, SLOW_AFTER_MS);
    set({ phase: 'loading', status: null, error: null, slow: false });

    initEngine((s) => {
      if (mine === attempt) set({ status: s });
    })
      .then((backend) => {
        if (mine !== attempt) return;
        clearSlowTimer();
        set({ phase: 'ready', backend, status: null, error: null, slow: false });
      })
      .catch((e: unknown) => {
        if (mine !== attempt) return;
        clearSlowTimer();
        set({ phase: 'failed', error: errorMessage(e), status: null });
      });
  };

  return {
    phase: 'loading',
    backend: null,
    status: null,
    slow: false,
    error: null,
    start: run,
    retry: () => {
      attempt++;
      resetEngineInit();
      run();
    },
  };
});
