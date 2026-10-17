// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act, screen } from '@testing-library/react';
import i18n from '../../../src/i18n';
import ja from '../../../src/i18n/locales/ja.json';
import { SimTab } from '../../../src/components/layout/SettingsTabs';
import { SimEditor } from '../../../src/components/sim/SimEditor';
import { useWorkspaceStore } from '../../../src/state/store';
import { renderWithProviders } from '../../testing/renderWithProviders';

// jsdom has no matchMedia; the editor asks for the desktop width.
window.matchMedia = ((query: string) => ({
  matches: true,
  media: query,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
})) as unknown as typeof window.matchMedia;

afterEach(async () => {
  act(() => useWorkspaceStore.getState().clearSimPrefs());
  localStorage.clear();
  await i18n.changeLanguage('en');
});

/**
 * The time step and the maximum time are seconds in the language the app is
 * shown in: Japanese writes the unit 秒, not the Latin s.
 */
describe.each([
  ['the Settings simulation tab', () => <SimTab />],
  ['the simulation editor', () => <SimEditor />],
])('%s', (_name, ui) => {
  it('writes the seconds of the time step and the maximum time in the UI language', async () => {
    await i18n.changeLanguage('ja');
    renderWithProviders(ui());
    for (const label of [ja.settings.timeStep, ja.settings.maxTime]) {
      const box = screen.getByRole('spinbutton', { name: label });
      const row = box.closest('label, div')!.parentElement!;
      const units = [...row.querySelectorAll('*')].map((e) => e.textContent).filter((x) => x === ja.units.second);
      expect(units.length).toBeGreaterThan(0);
      expect([...row.querySelectorAll('*')].some((e) => e.childElementCount === 0 && e.textContent === 's')).toBe(
        false,
      );
    }
  });
});
