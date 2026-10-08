// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '../../testing/renderWithProviders';
import type { CatalogMotor } from '../../../src/services/motors/motorDb';

/**
 * Desktop's "Hide very similar thrust curves": the curve dropdown leaves out a
 * motor's other curves the kernel's MotorCorrelation scores at 0.95 or more
 * against the one shown. The kernel call is stubbed with fixed scores.
 */
vi.mock('../../../src/engine/openRocketEngine', async (orig) => ({
  ...(await orig<object>()),
  // Curve "near" is a near duplicate of the first; "far" is not.
  motorSimilarity: (_a: unknown, b: [number, number][]) => (b[1]![1] === 11 ? 0.99 : 0.5),
}));
const { MotorDetail } = await import('../../../src/components/sim/MotorDetail');

const curve = (src: string, peak: number) => ({
  src,
  samples: [
    [0, 0],
    [0.1, peak],
    [0.8, 0],
  ] as [number, number][],
});
const motor = {
  designation: 'C6',
  manufacturer: 'Estes',
  class: 'C',
  diameter: 18,
  impulse: 9,
  burn: 1.8,
  mass: 24,
  curves: [curve('Certified · RASP', 10), curve('near', 11), curve('far', 20)],
} as CatalogMotor;

const options = () => [...(screen.getByRole('combobox') as HTMLSelectElement).options].map((o) => o.textContent);

describe('the curve choice', () => {
  beforeEach(() => localStorage.clear());

  it('hides near-duplicate curves by default, and shows them all when the box is cleared', () => {
    renderWithProviders(<MotorDetail motor={motor} curveIndex={0} onCurveChange={vi.fn()} />);
    expect(options()).toEqual(['Certified · RASP (3)', 'far (3)']);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Hide very similar thrust curves' }));
    expect(options()).toEqual(['Certified · RASP (3)', 'near (3)', 'far (3)']);
  });

  it('says when a motor is out of production', () => {
    renderWithProviders(<MotorDetail motor={{ ...motor, oop: true }} curveIndex={0} onCurveChange={vi.fn()} />);
    expect(screen.getByText('Out of production')).toBeTruthy();
  });
});
