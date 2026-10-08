import { Component, lazy, Suspense, type ComponentType, type ErrorInfo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Catches a render-time throw from one part of the app and offers a way out,
 * instead of letting it take the whole window down.
 *
 * This matters most around the lazy views: Rocket3D, FlightPath3D,
 * ComponentPicker, SavePartButton and ExportDialog are each an `import()`
 * fetched on first use. A failed chunk fetch rejects, Suspense re-throws the
 * rejection during render, and with nothing above it to catch it React
 * unmounts the entire tree: a blank window, no view switch, no menu,
 * nothing left to click. A stale Pages deploy produces exactly that: the chunk
 * name the loaded build asks for is no longer on the server, the server answers
 * with its index.html, and the browser reports the HTML body as a bad module
 * ("'text/html' is not a valid JavaScript MIME type" in Safari, "Failed to
 * fetch dynamically imported module" in Chrome).
 *
 * Wrapped around each Suspense rather than once around the app, so the failure
 * is contained where it happened: the 3D canvas says it could not load and the
 * view switch, the tree and the property panel beside it all keep working.
 */

/**
 * Whether this is a chunk that could not be fetched, as opposed to a bug inside
 * the view. The three engines word it differently and none of them uses a
 * distinguishable error type, so the message is all there is to go on.
 */
export function isChunkLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.name === 'ChunkLoadError' ||
    /dynamically imported module|module script failed|MIME type|Loading chunk/i.test(error.message)
  );
}

/**
 * What the boundary shows in place of the view it lost.
 *
 * Reload and nothing else, deliberately. A "retry" button would be a control
 * that does nothing: React's `lazy` caches a rejected import forever, so
 * remounting the same lazy component re-throws the same error without going
 * back to the network. Reloading is also the only thing that can help in the
 * case this exists for: a new deploy has new chunk names, and only a fresh
 * document knows them.
 */
function ErrorFallback({ error }: { error: Error }) {
  const { t } = useTranslation();
  const stale = isChunkLoadError(error);
  return (
    <div role="alert" className="flex h-full min-h-32 flex-col items-center justify-center gap-3 p-4 text-center">
      <p className="text-sm text-ink-soft">{t(stale ? 'errors.staleBuild' : 'errors.viewFailed')}</p>
      {/* The message itself, small and below: on a bug inside the view it is
          the only clue the user can pass on, and on a stale build it names the
          file that went missing. */}
      <p className="max-w-md break-words text-[11px] leading-snug text-ink-faint">{error.message}</p>
      <button
        onClick={() => window.location.reload()}
        className="rounded-lg bg-accent-600 px-3 py-1.5 text-sm font-medium text-on-accent hover:bg-accent-500"
      >
        {t('update.reload')}
      </button>
    </div>
  );
}

type Props = { children: ReactNode };
type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // The console, not the app's error banner. The banner lives in the
    // workspace store, and writing to a store from here re-renders the tree
    // that just threw, which throws again, from inside error handling.
    console.error('view failed to render', error, info.componentStack);
  }

  render() {
    return this.state.error ? <ErrorFallback error={this.state.error} /> : this.props.children;
  }
}

/**
 * A lazy view with its loading fallback, inside an error boundary. The boundary
 * sits outside the Suspense: it is the chunk fetch that fails on a stale deploy,
 * and Suspense re-throws that rejection during render rather than holding it, so
 * a boundary inside it catches nothing and the throw takes the whole app down.
 */
export function LazyBoundary({ fallback, children }: { fallback: ReactNode; children: ReactNode }) {
  return (
    <ErrorBoundary>
      <Suspense fallback={fallback}>{children}</Suspense>
    </ErrorBoundary>
  );
}

/** `React.lazy` over a module's named export, the form every view here exports. */
// `any` is React.lazy's own constraint on the component; the export's real
// props type is kept through T, so the caller is still checked.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyNamed<K extends string, T extends ComponentType<any>>(load: () => Promise<Record<K, T>>, key: K) {
  return lazy(() => load().then((m) => ({ default: m[key] })));
}
