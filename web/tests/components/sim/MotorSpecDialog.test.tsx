// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { MotorSpecDialog } from '../../../src/components/sim/MotorSpecDialog';
import { MotorDetail } from '../../../src/components/sim/MotorDetail';
import { renderWithProviders } from '../../testing/renderWithProviders';
import type { MotorSpec } from '../../../src/engine/openRocketEngine';
import type { CatalogMotor } from '../../../src/services/motors/motorDb';

/**
 * Initial thrust is the app's own figure from the curve, not a kernel or
 * catalog statistic, and the motor's spec dialog marks it as calculated the way
 * the picker's detail pane does.
 */

const samples: [number, number][] = [
  [0, 0],
  [0.1, 12],
  [1.8, 0],
];

const spec: MotorSpec = {
  designation: 'C6',
  manufacturer: 'Estes',
  diameter: 0.018,
  length: 0.07,
  times: samples.map((s) => s[0]),
  thrusts: samples.map((s) => s[1]),
  masses: [0.024, 0.024, 0.012],
  cgX: 0.035,
  ejectionDelay: 5,
};

const catalog = {
  designation: 'C6',
  manufacturer: 'Estes',
  class: 'C',
  diameter: 18,
  impulse: 9,
  burn: 1.8,
  mass: 24,
  curves: [{ src: 'Certified · RASP', samples }],
} as CatalogMotor;

/** The term that names initial thrust, whatever mark follows it. */
const initialLabel = () => screen.getByText(/^Initial thrust/).textContent;

describe('initial thrust in the motor spec dialog', () => {
  it('is labeled and noted as calculated, as in the detail pane', () => {
    const { unmount } = renderWithProviders(<MotorDetail motor={catalog} curveIndex={0} onCurveChange={vi.fn()} />);
    const detail = initialLabel();
    unmount();
    renderWithProviders(<MotorSpecDialog motor={spec} onClose={vi.fn()} />);
    expect(initialLabel()).toBe(detail);
    expect(screen.getByText(/^\* Initial thrust is calculated/)).toBeTruthy();
  });
});
