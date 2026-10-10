import { describe, it, expect } from 'vitest';
import { buildTraces, visibleSeries, type ChartFlight } from '../../../src/components/canvas/FlightChart';
import { SERIES, traceScale, traceUnit } from '../../../src/components/canvas/flightChartTraces';
import type { FlightResult, FlightSeries } from '../../../src/engine/openRocketEngine';

const series = (time: number[]) => ({ time, altitude: time.map((t) => t) }) as unknown as FlightSeries;

/** One flight, optionally staged: `stages` names its branches. */
const flight = (id: string, name: string, stages?: string[]): ChartFlight => ({
  id,
  name,
  result: {
    summary: { flightTime: 10 },
    events: [{ type: 'APOGEE', time: 5 }],
    series: series([0, 1, 2]),
    branches: stages?.map((s) => ({ name: s, events: [], series: series([0, 1, 2]) })),
  } as unknown as FlightResult,
});

const stageLabel = (i: number) => `Stage ${i + 1}`;

/**
 * The lines drawn for one flight: one per branch.
 *
 * A staged rocket separates, and each stage flies its own trajectory on the same
 * launch clock. The Results tab shows one flight at a time (the picker chooses
 * which), so a trace is a branch rather than a (flight, branch) pair.
 */
describe('buildTraces', () => {
  it('collapses an unstaged flight to one line', () => {
    const [only, ...rest] = buildTraces(flight('a', 'Simulation 1'), stageLabel);
    expect(rest).toEqual([]);
    // Named for the stage, not the simulation: the pane heading already says
    // which simulation this is.
    expect(only!.name).toBe('Stage 1');
    expect(only!.color).toBe('var(--c-series-1)'); // the first series color
  });

  it('gives each stage its own name and color', () => {
    const traces = buildTraces(flight('a', 'Simulation 1', ['Sustainer', 'Booster']), stageLabel);
    expect(traces.map((x) => x.name)).toEqual(['Sustainer', 'Booster']);
    expect(traces[0]!.color).not.toBe(traces[1]!.color);
  });

  it('falls back to a numbered stage when the engine did not name the branch', () => {
    const traces = buildTraces(flight('a', 'Simulation 1', ['', '']), stageLabel);
    expect(traces.map((x) => x.name)).toEqual(['Stage 1', 'Stage 2']);
  });

  /**
   * The key carries the simulation id, not just the branch index, so switching
   * the picker to another flight yields a different set of keys, which is what
   * makes the chart reset its trace selection instead of carrying one flight's
   * choice onto another's stages.
   */
  it('keys a trace by its flight as well as its branch', () => {
    const a = buildTraces(flight('a', 'C6', ['S', 'B']), stageLabel).map((x) => x.key);
    const b = buildTraces(flight('b', 'D12', ['S', 'B']), stageLabel).map((x) => x.key);
    expect(new Set([...a, ...b]).size).toBe(4);
  });

  it('draws nothing at all when there is no flight', () => {
    expect(buildTraces(null, stageLabel)).toEqual([]);
  });
});

/**
 * The saved panel choice.
 *
 * Which panels are open is a preference, so it survives a reload, and a
 * preference written by a different build can name a series this one does not
 * have. Dropping the unknown ones costs a panel; trusting them would put an
 * empty panel on screen, or blank the chart entirely.
 */
describe('visibleSeries', () => {
  it('keeps the keys it knows', () => {
    expect(visibleSeries(['altitude', 'thrust'])).toEqual(['altitude', 'thrust']);
  });

  it('drops a key this build does not have', () => {
    expect(visibleSeries(['altitude', 'sideslip', 'mach'])).toEqual(['altitude', 'mach']);
  });

  it('returns the panels in chart order, not the order they were saved in', () => {
    // Otherwise the stack would reshuffle depending on the order you ticked
    // them in, which is not something anyone chose.
    expect(visibleSeries(['mach', 'altitude'])).toEqual(['altitude', 'mach']);
  });

  it('allows an empty choice, which is every panel closed', () => {
    // Deliberate rather than broken: the chips are how you get one back.
    expect(visibleSeries([])).toEqual([]);
  });

  it('ignores a duplicate rather than drawing the panel twice', () => {
    expect(visibleSeries(['altitude', 'altitude'])).toEqual(['altitude']);
  });
});

describe('the derived panels', () => {
  it('ride on each line as series of their own', () => {
    const s = {
      time: [0, 1],
      altitude: [0, 10],
      velocity: [0, 20],
      mach: [0, 0.1],
      aoa: [0, 0.2],
      ρ: [1.2, 1.2],
      Vs: [340, 340],
      dΦ: [0, 3],
    } as unknown as FlightSeries;
    const [line] = buildTraces(
      { id: 'a', name: 'A', result: { summary: { flightTime: 1 }, events: [], series: s } as unknown as FlightResult },
      stageLabel,
    );
    const q = 0.5 * 1.2 * 34 * 34;
    expect(line!.series.dynamicPressure).toEqual([0, q]);
    expect(line!.series.qAlpha![1]).toBeCloseTo(q * 0.2, 9);
    expect(line!.series.rollRate).toEqual([0, 3]);
  });

  it('leaves them absent when the run lacks their inputs', () => {
    const [line] = buildTraces(flight('a', 'A'), stageLabel);
    expect(line!.series.dynamicPressure).toBeUndefined();
    expect(line!.series.rollRate).toBeUndefined();
  });

  it('can be chosen like any other panel', () => {
    expect(visibleSeries(['velocityAltitude', 'rollRate', 'qAlpha', 'dynamicPressure'])).toEqual([
      'dynamicPressure',
      'qAlpha',
      'rollRate',
      'velocityAltitude',
    ]);
  });
});

/**
 * q·α is a pressure times an angle, so its panel reads in the reader's pressure
 * unit times their angle unit rather than a fixed kPa·°.
 */
describe('a product series', () => {
  it('takes its scale and label from both preferences', () => {
    const qa = SERIES.find((m) => m.key === 'qAlpha')!;
    const factors: Record<string, number> = { pressure: 1 / 6894.75729, angle: 180 / Math.PI };
    const symbols: Record<string, string> = { pressure: 'psi', angle: '°' };
    const u = { factor: (q: string) => factors[q]!, sym: (q: string) => symbols[q]! };
    expect(traceScale(qa, u as never)).toBeCloseTo(180 / Math.PI / 6894.75729, 12);
    expect(traceUnit(qa, u as never)).toBe('psi·°');
  });
});
