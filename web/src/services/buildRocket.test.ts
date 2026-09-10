import { describe, it, expect } from 'vitest';
import type { OpenRocketDesign, RocketTree, StaticInfo } from '../engine/openRocketEngine';
import { computeStaticInfo } from './buildRocket';

const tree = { components: [] } as unknown as RocketTree;

// A stub engine handle: staticInfo() returns a fresh object; dragSweep()'s
// power-off total drives the cd fill-in (or throws to exercise the fallback).
const fakeRocket = (opts: { info?: Partial<StaticInfo>; sweepTotal?: number[]; sweepThrows?: boolean }): OpenRocketDesign =>
  ({
    staticInfo: () => ({ mass: 1, cg: 0.5, ...opts.info }) as StaticInfo,
    dragSweep: () => {
      if (opts.sweepThrows) throw new Error('sweep failed');
      return { powerOff: { total: opts.sweepTotal ?? [] } };
    },
  }) as unknown as OpenRocketDesign;

describe('computeStaticInfo', () => {
  it('returns the static info + live handle and fills cd from the Mach-0.3 sweep', () => {
    const rocket = fakeRocket({ sweepTotal: [0.42] });
    const res = computeStaticInfo(tree, undefined, {}, undefined, () => rocket);
    expect('error' in res).toBe(false);
    if ('error' in res) return;
    expect(res.rocket).toBe(rocket); // the live handle the app installs
    expect(res.info.cd).toBeCloseTo(0.42, 9);
  });

  it('leaves cd undefined when the drag sweep throws (best-effort)', () => {
    const res = computeStaticInfo(tree, undefined, {}, undefined, () => fakeRocket({ sweepThrows: true }));
    expect('error' in res).toBe(false);
    if ('error' in res) return;
    expect(res.info.cd).toBeUndefined(); // sweep failure doesn't fail the whole build
    expect(res.info.mass).toBe(1); // static info still returned
  });

  it('returns an error message when the build throws, instead of throwing', () => {
    const res = computeStaticInfo(tree, undefined, {}, undefined, () => {
      throw new Error('bad geometry');
    });
    expect(res).toEqual({ error: 'bad geometry' });
  });

  it('returns an error when staticInfo() itself throws', () => {
    const rocket = { staticInfo: () => { throw new Error('kernel blew up'); } } as unknown as OpenRocketDesign;
    const res = computeStaticInfo(tree, undefined, {}, undefined, () => rocket);
    expect(res).toEqual({ error: 'kernel blew up' });
  });
});
