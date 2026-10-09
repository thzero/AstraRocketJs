// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { LoadedBanner } from '../../../src/components/canvas/LoadedBanner';
import { renderWithProviders, seedSettings } from '../../testing/renderWithProviders';
import { useWorkspaceStore } from '../../../src/state/store';

/**
 * The import notes collapse to a count, and collapsed stays collapsed while you
 * work on the design. A new import with notes opens them again: they are news on
 * the import that raised them.
 */
const loaded = { name: 'Rocket', notes: ['First note.', 'Second note.'] };
const toggle = () => screen.getByRole('button', { name: /import notes/ });

afterEach(cleanup);
beforeEach(() => {
  // jsdom has no matchMedia; the card asks it whether the component tree is shown.
  window.matchMedia = ((query: string) => ({
    matches: true,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  localStorage.clear();
  useWorkspaceStore.setState({ repairNotes: [] });
});

describe('LoadedBanner import notes', () => {
  it('opens collapsed notes for a new import', () => {
    seedSettings({ showImportNotes: false });
    useWorkspaceStore.setState({ importSeq: useWorkspaceStore.getState().importSeq + 1 });
    renderWithProviders(<LoadedBanner loaded={loaded} onClose={() => {}} />);
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText(/First note\./)).toBeTruthy();
  });

  it('stays collapsed once collapsed, for the same import', () => {
    useWorkspaceStore.setState({ importSeq: useWorkspaceStore.getState().importSeq + 1 });
    const first = renderWithProviders(<LoadedBanner loaded={loaded} onClose={() => {}} />);
    fireEvent.click(toggle());
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    // Leaving the Design tab and coming back mounts the card again.
    first.unmount();
    renderWithProviders(<LoadedBanner loaded={loaded} onClose={() => {}} />);
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
  });

  it('leaves the setting alone for a design that was not just imported', () => {
    seedSettings({ showImportNotes: false });
    renderWithProviders(<LoadedBanner loaded={loaded} onClose={() => {}} />);
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
  });
});
