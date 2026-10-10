// @vitest-environment jsdom
// cspell:ignore nicht Katalog -- German, from the de locale the test reads in
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import i18n from '../../../src/i18n';
import { LoadedBanner } from '../../../src/components/canvas/LoadedBanner';
import { renderWithProviders, seedSettings } from '../../testing/renderWithProviders';
import { useWorkspaceStore } from '../../../src/state/store';
import { keyedNote } from '../../../src/services/files/importNote';

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

/**
 * A keyed note is translated when the card renders, in the language showing
 * then, with its data interpolated as is. A plain string is what a workspace
 * saved by an earlier build holds, and it shows exactly as stored.
 */
describe('LoadedBanner note text', () => {
  const notes = {
    name: 'Rocket',
    notes: [keyedNote('importNote.motorNotInCatalog', { motor: 'K550W' }), 'A note saved as English text.'],
  };

  afterEach(() => act(() => void i18n.changeLanguage('en')));

  it('renders a keyed note in English, with its values', () => {
    seedSettings({ showImportNotes: true });
    renderWithProviders(<LoadedBanner loaded={notes} onClose={() => {}} />);
    expect(screen.getByText(/Motor "K550W" isn't in the catalog\. Pick a motor for that mount/)).toBeTruthy();
    expect(screen.getByText(/A note saved as English text\./)).toBeTruthy();
  });

  it('renders a keyed note in the current language and a plain-string note unchanged', async () => {
    seedSettings({ showImportNotes: true });
    await act(() => i18n.changeLanguage('de'));
    renderWithProviders(<LoadedBanner loaded={notes} onClose={() => {}} />);
    expect(screen.getByText(/Motor „K550W“ ist nicht im Katalog\./)).toBeTruthy();
    expect(screen.getByText(/A note saved as English text\./)).toBeTruthy();
    expect(screen.queryByText(/importNote\./)).toBeNull();
  });
});

/**
 * The design-name button is named by the name it shows, with the action after
 * it: a voice command that says the visible name has to reach it (WCAG 2.5.3),
 * and a screen reader has to hear which design this is.
 */
describe('LoadedBanner design name', () => {
  it('keeps the visible name in the button name, followed by the action', () => {
    const st = useWorkspaceStore.getState();
    useWorkspaceStore.setState({ tree: { ...st.tree, name: 'Alpha Rocket' } });
    renderWithProviders(<LoadedBanner loaded={null} onClose={() => {}} />);
    const btn = screen.getByRole('button', { name: /Alpha Rocket/ });
    expect(btn.textContent).toContain('Alpha Rocket');
    expect(screen.getByRole('button', { name: /Edit rocket configuration/ })).toBe(btn);
  });
});
