import { describe, expect, it } from 'vitest';
import { flightDataCsv } from '../../../src/services/exports/csvExport';
import { kernelComponentName } from '../../../src/services/app/warningText';
import { METRIC_UNITS } from '../../../src/prefs/units';
import type { ComponentNode, FlightResult } from '../../../src/engine/openRocketEngine';

/** A two-branch result whose second branch carries `name`. */
const result = (name: string) =>
  ({
    branches: [
      { name: 'Sustainer', series: { time: [0, 1] }, events: [] },
      { name, series: { time: [0, 1] }, events: [] },
    ],
  }) as unknown as FlightResult;

const stageLine = (name: string) =>
  flightDataCsv(result(name), METRIC_UNITS, { columns: ['time'], separator: ',', branchIndex: 1 }, 'Flight')
    .split('\r\n')
    .find((l) => l.startsWith('# Stage:'));

describe('the flight data CSV stage comment', () => {
  it('numbers a stage that flies under the kernel default name', () => {
    // The name the kernel gives a stage nobody named (RocketComponent.setName).
    const unnamed = kernelComponentName({ type: 'stage' } as ComponentNode);
    expect(stageLine(unnamed)).toBe('# Stage: Stage 2');
  });

  it('keeps a stage name the user typed', () => {
    expect(stageLine('Booster')).toBe('# Stage: Booster');
  });
});
