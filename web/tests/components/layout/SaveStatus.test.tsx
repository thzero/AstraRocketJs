// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, screen } from '@testing-library/react';
import { renderWithProviders } from '../../testing/renderWithProviders';
import { useWorkspaceStore } from '../../../src/state/store';
import { SaveStatus } from '../../../src/components/layout/SaveStatus';

/**
 * The header's save status, which replaced the File menu's Save item.
 *
 * What it must never do is claim a save that did not happen — that is the
 * whole reason the item was removable in the first place, so the two silent
 * cases matter at least as much as the text.
 */
const set = (patch: Partial<ReturnType<typeof useWorkspaceStore.getState>>) =>
  act(() => useWorkspaceStore.setState(patch));

describe('SaveStatus', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    set({ lastSavedAt: null, storageWarning: null, storageWarningKind: null });
  });
  afterEach(() => vi.useRealTimers());

  it('says nothing before the first write has landed', () => {
    renderWithProviders(<SaveStatus />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('reports a save that just landed', () => {
    renderWithProviders(<SaveStatus />);
    set({ lastSavedAt: Date.now() });
    expect(screen.getByRole('status').textContent).toBe('Saved just now');
  });

  it('ages on its own, without anything else re-rendering it', () => {
    renderWithProviders(<SaveStatus />);
    set({ lastSavedAt: Date.now() });

    act(() => void vi.advanceTimersByTime(6 * 60_000));
    expect(screen.getByRole('status').textContent).toBe('Saved 6 minutes ago');
  });

  /**
   * The storage banner says work is NOT being kept. It outlives any one write,
   * so a "Saved" beside it would be the app contradicting itself in the same
   * header about the one thing the user cannot recompute.
   */
  it('stays quiet while the storage banner is up', () => {
    renderWithProviders(<SaveStatus />);
    set({ lastSavedAt: Date.now(), storageWarning: 'Browser storage is full.', storageWarningKind: 'full' });
    expect(screen.queryByRole('status')).toBeNull();
  });
});
