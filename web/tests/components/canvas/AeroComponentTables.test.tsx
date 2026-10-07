// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import i18n from '../../../src/i18n';
import { StabilityTable } from '../../../src/components/canvas/AeroComponentTables';
import { renderWithProviders } from '../../testing/renderWithProviders';
import type { AeroSweep } from '../../../src/engine/openRocketEngine';

const sweep = {
  machs: [0.3],
  hasNozzle: false,
  cp: [0.4],
  cna: [10],
  components: [
    { key: 'n', name: 'Nose cone', cd: [0.1], cna: [2], cp: [0.05] },
    { key: 'f', name: 'Fins', cd: [0.2], cna: [8], cp: [0.5] },
  ],
} as unknown as AeroSweep;

const renderTable = () =>
  renderWithProviders(
    <StabilityTable
      sweep={sweep}
      machs={[0.3]}
      mach={0.3}
      masses={[]}
      lengthUnit="m"
      lengthFactor={1}
      massUnit="g"
      massFactor={1000}
      bodyLen={0.6}
      aeroLen={0.55}
    />,
  );

afterEach(async () => {
  await i18n.changeLanguage('en');
});

describe('StabilityTable', () => {
  it('labels the CP percentage columns with the same words as the chart toggle', async () => {
    await i18n.changeLanguage('de');
    renderTable();
    const heads = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(heads).toContain(`CP (${i18n.t('aero.pctBody')})`);
    expect(heads).toContain(`CP (${i18n.t('aero.pctLength')})`);
    expect(heads.some((h) => h?.includes('% body'))).toBe(false);
  });
});
