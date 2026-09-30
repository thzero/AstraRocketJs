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

/**
 * jsdom has no matchMedia, and the status asks whether the window is at least xl
 * wide: below that it says the word alone, because the header is carrying the
 * tabs, the app name and the badge group and the age is what that band trades
 * away. `true` is the wide answer, which is the one that includes the age.
 */
const stubWidth = (isXl: boolean): void => {
  window.matchMedia = ((query: string) => ({
    matches: isXl,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
};

describe('SaveStatus', () => {
  beforeEach(() => {
    stubWidth(true);
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

  it('says the word without the age below xl', () => {
    stubWidth(false);
    renderWithProviders(<SaveStatus />);
    set({ lastSavedAt: Date.now() });
    // The word, and nothing about when: the exact time stays in the tooltip.
    expect(screen.getByRole('status').textContent).toBe('Saved');
    expect(screen.getByRole('status').title).toMatch(/Last saved at/);
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
