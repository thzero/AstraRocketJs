// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { ThrustChart } from '../../../src/components/sim/MotorDetail';
import { MotorComparePane } from '../../../src/components/sim/MotorComparePane';
import { MotorCombinePane } from '../../../src/components/sim/MotorCombinePane';
import { renderWithProviders } from '../../testing/renderWithProviders';
import type { CatalogMotor } from '../../../src/services/motors/motorDb';

const samples: [number, number][] = [
  [0, 0],
  [0.2, 12],
  [1, 5],
  [1.6, 0],
];
const motor = (designation: string): CatalogMotor =>
  ({
    manufacturer: 'Test',
    designation,
    code: designation,
    diameter: 0.018,
    length: 0.07,
    curves: [{ samples }],
  }) as unknown as CatalogMotor;

/** Every thrust chart is a named graphic, not a bare drawing a screen reader skips past unnamed. */
describe('thrust charts', () => {
  it('names the detail chart with its figures', () => {
    renderWithProviders(<ThrustChart samples={samples} avg={6} burn={1.6} />);
    const img = screen.getByRole('img');
    expect(img.getAttribute('aria-label')).toMatch(/^Thrust against time\. Peak .+, average .+, burn time 1\.60 s\.$/);
  });

  it('names the motors on the comparison chart', () => {
    renderWithProviders(<MotorComparePane motors={[motor('C6'), motor('D12')]} cols={[]} />);
    expect(screen.getByRole('img', { name: /Thrust curves of C6.*D12/ })).toBeTruthy();
  });

  it('names the cluster on the combined chart', () => {
    renderWithProviders(<MotorCombinePane motors={[motor('C6'), motor('D12')]} />);
    expect(screen.getByRole('img', { name: /Combined thrust curve of C6.*D12/ })).toBeTruthy();
  });
});
