import { useSyncExternalStore } from 'react';

const subscribe = (onChange: () => void) => {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
};

/**
 * Whether the browser says it has a connection.
 *
 * For the buttons that need one (a forecast, a place search, an update check):
 * greyed out with the reason while offline, rather than letting a click run
 * into a timeout at a field with no signal. `navigator.onLine` can say online on
 * a network that reaches nothing, so a request can still fail and says so; it
 * does not say offline while connected, which is the case this is for.
 */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
}
