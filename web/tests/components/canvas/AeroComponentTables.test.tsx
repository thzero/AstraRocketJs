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

/**
 * Per-component figures keep their meaning in coarse units: a CP of 0.523 m is
 * not "0.5", and a 47 g part in kilograms is not "0.0".
 */
describe('StabilityTable precision', () => {
  const precise = {
    ...sweep,
    components: [{ key: 'f', name: 'Fins', cd: [0.2], cna: [8], cp: [0.523] }],
  } as unknown as AeroSweep;

  it('resolves positions in meters and masses in kilograms', () => {
    renderWithProviders(
      <StabilityTable
        sweep={precise}
        machs={[0.3]}
        mach={0.3}
        masses={[{ key: 'f', name: 'Fins', eachMass: 0.0157, mass: 0.0473, cg: 0.5 }]}
        lengthUnit="m"
        lengthFactor={1}
        massUnit="kg"
        massFactor={1}
        bodyLen={0.6}
        aeroLen={0.55}
      />,
    );
    const cells = screen.getAllByRole('cell').map((c) => c.textContent);
    expect(cells).toContain('0.5230');
    expect(cells).toContain('0.0473');
  });
});

/**
 * A part the user never named arrives as the kernel's bundle key and reads as
 * the app's own name for that part type, in the reader's language: the name the
 * tree gives it, not the kernel's English class name.
 */
describe('StabilityTable names', () => {
  it('translates a part the user never named', async () => {
    await i18n.changeLanguage('es');
    const unnamed = {
      ...sweep,
      components: [{ key: 'b', name: '[BodyTube.BodyTube]', cd: [0.1], cna: [2], cp: [0.3] }],
    } as unknown as AeroSweep;
    renderWithProviders(
      <StabilityTable
        sweep={unnamed}
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
    expect(screen.getByText(i18n.t('part.bodytube'))).toBeTruthy();
    expect(screen.queryByText('Body Tube')).toBeNull();
  });
});
