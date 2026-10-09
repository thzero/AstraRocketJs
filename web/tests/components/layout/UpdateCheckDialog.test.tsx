// @vitest-environment jsdom
import { useLayoutEffect } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import '../../../src/i18n';
import { UpdateCheckDialog } from '../../../src/components/layout/UpdateCheckDialog';
import { useUpdateStore } from '../../../src/state/updateStore';

/**
 * The menu's Check for updates: it asks the moment it opens and says what came
 * of it, "you are up to date" included, which the update banner never says.
 */
afterEach(cleanup);

beforeEach(() => {
  useUpdateStore.setState({ result: 'idle', checker: null });
});

describe('UpdateCheckDialog', () => {
  it('checks as soon as it opens and says when this is the latest version', async () => {
    const checker = vi.fn(() => Promise.resolve('upToDate' as const));
    useUpdateStore.setState({ checker });
    render(<UpdateCheckDialog onClose={() => {}} />);
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('You are running the latest version.'));
    expect(checker).toHaveBeenCalledTimes(1);
  });

  it('says a new version was found', async () => {
    useUpdateStore.setState({ checker: () => Promise.resolve('available' as const) });
    render(<UpdateCheckDialog onClose={() => {}} />);
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/^A new version is available\./));
  });

  it('says when the check could not be made', async () => {
    useUpdateStore.setState({ checker: () => Promise.reject(new Error('offline')) });
    render(<UpdateCheckDialog onClose={() => {}} />);
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/^Could not check for updates/));
  });

  it('closes on Close', () => {
    useUpdateStore.setState({ checker: () => new Promise(() => {}) });
    const onClose = vi.fn();
    render(<UpdateCheckDialog onClose={onClose} />);
    expect(screen.getByRole('status').textContent).toBe('Checking…');
    fireEvent.click(screen.getAllByRole('button', { name: 'Close' }).at(-1)!);
    expect(onClose).toHaveBeenCalled();
  });

  it('does not paint or announce the previous answer when it opens again', () => {
    useUpdateStore.setState({ result: 'upToDate', checker: () => new Promise(() => {}) });
    // What the first commit put in the live region, read before any effect of
    // the dialog's own has run.
    const seen: (string | null | undefined)[] = [];
    function Probe() {
      useLayoutEffect(() => {
        seen.push(document.querySelector('[role="status"]')?.textContent);
      }, []);
      return null;
    }
    render(
      <>
        <UpdateCheckDialog onClose={() => {}} />
        <Probe />
      </>,
    );
    expect(seen[0]).toBe('Checking…');
  });
});
