/**
 * Which build a service worker belongs to, so the page takes up only a newer one.
 *
 * A browser installs any service worker script that differs from the running one
 * and reports it as waiting, whether it is newer or older. GitHub Pages serves
 * sw.js through CDN nodes that each cache it for up to ten minutes, so for a while
 * after a deploy some requests get the new script and some the previous one.
 * Taking up whatever is waiting then swaps the new worker for the old one, which
 * finds the new one again, and the page reloads round and round. Each build
 * therefore carries an id (its build time, see vite.config.ts) that its worker
 * answers with, and a waiting worker is an update only when its id is higher than
 * the active worker's. Workers then only ever move forward.
 *
 * Against the active worker rather than the page: a page load is network-first,
 * so the page can already run the new build's code while the old worker is still
 * in control, and that worker still has to be replaced.
 */

/** How long a worker has to answer. A build from before the question existed never does. */
const ASK_TIMEOUT_MS = 3_000;

/** Ask a worker for its build id; null when it does not answer, or answers with something else. */
export function askBuild(sw: ServiceWorker, timeoutMs: number = ASK_TIMEOUT_MS): Promise<number | null> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(null), timeoutMs);
    channel.port1.onmessage = (event: MessageEvent<unknown>) => {
      clearTimeout(timer);
      const build = (event.data as { build?: unknown } | null)?.build;
      resolve(typeof build === 'number' && Number.isFinite(build) ? build : null);
    };
    sw.postMessage({ type: 'GET_BUILD' }, [channel.port2]);
  });
}

/**
 * Whether a waiting worker of build `waiting` replaces an active one of build
 * `active`. A waiting build that does not answer is never newer. An active one
 * that does not answer is a build from before the question existed, so any
 * waiting build that answers is newer than it.
 */
export function isNewerBuild(waiting: number | null, active: number | null): boolean {
  if (waiting === null) return false;
  return active === null || waiting > active;
}

/**
 * Whether the registration has a waiting worker that is a newer build than its active one.
 *
 * An active worker that misses the first question is asked once more before it
 * is taken for a build from before the question existed. A current worker slow
 * to wake would otherwise count as pre-feature, and with a stale previous build
 * in the waiting slot (the CDN case above) the page would take the older one up.
 */
export async function waitingIsNewer(reg: ServiceWorkerRegistration | null | undefined): Promise<boolean> {
  if (!reg?.waiting) return false;
  const [waiting, first] = await Promise.all([askBuild(reg.waiting), reg.active ? askBuild(reg.active) : null]);
  const active = first === null && waiting !== null && reg.active ? await askBuild(reg.active) : first;
  return isNewerBuild(waiting, active);
}
