import { describe, it, expect } from 'vitest';
import { buildFlightScene, type PhaseColors } from './flightScene';
import type { FlightResult } from '../../engine/openRocketEngine';

// Three distinct primaries, so a point's phase is readable straight off its
// vertex colour.
const phase: PhaseColors = { boost: '#ff0000', coast: '#00ff00', descent: '#0000ff' };
const RED = 0,
  GREEN = 1,
  BLUE = 2;
/** Which channel is lit — i.e. which phase this point was coloured for. */
const chan = (c: [number, number, number]) => c.indexOf(Math.max(...c));

const result = (over: {
  time?: number[];
  altitude?: number[];
  events?: { type: string; time: number }[];
  timeToApogee?: number;
}): FlightResult =>
  ({
    summary: { timeToApogee: over.timeToApogee },
    events: over.events ?? [],
    series: {
      time: over.time ?? [],
      altitude: over.altitude ?? [],
      velocity: (over.time ?? []).map(() => 10),
      Px: (over.time ?? []).map(() => 0),
      Py: (over.time ?? []).map(() => 0),
    },
  }) as unknown as FlightResult;

/** A 0..10 s arc peaking at 300 m at t=5. */
const arc = () => {
  const time = Array.from({ length: 11 }, (_, i) => i);
  const altitude = time.map((t) => 300 - 12 * (t - 5) ** 2);
  return { time, altitude };
};

describe('apogee time fallback', () => {
  it('uses the APOGEE event when there is one', () => {
    const s = buildFlightScene(result({ ...arc(), events: [{ type: 'APOGEE', time: 5 }] }), phase);
    expect(chan(s.colors[4]!)).toBe(GREEN); // before apogee — coast
    expect(chan(s.colors[6]!)).toBe(BLUE); // after — descent
  });

  /**
   * The bug: with no APOGEE event the fallback was `maxA`, the peak ALTITUDE in
   * metres, read as a TIME in seconds. For this 300 m / 10 s flight apogee
   * landed at t = 300 — past the end of the flight — so the descent colour
   * never appeared and, because the deployment time defaults to it, the
   * recovery device never came out during playback either.
   */
  it('falls back to the last sample time, not the peak altitude', () => {
    const s = buildFlightScene(result({ ...arc() }), phase);
    expect(s.deployT).toBe(10); // the flight's last sample, not its 300 m peak
    expect(s.callouts.find((c) => c.type === 'APOGEE')!.time).toBe(10);
  });

  it('prefers the summary time to the last sample', () => {
    const s = buildFlightScene(result({ ...arc(), timeToApogee: 5 }), phase);
    expect(chan(s.colors[6]!)).toBe(BLUE);
  });

  it('colours the burn red up to BURNOUT', () => {
    const s = buildFlightScene(
      result({
        ...arc(),
        events: [
          { type: 'BURNOUT', time: 2 },
          { type: 'APOGEE', time: 5 },
        ],
      }),
      phase,
    );
    expect(chan(s.colors[1]!)).toBe(RED);
    expect(chan(s.colors[3]!)).toBe(GREEN);
  });
});

describe('the empty-path guard', () => {
  /**
   * A kernel failure can still hand back a result object whose samples are all
   * non-finite. Every row is then filtered out and `sp` is empty — but the
   * callout loop indexed it with a `!` and called `.distanceTo` on undefined,
   * throwing inside the memo, i.e. BEFORE the component's own empty-state
   * guard could render "no path". The whole app went down.
   */
  it('returns an empty scene instead of throwing when every sample is non-finite', () => {
    const s = buildFlightScene(
      result({
        time: [NaN, NaN, NaN],
        altitude: [NaN, NaN, NaN],
        events: [
          { type: 'BURNOUT', time: 1 },
          { type: 'APOGEE', time: 2 },
          { type: 'GROUND_HIT', time: 3 },
        ],
      }),
      phase,
    );
    expect(s.scenePts).toEqual([]);
    expect(s.callouts).toEqual([]);
  });

  it('survives a result with no samples at all', () => {
    expect(() => buildFlightScene(result({}), phase)).not.toThrow();
    expect(buildFlightScene(result({}), phase).scenePts).toEqual([]);
  });

  it('drops only the non-finite samples when some are good', () => {
    const s = buildFlightScene(result({ time: [0, NaN, 2], altitude: [0, 100, 50] }), phase);
    expect(s.times).toEqual([0, 2]);
    expect(s.alts).toEqual([0, 50]);
  });
});

describe('callouts', () => {
  it('anchors each event to its nearest sample', () => {
    const s = buildFlightScene(
      result({
        ...arc(),
        events: [
          { type: 'BURNOUT', time: 2 },
          { type: 'APOGEE', time: 5 },
          { type: 'GROUND_HIT', time: 10 },
        ],
      }),
      phase,
    );
    expect(s.callouts.map((c) => c.type)).toEqual(['BURNOUT', 'APOGEE', 'GROUND_HIT']);
    expect(s.burnoutT).toBe(2);
  });

  it('drops a label that would sit on top of another', () => {
    // Deployment right at apogee: one marker, not two stacked in the same spot.
    const s = buildFlightScene(
      result({
        ...arc(),
        events: [
          { type: 'APOGEE', time: 5 },
          { type: 'RECOVERY_DEVICE_DEPLOYMENT', time: 5 },
        ],
      }),
      phase,
    );
    expect(s.callouts.filter((c) => c.time === 5)).toHaveLength(1);
    // The deployment TIME is still reported — only its duplicate label is gone.
    expect(s.deployT).toBe(5);
  });
});

describe('scaling', () => {
  it('normalises peak altitude to 24 scene units', () => {
    const s = buildFlightScene(result({ ...arc() }), phase);
    expect(s.scenePts[s.apogeeIdx]!.y).toBeCloseTo(24, 6);
    expect(s.apogeeIdx).toBe(5);
  });

  it('does not blow up on a very long flight', () => {
    // 200k samples: Math.max(...rows) would exceed the call-argument limit.
    const time = Array.from({ length: 200_000 }, (_, i) => i * 0.001);
    const altitude = time.map((t) => t * 10);
    expect(() => buildFlightScene(result({ time, altitude }), phase)).not.toThrow();
  });
});
