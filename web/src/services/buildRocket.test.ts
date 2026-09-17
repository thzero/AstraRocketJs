import { describe, it, expect } from 'vitest';
import type { OpenRocketDesign, RocketTree, StaticInfo } from '../engine/openRocketEngine';
import { computeStaticInfo, flightKey } from './buildRocket';

const tree = { components: [] } as unknown as RocketTree;

// A stub engine handle: staticInfo() returns a fresh object; aeroSweep()'s
// power-off total drives the cd fill-in (or throws to exercise the fallback).
const fakeRocket = (opts: {
  info?: Partial<StaticInfo>;
  sweepTotal?: number[];
  sweepThrows?: boolean;
}): OpenRocketDesign =>
  ({
    staticInfo: () => ({ mass: 1, cg: 0.5, ...opts.info }) as StaticInfo,
    aeroSweep: () => {
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
    const rocket = {
      staticInfo: () => {
        throw new Error('kernel blew up');
      },
    } as unknown as OpenRocketDesign;
    const res = computeStaticInfo(tree, undefined, {}, undefined, () => rocket);
    expect(res).toEqual({ error: 'kernel blew up' });
  });
});

describe('flightKey', () => {
  const design = (): RocketTree => ({
    name: 'My Rocket',
    designer: 'Ada',
    comment: '',
    components: [{ type: 'nosecone', id: 'n1', name: 'Nose cone', length: 0.1 }],
  });

  // The whole point: these are the edits that used to throw away every
  // simulation result, because the store replaces the tree object for all of them.
  it('ignores the design metadata that is round-tripped but never flown', () => {
    const base = flightKey(design());
    expect(flightKey({ ...design(), designer: 'Grace' })).toBe(base);
    expect(flightKey({ ...design(), comment: 'a long note' })).toBe(base);
    expect(flightKey({ ...design(), revision: 'rev 2' })).toBe(base);
    expect(flightKey({ ...design(), designType: 'clone_kit' })).toBe(base);
    expect(flightKey({ ...design(), name: 'Renamed' })).toBe(base);
  });

  it('ignores a part rename, which changes a label and not a flight', () => {
    const renamed = design();
    renamed.components[0]!.name = 'Pointy end';
    expect(flightKey(renamed)).toBe(flightKey(design()));
  });

  it('changes for anything that can move a number', () => {
    const base = flightKey(design());

    const longer = design();
    longer.components[0]!.length = 0.2;
    expect(flightKey(longer)).not.toBe(base);

    const denser = design();
    denser.components[0]!.density = 900;
    expect(flightKey(denser)).not.toBe(base);

    const added = design();
    added.components.push({ type: 'bodytube', id: 'b1', length: 0.3 });
    expect(flightKey(added)).not.toBe(base);

    // Unknown fields count too: ComponentNode has an open index signature, so
    // anything we do not recognize is assumed to matter.
    const odd = design();
    (odd.components[0] as Record<string, unknown>)['someFutureParam'] = 3;
    expect(flightKey(odd)).not.toBe(base);
  });
});
