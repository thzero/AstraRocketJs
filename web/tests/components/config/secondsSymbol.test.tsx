// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import i18n from '../../../src/i18n';
import { renderWithProviders } from '../../testing/renderWithProviders';
import { DeploymentSection } from '../../../src/components/config/DeploymentSection';
import { SeparationSection } from '../../../src/components/config/SeparationSection';
import { motorColumns, recoveryColumns, separationColumns } from '../../../src/components/config/configColumns';
import { newFlightConfig, type FlightConfig } from '../../../src/services/flight/flightConfigs';
import type { ComponentNode, RocketTree } from '../../../src/engine/openRocketEngine';
import type { FieldUnit } from '../../../src/prefs/useUnits';

/**
 * Every delay in the configuration editor and table is printed with the
 * reader's own seconds symbol. The expected symbol is the one each locale's
 * own flight summary prose already uses after a time (`flight.summaryEventAt`),
 * so the check holds for every language the app ships.
 */

const LANGS = ['de', 'en', 'es', 'fr', 'ja', 'nl', 'pl', 'pt-BR', 'pt-PT', 'ru'];

/** The first character after `{{time}}` in the locale's own "event at time" line. */
const secondsIn = (lang: string): string => {
  const file = join(__dirname, '../../../src/i18n/locales', `${lang}.json`);
  const line = (JSON.parse(readFileSync(file, 'utf8')) as { flight: { summaryEventAt: string } }).flight.summaryEventAt;
  return line.split('{{time}}')[1]!.trim()[0]!;
};

afterEach(async () => {
  cleanup();
  await act(() => i18n.changeLanguage('en'));
});

const device = { type: 'parachute', id: 'chute', name: 'Main', deployEvent: 'apogee', deployDelay: 0 } as ComponentNode;

const tree = {
  components: [
    {
      type: 'stage',
      id: 's1',
      children: [
        {
          type: 'bodytube',
          id: 'b1',
          motorMount: true,
          children: [device],
        },
      ],
    },
    { type: 'stage', id: 's2', separationEvent: 'ejection', children: [{ type: 'bodytube', id: 'b2' }] },
  ],
} as unknown as RocketTree;

const alt = () => ({ fmtSym: (v: number) => `${v} m` }) as unknown as FieldUnit;

describe('the seconds symbol in the configuration editor', () => {
  it('is in the reader’s locale in every shipped language', () => {
    // The symbols differ between at least two locales, so the check is not
    // satisfied by one fixed letter.
    expect(new Set(LANGS.map(secondsIn)).size).toBeGreaterThan(1);
  });

  it.each(LANGS)('follows the deploy delay field in %s', async (lang) => {
    await act(() => i18n.changeLanguage(lang));
    const config = { id: 'c', name: null, motors: {} } as FlightConfig;
    renderWithProviders(<DeploymentSection config={config} device={device} index={0} />);
    const units = [...document.querySelectorAll('span.min-w-6')].map((s) => s.textContent);
    expect(units).toContain(secondsIn(lang));
  });

  it.each(LANGS)('follows the separation delay field in %s', async (lang) => {
    await act(() => i18n.changeLanguage(lang));
    const config = { ...newFlightConfig(), id: 'c' } as FlightConfig;
    const stage = tree.components[1] as ComponentNode;
    renderWithProviders(<SeparationSection config={config} stage={stage} index={1} separates />);
    const units = [...document.querySelectorAll('span.min-w-6')].map((s) => s.textContent);
    expect(units).toContain(secondsIn(lang));
  });

  it.each(LANGS)('ends each delay in the table cells in %s', async (lang) => {
    await act(() => i18n.changeLanguage(lang));
    const t = i18n.t.bind(i18n);
    const config = {
      ...newFlightConfig(),
      motors: { b1: { spec: { designation: 'C6' }, ignitionEvent: 'launch', ignitionDelay: 2 } },
      deployments: { chute: { deployDelay: 1.5 } },
      separations: { s2: { separationDelay: 3 } },
    } as unknown as FlightConfig;
    const cells = [
      motorColumns(tree, t)[0]!.cell(config),
      recoveryColumns(tree, t, alt)[0]!.cell(config),
      separationColumns(tree, t, alt)[1]!.cell(config),
    ];
    for (const cell of cells) {
      const text = render(<>{cell}</>).container.textContent ?? '';
      expect(text).toMatch(new RegExp(`\\+[\\d.,]+${secondsIn(lang)}`));
      cleanup();
    }
  });
});

describe('the seconds symbol, by key', () => {
  it('is whatever the locale says, not a fixed letter', async () => {
    // A sentinel, so a hard-coded "s" cannot pass.
    const own = i18n.t('units.second');
    i18n.addResource('en', 'translation', 'units.second', 'sec');
    try {
      const config = { id: 'c', name: null, motors: {} } as FlightConfig;
      renderWithProviders(<DeploymentSection config={config} device={device} index={0} />);
      expect(screen.getAllByText('sec').length).toBeGreaterThan(0);
    } finally {
      i18n.addResource('en', 'translation', 'units.second', own);
    }
  });
});
