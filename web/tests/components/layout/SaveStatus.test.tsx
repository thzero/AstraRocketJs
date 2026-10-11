// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, screen } from '@testing-library/react';
import { renderWithProviders } from '../../testing/renderWithProviders';
import { useWorkspaceStore } from '../../../src/state/store';
import { SaveStatus } from '../../../src/components/layout/SaveStatus';

/**
 * The header's save status, which stands in for a Save menu item.
 *
 * What it must never do is claim a save that did not happen, so the two silent
 * cases matter at least as much as the text.
 */
const set = (patch: Partial<ReturnType<typeof useWorkspaceStore.getState>>) =>
  act(() => useWorkspaceStore.setState(patch));

/**
 * jsdom has no matchMedia, and the status asks whether the window is at least 2xl
 * wide: below that it says the word alone, because the header is carrying the
 * tabs, the app name and the badge group and the age is what that band trades
 * away. `true` is the wide answer, which is the one that includes the age.
 */
const stubWidth = (isWide: boolean): void => {
  window.matchMedia = ((query: string) => ({
    matches: isWide,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
};

/** What the header shows, and what the live region says. */
const shown = () => screen.getByRole('status').querySelector('[aria-hidden="true"]')!.textContent;
const spoken = () => screen.getByRole('status').querySelector('.sr-only')!.textContent;

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
    expect(shown()).toBe('Saved just now');
  });

  it('says the word without the age below 2xl', () => {
    stubWidth(false);
    renderWithProviders(<SaveStatus />);
    set({ lastSavedAt: Date.now() });
    // The word, and nothing about when: the exact time stays in the tooltip.
    expect(shown()).toBe('Saved');
    expect(screen.getByRole('status').title).toMatch(/Last saved at/);
  });

  it('ages on its own, without anything else re-rendering it', () => {
    renderWithProviders(<SaveStatus />);
    set({ lastSavedAt: Date.now() });

    act(() => void vi.advanceTimersByTime(6 * 60_000));
    expect(shown()).toBe('Saved 6 minutes ago');
  });

  it('keeps the age out of the live text, so a tick does not re-announce it', () => {
    renderWithProviders(<SaveStatus />);
    set({ lastSavedAt: Date.now() });
    expect(spoken()).toBe('Saved');
    act(() => void vi.advanceTimersByTime(6 * 60_000));
    expect(spoken()).toBe('Saved');
  });

  /**
   * The storage banner says work is not being kept. It outlives any one write,
   * so a "Saved" beside it would be the app contradicting itself in the same
   * header about the one thing the user cannot recompute.
   */
  it('stays quiet while the storage banner is up', () => {
    renderWithProviders(<SaveStatus />);
    set({ lastSavedAt: Date.now(), storageWarning: 'Browser storage is full.', storageWarningKind: 'full' });
    expect(screen.queryByRole('status')).toBeNull();
  });
});
