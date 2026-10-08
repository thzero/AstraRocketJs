// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
// Real translations, so a renamed key fails here rather than showing a raw key
// on screen. No SettingsProvider: `rerender` would drop the wrapper and remount
// the tree, which is exactly what the identity assertion below must not see.
import '../../../src/i18n';

/**
 * The toast's live region, and the one thing about it that is easy to undo.
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

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
    offlineReady: [false, vi.fn()],
  }),
}));

const { UpdateToast } = await import('../../../src/components/layout/UpdateToast');

afterEach(cleanup);

beforeEach(() => {
  needRefresh = false;
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

  it('is the SAME element once the update arrives, not a new one', () => {
    // The point of the live region: a region that is created together with its
    // text is not announced; only an insertion into an existing region is.
    const { rerender } = render(<UpdateToast />);
    const before = screen.getByRole('status');

    needRefresh = true;
    rerender(<UpdateToast />);

    const after = screen.getByRole('status');
    expect(after).toBe(before); // survived the state change
    expect(after.textContent).toContain('A new version is available.');
  });

  it('empties the same region again when the toast is dismissed', () => {
    needRefresh = true;
    render(<UpdateToast />);
    const region = screen.getByRole('status');
    expect(region.textContent).toContain('A new version is available.');

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(setNeedRefresh).toHaveBeenCalledWith(false);
    expect(screen.getByRole('status')).toBe(region); // still there for next time
  });
});

describe('the toast itself', () => {
  it('offers reload, later and dismiss', () => {
    needRefresh = true;
    render(<UpdateToast />);
    screen.getByRole('button', { name: 'Reload' });
    screen.getByRole('button', { name: 'Later' });
    screen.getByRole('button', { name: 'Dismiss' });
  });

  it('applies the waiting worker on reload', () => {
    needRefresh = true;
    render(<UpdateToast />);
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(updateServiceWorker).toHaveBeenCalledWith(true);
  });

  it('shows that Reload was pressed while the new version activates', () => {
    needRefresh = true;
    render(<UpdateToast />);
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    const busy = screen.getByRole('button', { name: /Reloading/ }) as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
    expect(busy.getAttribute('aria-busy')).toBe('true');
    // Nothing left to put off once it is on its way.
    expect(screen.queryByRole('button', { name: 'Later' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
  });

  it('hides the body on Later without discarding the waiting worker', () => {
    // "Later" snoozes; it must not clear needRefresh, or the same update can
    // never be offered again this session.
    needRefresh = true;
    render(<UpdateToast />);
    fireEvent.click(screen.getByRole('button', { name: 'Later' }));
    expect(screen.queryByRole('button', { name: 'Reload' })).toBeNull();
    expect(setNeedRefresh).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toBe('');
  });
});
