// @vitest-environment jsdom
// cspell:ignore nicht Katalog -- German, from the de locale the test reads in
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import i18n from '../../../src/i18n';
import { LoadedBanner } from '../../../src/components/canvas/LoadedBanner';
import { renderWithProviders, seedSettings } from '../../testing/renderWithProviders';
import { useWorkspaceStore } from '../../../src/state/store';
import { keyedNote } from '../../../src/services/files/importNote';
import { parseDesignFile } from '../../../src/services/files/designFile';
import { exportOrk } from '../../../src/services/files/orkFile';
import { wireLoadedOrk } from '../../../src/services/files/wireLoadedOrk';
import { defaultRocketTree } from '../../../src/services/design/defaultRocket';
import type { LoadedOrk } from '../../../src/services/files/loadOrk';
import type { LaunchConditions } from '../../../src/services/design/orkTree';
import en from '../../../src/i18n/locales/en.json';

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
 * then, with its data interpolated as is. A note stored as a plain string
 * shows exactly as stored.
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

/**
 * The card's label names the format the design came from, as the loader
 * sniffed it from the file's bytes (`parseDesignFile`): a RockSim file is not a
 * `.ork`. An import stored before the format was recorded is named without one.
 */
describe('LoadedBanner format label', () => {
  const rkt = `<?xml version="1.0"?><RockSimDocument><DesignInformation><RocketDesign><Name>R</Name><StageCount>1</StageCount><Stage3Parts><BodyTube><Name>T</Name><Len>100</Len><OD>20</OD><ID>19</ID></BodyTube></Stage3Parts></RocketDesign></DesignInformation></RockSimDocument>`;

  it.each([
    ['a RockSim file', () => parseDesignFile(rkt), '.rkt'],
    ['an OpenRocket file', () => parseDesignFile(exportOrk({ name: 'O', tree: defaultRocketTree() })), '.ork'],
  ])('names %s by its own extension', (_label, parse, ext) => {
    const res = parse();
    const { loadedMeta } = wireLoadedOrk(
      { ...res, configs: [{ id: 'c', name: null, motors: {} }], chosenConfigId: 'c' } as unknown as LoadedOrk,
      {} as LaunchConditions,
    );
    renderWithProviders(<LoadedBanner loaded={loadedMeta} onClose={() => {}} />);
    const label = screen.getByText(en.banner.loaded.replace('{{ext}}', ext));
    expect(label.textContent).toContain(ext);
  });

  it('names a stored import with no recorded format without an extension', () => {
    renderWithProviders(<LoadedBanner loaded={{ name: 'Old', notes: [] }} onClose={() => {}} />);
    expect(screen.getByText(en.banner.loadedFile)).toBeTruthy();
    expect(screen.queryByText(/\.ork|\.rkt/)).toBeNull();
  });
});
