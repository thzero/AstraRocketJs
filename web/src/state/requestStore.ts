import { create } from 'zustand';

interface RequestState<O, R> {
  /** The open request, or null when no dialog is showing. */
  request: (O & { resolve: (v: R) => void }) | null;
  /** Open a request and resolve to the user's answer. */
  open: (opts: O) => Promise<R>;
  /** Resolve the open request with the user's answer and close the dialog. */
  settle: (result: R) => void;
}

/**
 * A store for one app-wide dialog driven as a promise, so non-React callers
 * (the workspace store) can wait on an answer. A new request while one is open
 * resolves the previous one with `dismissed`, so a resolver is never dropped.
 */
export function createRequestStore<O extends object, R>(dismissed: R) {
  return create<RequestState<O, R>>((set, get) => ({
    request: null,
    open: (opts) =>
      new Promise<R>((resolve) => {
        get().request?.resolve(dismissed);
        set({ request: { ...opts, resolve } });
      }),
    settle: (result) => {
      const r = get().request;
      if (!r) return;
      set({ request: null });
      r.resolve(result);
    },
  }));
}
