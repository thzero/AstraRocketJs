// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { SimSummary } from '../../../src/components/sim/SimSummary';
import { renderWithProviders } from '../../testing/renderWithProviders';
import { fmtNum, ladderDigits } from '../../../src/i18n/format';
import type { FlightResult } from '../../../src/engine/openRocketEngine';

const sim = (Px: (number | null)[], Py: (number | null)[]) =>
  ({
    summary: {
      maxAltitude: 100,
      maxVelocity: 50,
      maxAcceleration: 100,
      maxMachNumber: 0.2,
      timeToApogee: 4,
      flightTime: 30,
      groundHitVelocity: 5,
      launchRodVelocity: 20,
      deploymentVelocity: null,
      optimumDelay: null,
    },
    events: [],
    series: { time: [0, 1, 2], altitude: [0, 100, 0], Px, Py },
  }) as unknown as FlightResult;

/** The value line of the tile whose label is `label`. */
const tile = (label: string) => screen.getByText(label).nextElementSibling?.textContent;

describe('SimSummary downrange', () => {
  /**
   * The landing point is the last sample where BOTH halves are finite, as the
   * ground track reads it (groundTrack.landingPoint). Taking the last finite
   * east and the last finite north separately pairs numbers from two different
   * samples, and the tile then disagrees with the ground-track readout.
   */
  it('reads the landing from one sample, the way the ground track does', () => {
    renderWithProviders(<SimSummary sim={sim([0, 30, 40], [0, 40, null])} />);
    expect(tile('Downrange')).toBe('50.0');
  });
});

/**
 * A figure reads the same on its tile as in the simulations table: both take
 * the ladder's precision (`ladderDigits`), which follows the size of the number
 * in whatever unit the reader picked. The tiles fixed their own digits, so a
 * 6.2 m/s landing read "6.2" here and "6.20" in the table, and a fixed 0
 * digits would have turned 8.67 g into "9".
 */
describe('SimSummary figure precision', () => {
  it('formats each figure the way the simulations table does', () => {
    const flown = sim([0, 0, 0], [0, 0, 0]);
    Object.assign(flown.summary, {
      groundHitVelocity: 6.2,
      launchRodVelocity: 20,
      maxAcceleration: 85,
      maxVelocity: 50,
    });
    renderWithProviders(<SimSummary sim={flown} />);
    const ladder = (v: number) => fmtNum(v, ladderDigits(v));
    expect(tile('Landing')).toBe(ladder(6.2));
    expect(tile('Rod exit')).toBe(ladder(20));
    expect(tile('Max accel')).toBe(ladder(85));
    expect(tile('Max speed')).toBe(ladder(50));
  });
});
