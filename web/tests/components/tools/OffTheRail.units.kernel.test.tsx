// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import i18n from '../../../src/i18n';
import { __setEngineForTests } from '../../../src/engine/openRocketEngine';
import { loadEngine } from '../../testing/kernelGeometry';
import { KERNEL_TEST_TIMEOUT_MS } from '../../testing/kernelTimeout';
import { renderWithProviders, seedSettings } from '../../testing/renderWithProviders';

vi.setConfig({ testTimeout: KERNEL_TEST_TIMEOUT_MS, hookTimeout: KERNEL_TEST_TIMEOUT_MS });

/** 10 N for a second: enough to leave a 1 m rail with a 0.5 kg rocket. */
const MOTOR = vi.hoisted(() => ({
  designation: 'T10',
  times: [0, 1],
  thrusts: [10, 10],
  masses: [0.02, 0.02],
}));

// The tool keeps its inputs in a module slot; this one starts with a motor
// loaded, so the results block renders without driving the motor picker.
vi.mock('../../../src/components/tools/remembered', async (orig) => {
  const m = await orig<typeof import('../../../src/components/tools/remembered')>();
  return {
    ...m,
    rememberedSlot: <T,>() => {
      const slot = m.rememberedSlot<T>();
      slot.value = { motor: MOTOR } as unknown as Partial<T>;
      return slot;
    },
  };
});

import { OffTheRail } from '../../../src/components/tools/OffTheRail';

/**
 * The off-the-rail figures are printed with the reader's own seconds symbol and
 * ratio form. The expected seconds symbol is the one each locale's flight
 * summary already prints after a time (`flight.summaryEventAt`).
 */

const LANGS = ['de', 'en', 'es', 'fr', 'ja', 'nl', 'pl', 'pt-BR', 'pt-PT', 'ru'];

const localeOf = (lang: string) =>
  JSON.parse(readFileSync(join(__dirname, '../../../src/i18n/locales', `${lang}.json`), 'utf8')) as {
    flight: { summaryEventAt: string };
    rail: { exitTime: string };
  };
const secondsIn = (lang: string) => localeOf(lang).flight.summaryEventAt.split('{{time}}')[1]!.trim()[0]!;

beforeAll(async () => {
  __setEngineForTests(await loadEngine());
});

afterEach(async () => {
  cleanup();
  localStorage.clear();
  await act(() => i18n.changeLanguage('en'));
});

/** The value beside a result label. */
const statValue = (label: string) => screen.getByText(label).nextElementSibling?.textContent ?? '';

describe('the off-the-rail figures', () => {
  it.each(LANGS)('print the time to leave the rail in %s seconds', async (lang) => {
    await act(() => i18n.changeLanguage(lang));
    renderWithProviders(<OffTheRail />);
    const value = statValue(localeOf(lang).rail.exitTime);
    expect(value).toMatch(new RegExp(`^[\\d.,]+\\s${secondsIn(lang)}$`));
  });

  it('print a thrust to weight ratio in the locale’s ratio form', () => {
    // A sentinel, so a hard-coded " : 1" cannot pass.
    const own = i18n.getResource('en', 'translation', 'units.ratio') as string;
    i18n.addResource('en', 'translation', 'units.ratio', '1 to {{ratio}}');
    try {
      renderWithProviders(<OffTheRail />);
      expect(statValue(i18n.t('rail.twrPeak'))).toMatch(/^1 to [\d.,]+$/);
    } finally {
      i18n.addResource('en', 'translation', 'units.ratio', own);
    }
  });
});

describe('the weathercock figures', () => {
  it('print the angle in the angle unit', () => {
    seedSettings({ units: { angle: 'rad' } });
    renderWithProviders(<OffTheRail />);
    const wind = screen.getByRole('spinbutton', { name: /Wind speed/ });
    fireEvent.change(wind, { target: { value: '5' } });
    fireEvent.blur(wind);
    expect(statValue('Weathercock angle')).toMatch(/^[\d.,]+ rad( |$)/);
  });
});

describe('the weathercock limit', () => {
  it('prints in the angle unit, in the label and in the rules note', () => {
    seedSettings({ units: { angle: 'rad' } });
    renderWithProviders(<OffTheRail />);
    // 20 degrees.
    expect(screen.getByText('Strongest wind under 0.35 rad')).toBeTruthy();
    expect(screen.getByText(/or a weathercock angle over 0.35 rad/)).toBeTruthy();
  });
});
