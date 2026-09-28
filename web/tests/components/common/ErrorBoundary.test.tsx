// @vitest-environment jsdom
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { ErrorBoundary, isChunkLoadError } from '../../../src/components/common/ErrorBoundary';
import { renderWithProviders } from '../../testing/renderWithProviders';

/**
 * There was no boundary anywhere in the app, so a lazy view whose chunk had
 * gone missing (a stale Pages deploy) took the whole window down: the throw
 * came out of Suspense during render and React unmounted everything.
 */

const Boom = ({ error }: { error: Error }) => {
  throw error;
};

// React logs the caught error itself, on top of the boundary's own log. Both are
// expected here, and left unsilenced they bury the rest of the test output.
let logged: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  logged = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => logged.mockRestore());

describe('ErrorBoundary', () => {
  it('leaves a working subtree alone', () => {
    renderWithProviders(
      <ErrorBoundary>
        <p>the 3D view</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText('the 3D view')).toBeTruthy();
  });

  it('shows the stale-build message and a reload for a missing chunk', () => {
    renderWithProviders(
      <ErrorBoundary>
        <Boom error={new TypeError("'text/html' is not a valid JavaScript MIME type.")} />
      </ErrorBoundary>,
    );
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('no longer on the server');
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy();
  });

  it('reports a bug inside the view as a failed view, not a stale build', () => {
    renderWithProviders(
      <ErrorBoundary>
        <Boom error={new Error('Cannot read properties of undefined')} />
      </ErrorBoundary>,
    );
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('could not be loaded');
    expect(alert.textContent).not.toContain('no longer on the server');
    // The message itself is shown: on a bug it is the only clue to pass on.
    expect(alert.textContent).toContain('Cannot read properties of undefined');
  });
});

describe('isChunkLoadError', () => {
  /** Each engine words a failed dynamic import differently and none of them
   *  uses a distinguishable error type, so the message is all there is. */
  it('recognizes what each browser says about a chunk it could not fetch', () => {
    expect(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: https://x/a.js'))).toBe(true);
    expect(isChunkLoadError(new TypeError('error loading dynamically imported module'))).toBe(true);
    expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true);
    expect(isChunkLoadError(new TypeError("'text/html' is not a valid JavaScript MIME type."))).toBe(true);
    expect(isChunkLoadError(Object.assign(new Error('Loading chunk 42 failed'), { name: 'ChunkLoadError' }))).toBe(
      true,
    );
  });

  it('does not claim an ordinary render bug is one', () => {
    expect(isChunkLoadError(new TypeError('tree.children is not iterable'))).toBe(false);
    expect(isChunkLoadError('not an error at all')).toBe(false);
  });
});
