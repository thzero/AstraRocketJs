import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  buildFlightScene,
  indexForProgress,
  modelPoseAt,
  newModelPose,
  type PhaseColors,
} from '../../../src/components/canvas/flightScene';
import type { FlightResult, RocketTree } from '../../../src/engine/openRocketEngine';
import { findRecovery } from '../../../src/components/canvas/flightScene';
import { mergePalette } from '../../../src/services/design/partColors';
import { KERNEL_DEFAULTS } from '../../../src/tree/kernelDefaults';

// Three distinct primaries, so a point's phase is readable straight off its
// vertex color.
const phase: PhaseColors = { boost: '#ff0000', coast: '#00ff00', descent: '#0000ff' };
const RED = 0,
  GREEN = 1,
  BLUE = 2;
/** Which channel is lit, i.e. which phase this point was colored for. */
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
    expect(chan(s.colors[4]!)).toBe(GREEN); // before apogee: coast
    expect(chan(s.colors[6]!)).toBe(BLUE); // after: descent
  });

  /**
   * With no APOGEE event the fallback is a time, never the peak altitude. Read
   * as seconds, this flight's 300 m peak would put apogee at t = 300, past the
   * end of the flight, so the descent color would never appear and, because the
   * deployment time defaults to it, the recovery device would never come out
   * during playback either.
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

  it('colors the burn red up to BURNOUT', () => {
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
   * non-finite. Every row is then filtered out and `sp` is empty, so the callout
   * loop must not index into it: a throw inside the memo happens before the
   * component's own empty-state guard can render "no path", and takes the whole
   * app down.
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
    // The deployment time is still reported; only its duplicate label is gone.
    expect(s.deployT).toBe(5);
  });
});

describe('scaling', () => {
  it('normalizes peak altitude to 24 scene units', () => {
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

describe('indexForProgress', () => {
  /** A linear scan: the reference the binary search has to agree with. */
  const linear = (times: number[], progress: number) => {
    const n = times.length;
    const totalT = times[n - 1] || 1;
    let idx = 0;
    while (idx < n - 1 && times[idx + 1]! <= progress * totalT) idx++;
    return idx;
  };

  it('is 0 on the pad and the last sample at the end', () => {
    const times = [0, 0.1, 0.3, 0.7, 1.5, 4, 9];
    expect(indexForProgress(times, 0)).toBe(0);
    expect(indexForProgress(times, 1)).toBe(6);
    expect(indexForProgress(times, 2)).toBe(6);
  });

  it('maps by time, not by sample count', () => {
    // Half the flight in time is t = 4.5: index 5 (t = 4), not index 3.
    const times = [0, 0.1, 0.3, 0.7, 1.5, 4, 9];
    expect(indexForProgress(times, 0.5)).toBe(5);
  });

  it('agrees with the linear scan on random monotone sample times', () => {
    let seed = 42;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let trial = 0; trial < 200; trial++) {
      const n = 1 + Math.floor(rnd() * 50);
      const times: number[] = [];
      let t = 0;
      for (let i = 0; i < n; i++) {
        t += rnd() < 0.1 ? 0 : rnd();
        times.push(t);
      }
      for (const p of [0, 0.001, 0.25, 0.5, 0.999, 1, rnd(), rnd()]) {
        expect(indexForProgress(times, p)).toBe(linear(times, p));
      }
    }
  });

  it('handles an empty or single-sample series', () => {
    expect(indexForProgress([], 0.5)).toBe(0);
    expect(indexForProgress([3], 0.5)).toBe(0);
  });
});

describe('modelPoseAt', () => {
  const pts = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 3, 0), new THREE.Vector3(2, 5, 0)];

  it('sits on the pad at launch: lifted by half the model length along its up component', () => {
    const out = modelPoseAt(pts, 0, false, 2, newModelPose());
    // Tangent from pts[0] to pts[1] is (1,3)/|..|; dir.y = 3/sqrt(10).
    const dirY = 3 / Math.sqrt(10);
    expect(out.position.x).toBe(0);
    expect(out.position.y).toBeCloseTo(1 * dirY, 9);
    // The nose is half a model length along the flight direction.
    expect(out.nose.x).toBeCloseTo(1 / Math.sqrt(10), 9);
  });

  it('points the nose (local -X) along the path tangent', () => {
    const out = modelPoseAt(pts, 1, false, 2, newModelPose());
    const nose = new THREE.Vector3(-1, 0, 0).applyQuaternion(out.quaternion);
    const expected = new THREE.Vector3(2, 5, 0).normalize();
    expect(nose.x).toBeCloseTo(expected.x, 6);
    expect(nose.y).toBeCloseTo(expected.y, 6);
  });

  it('hangs nose-up once descending', () => {
    const out = modelPoseAt(pts, 2, true, 2, newModelPose());
    const nose = new THREE.Vector3(-1, 0, 0).applyQuaternion(out.quaternion);
    expect(nose.y).toBeCloseTo(1, 6);
    expect(out.nose.y).toBeCloseTo(out.position.y + 1, 9);
  });

  it('does not lift a point already above the ground', () => {
    const out = modelPoseAt(pts, 2, true, 2, newModelPose());
    expect(out.position.y).toBe(5);
  });

  it('survives an empty path', () => {
    expect(() => modelPoseAt([], 0, false, 2, newModelPose())).not.toThrow();
  });
});

/**
 * The recovery device the 3D flight shows is the first one in tree order, at
 * the size the kernel flies: a streamer with no length is the kernel's 0.5 m
 * (ComponentFactory, case "streamer").
 */
describe('findRecovery', () => {
  const tree = (kids: object[]) =>
    ({ components: [{ type: 'stage', id: 's', children: kids }] }) as unknown as RocketTree;

  it('sizes a keyless streamer at the kernel default', () => {
    const r = findRecovery(tree([{ type: 'streamer', id: 'st' }]), mergePalette({}));
    expect(r).toMatchObject({ kind: 'streamer', length: KERNEL_DEFAULTS.streamer.stripLength });
  });

  it('finds the first device in tree order, nested or not', () => {
    const r = findRecovery(
      tree([
        { type: 'bodytube', id: 'b', children: [{ type: 'parachute', id: 'p', diameter: 0.6 }] },
        { type: 'streamer', id: 'st' },
      ]),
      mergePalette({}),
    );
    expect(r).toMatchObject({ kind: 'parachute', diameter: 0.6 });
  });
});
