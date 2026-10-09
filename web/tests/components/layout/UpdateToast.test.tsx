// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
// Real translations, so a renamed key fails here rather than showing a raw key
// on screen. No SettingsProvider: `rerender` would drop the wrapper and remount
// the tree, which is exactly what the identity assertion below must not see.
import '../../../src/i18n';

/**
 * The update toast: its live region, its buttons, and the newer-build check.
 *
 * A `role="status"` created at the same moment as its text is not announced by
 * most screen readers: the region has to already exist in the accessibility
 * tree for an insertion into it to count as an update. Returning `null` until
 * there is something to say would therefore announce nothing, which defeats the
 * purpose of a toast and looks completely correct on screen. Only an assertion
 * that the empty region is mounted catches that, because the visible behavior
 * is identical either way.
 */

/** Drives the mocked `useRegisterSW` between renders. */
let needRefresh = false;
const setNeedRefresh = vi.fn((v: boolean) => {
  needRefresh = v;
});
const updateServiceWorker = vi.fn();
/** The options UpdateToast hands the hook, so a test can fire its callbacks. */
let hookOptions: { onNeedRefresh?: () => void } = {};

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: (options: { onNeedRefresh?: () => void }) => {
    hookOptions = options;
    return {
      needRefresh: [needRefresh, setNeedRefresh],
      updateServiceWorker,
      offlineReady: [false, vi.fn()],
    };
  },
}));

const { UpdateToast } = await import('../../../src/components/layout/UpdateToast');

/** A waiting worker that reports `build` when asked which build it is. */
const workerOf = (build: number) =>
  ({
    postMessage: (_msg: unknown, ports: MessagePort[]) => ports[0]!.postMessage({ build }),
    addEventListener: vi.fn(),
  }) as unknown as ServiceWorker;

/** The build of the active worker in these tests. */
const ACTIVE = 1000;

/** The browser reporting a waiting worker of `build` over the active one, as the library's callback does. */
async function offer(build: number) {
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { getRegistration: () => Promise.resolve({ waiting: workerOf(build), active: workerOf(ACTIVE) }) },
  });
  needRefresh = true;
  await act(async () => {
    hookOptions.onNeedRefresh?.();
    await new Promise((r) => setTimeout(r, 0));
  });
}

const NEWER = ACTIVE + 1;
const OLDER = ACTIVE - 1;

afterEach(cleanup);

beforeEach(() => {
  needRefresh = false;
  hookOptions = {};
  setNeedRefresh.mockClear();
  updateServiceWorker.mockClear();
});

describe('the live region', () => {
  it('is mounted before there is anything to announce', () => {
    render(<UpdateToast />);
    const region = screen.getByRole('status');
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.textContent).toBe(''); // present, and saying nothing yet
  });

  it('is the same element once the update arrives, not a new one', async () => {
    // The point of the live region: a region that is created together with its
    // text is not announced; only an insertion into an existing region is.
    render(<UpdateToast />);
    const before = screen.getByRole('status');
    await offer(NEWER);
    const after = screen.getByRole('status');
    expect(after).toBe(before); // survived the state change
    expect(after.textContent).toContain('A new version is available.');
  });

  it('empties the same region again when the toast is dismissed', async () => {
    const { rerender } = render(<UpdateToast />);
    await offer(NEWER);
    const region = screen.getByRole('status');
    expect(region.textContent).toContain('A new version is available.');

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(setNeedRefresh).toHaveBeenCalledWith(false);
    rerender(<UpdateToast />);
    expect(screen.getByRole('status')).toBe(region); // still there for next time
    expect(region.textContent).toBe('');
  });
});

describe('the toast itself', () => {
  it('offers reload, later and dismiss', async () => {
    render(<UpdateToast />);
    await offer(NEWER);
    screen.getByRole('button', { name: 'Reload' });
    screen.getByRole('button', { name: 'Later' });
    screen.getByRole('button', { name: 'Dismiss' });
  });

  it('applies the waiting worker on reload', async () => {
    render(<UpdateToast />);
    await offer(NEWER);
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    await waitFor(() => expect(updateServiceWorker).toHaveBeenCalledWith(true));
  });

  it('shows that Reload was pressed while the new version activates', async () => {
    render(<UpdateToast />);
    await offer(NEWER);
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    const busy = screen.getByRole('button', { name: /Reloading/ }) as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
    expect(busy.getAttribute('aria-busy')).toBe('true');
    // Nothing left to put off once it is on its way.
    expect(screen.queryByRole('button', { name: 'Later' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
  });

  it('hides the body on Later without discarding the waiting worker', async () => {
    // "Later" snoozes; it must not clear needRefresh, or the same update can
    // never be offered again this session.
    render(<UpdateToast />);
    await offer(NEWER);
    fireEvent.click(screen.getByRole('button', { name: 'Later' }));
    expect(screen.queryByRole('button', { name: 'Reload' })).toBeNull();
    expect(setNeedRefresh).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toBe('');
  });
});

/**
 * The cycle this guards against: after a deploy the CDN can serve the previous
 * sw.js, the browser reports it as waiting, and taking it up reloads into the
 * old build, which then finds the new one again.
 */
describe('only a newer build', () => {
  it('offers nothing for a waiting worker of an older build', async () => {
    render(<UpdateToast />);
    await offer(OLDER);
    expect(screen.queryByRole('button', { name: 'Reload' })).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('offers nothing for a waiting worker of the same build', async () => {
    render(<UpdateToast />);
    await offer(ACTIVE);
    expect(screen.queryByRole('button', { name: 'Reload' })).toBeNull();
  });

  it('withdraws the offer when an older copy replaces the newer one', async () => {
    render(<UpdateToast />);
    await offer(NEWER);
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy();
    await offer(OLDER);
    expect(screen.queryByRole('button', { name: 'Reload' })).toBeNull();
  });
});
