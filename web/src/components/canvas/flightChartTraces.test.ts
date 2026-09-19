import { describe, it, expect } from 'vitest';
import { buildTraces, visibleSeries, type ChartFlight } from './FlightChart';
import type { FlightResult, FlightSeries } from '../../engine/openRocketEngine';

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
    expect(only!.color).toBe('#38bdf8'); // sky, the original single line
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
   * The key carries the SIMULATION id, not just the branch index, so switching
   * the picker to another flight yields a different set of keys — which is what
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
 * Which panels are open is a preference now, so it survives a reload — and a
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
