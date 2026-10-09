import { create } from 'zustand';

/** What the last manual check found. */
export type UpdateCheckResult = 'idle' | 'checking' | 'upToDate' | 'available' | 'failed';

interface UpdateState {
  /**
   * Asks the service worker for a new version and says whether one is waiting.
   * Registered by UpdateToast once the worker is up; null before that, and
   * always on the dev server, which registers no worker.
   */
  checker: (() => Promise<'upToDate' | 'available'>) | null;
  result: UpdateCheckResult;
  setChecker: (checker: UpdateState['checker']) => void;
  /** Check now, for the menu's Check for updates; the answer lands in `result`. */
  checkNow: () => Promise<void>;
}

/**
 * The manual "Check for updates", shared between the update banner, which owns
 * the service worker registration, and the menu entry with its dialog
 * (UpdateCheckDialog).
 *
 * The banner already checks on a timer and says nothing until a version is
 * waiting; this is for someone who wants an answer now, including "you are up
 * to date", which the timer never gives.
 */
export const useUpdateStore = create<UpdateState>((set, get) => ({
  checker: null,
  result: 'idle',
  setChecker: (checker) => set({ checker }),
  checkNow: async () => {
    const { checker } = get();
    if (!checker) return;
    set({ result: 'checking' });
    try {
      set({ result: await checker() });
    } catch {
      // Offline, or the server did not answer: worth saying, since the person
      // asked, unlike the timer's checks.
      set({ result: 'failed' });
    }
  },
}));
