import { describe, it, expect } from 'vitest';
import type { ComponentNode, StaticInfo } from '../engine/openRocketEngine';
import { stageParts, finSetPositions, multiStageSummaries, stageMotor } from './reportModel';

const node = (o: object): ComponentNode => o as unknown as ComponentNode;

const stage = node({
  type: 'stage',
  name: 'Sustainer',
  children: [
    node({ type: 'nosecone', id: 'nose', name: 'Nose', length: 0.1, outerRadius: 0.012 }),
    node({
      type: 'bodytube',
      id: 'body',
      name: 'Body',
      length: 0.2,
      outerRadius: 0.012,
      thickness: 0.0005,
      children: [node({ type: 'trapezoidfinset', id: 'fins', name: 'Fins', rootChord: 0.05 })],
    }),
  ],
});

// A mock engine handle: mass + positionX keyed by node id; a missing/unknown id throws.
const rocket = {
  componentInfo: (id: string) => {
    const mass: Record<string, number> = { nose: 0.01, body: 0.02, fins: 0.005 };
    const posX: Record<string, number> = { fins: 0.25 };
    if (!(id in mass) && !(id in posX)) throw new Error(`no such component ${id}`);
    return { mass: mass[id] ?? 0, positionX: posX[id] ?? 0 };
  },
};

describe('stageParts', () => {
  const rows = stageParts(stage, rocket);

  it('walks the stage subtree, excluding the stage node itself', () => {
    expect(rows.map((r) => r.type)).toEqual(['nosecone', 'bodytube', 'trapezoidfinset']);
  });
  it('indents nested parts by one depth level', () => {
    expect(rows.find((r) => r.type === 'bodytube')!.depth).toBe(0);
    expect(rows.find((r) => r.type === 'trapezoidfinset')!.depth).toBe(1); // inside the body tube
  });
  it('pulls each part mass from the engine handle', () => {
    expect(rows.find((r) => r.name === 'Nose')!.mass).toBeCloseTo(0.01, 9);
    expect(rows.find((r) => r.name === 'Fins')!.mass).toBeCloseTo(0.005, 9);
  });
  it('leaves mass 0 for a part the engine cannot weigh (no id / throw)', () => {
    const s = node({ type: 'stage', children: [node({ type: 'masscomponent', name: 'Ballast' })] }); // no id
    expect(stageParts(s, rocket)[0]!.mass).toBe(0);
  });
});

describe('finSetPositions', () => {
  // A swept freeform fin whose tip trailing corner overhangs the root: the root
  // chord is 0.06, but the furthest-aft point is 0.09. This used to report
  // bottomX from Math.max, overstating the root trailing edge by the 30 mm of
  // overhang — and disagreeing with the schematic, which has always used the
  // kernel's own last.x - first.x.
  it('spans a swept freeform fin by its ROOT chord, not its aftmost point', () => {
    const swept = node({
      type: 'stage',
      children: [
        node({
          type: 'bodytube',
          id: 'body',
          length: 0.2,
          outerRadius: 0.012,
          children: [
            node({
              type: 'freeformfinset',
              id: 'fins',
              name: 'Swept',
              points: [
                [0, 0],
                [0.04, 0.05],
                [0.09, 0.05],
                [0.06, 0],
              ],
            }),
          ],
        }),
      ],
    });
    const sets = finSetPositions(swept, rocket);
    expect(sets).toHaveLength(1);
    expect(sets[0]!.bottomX - sets[0]!.topX).toBeCloseTo(0.06, 9);
  });

  it('spans a fin from its root leading edge to leading+rootChord', () => {
    const sets = finSetPositions(stage, rocket);
    expect(sets).toHaveLength(1);
    expect(sets[0]!.name).toBe('Fins');
    expect(sets[0]!.topX).toBeCloseTo(0.25, 9);
    expect(sets[0]!.bottomX).toBeCloseTo(0.3, 9); // 0.25 + 0.05 rootChord
  });
  // This test used to assert 0.16 — it pinned `Math.max(...xs)` as the root
  // length, which is what the code did rather than what is correct, and so kept
  // the bug alive. These points are exactly the overhanging case: the outline
  // reaches 0.06 aft, but the root runs first.x -> last.x = 0.04, which is what
  // the kernel flies (FreeformFinSet.length = last.x - first.x).
  it('uses a freeform fin ROOT chord, not the outline max-x, as the root length', () => {
    const s = node({
      type: 'stage',
      children: [
        node({
          type: 'freeformfinset',
          id: 'fins',
          name: 'FF',
          points: [
            [0, 0],
            [0.06, 0.03],
            [0.04, 0],
          ],
        }),
      ],
    });
    const r = { componentInfo: () => ({ positionX: 0.1 }) };
    expect(finSetPositions(s, r)[0]!.bottomX).toBeCloseTo(0.14, 9); // 0.1 + 0.04
  });
  it('skips a fin set with no id, and one the engine cannot locate', () => {
    const s = node({
      type: 'stage',
      children: [
        node({ type: 'trapezoidfinset', name: 'no-id', rootChord: 0.05 }), // no id → skipped
        node({ type: 'trapezoidfinset', id: 'ghost', name: 'ghost', rootChord: 0.05 }), // throws → skipped
      ],
    });
    expect(finSetPositions(s, rocket)).toHaveLength(0);
  });
});

describe('multiStageSummaries', () => {
  const stages = [node({ type: 'stage', name: 'A' }), node({ type: 'stage', name: 'B' })];
  const stageName = (st: ComponentNode, i: number) => (st.name as string) || `Stage ${i + 1}`;
  const info = (mass: number) => ({ mass }) as unknown as StaticInfo;
  // The rebuilt whole-rocket handle the app should end up holding after the report.
  const whole = { info: info(99), handle: {} as never };

  it('returns one summary per stage and restores the whole-rocket handle once', () => {
    const restored: unknown[] = [];
    const out = multiStageSummaries(
      stages,
      stageName,
      (st) => info(st.name === 'A' ? 1 : 2),
      () => whole,
      (b) => restored.push(b),
    );
    expect(out.map((sm) => sm.label)).toEqual(['A', 'B']);
    expect(out.map((sm) => (sm.info as unknown as { mass: number }).mass)).toEqual([1, 2]);
    expect(restored).toEqual([whole]); // live handle restored exactly once
  });

  it('still restores the live handle when a stage build throws (finally)', () => {
    const restored: unknown[] = [];
    expect(() =>
      multiStageSummaries(
        stages,
        stageName,
        (st) => {
          if (st.name === 'B') throw new Error('bad stage');
          return info(1);
        },
        () => whole,
        (b) => restored.push(b),
      ),
    ).toThrow(/bad stage/);
    // The regression this refactor fixes: without the finally, a throwing stage
    // build would leave the app's live handle stranded on the last stage.
    expect(restored).toEqual([whole]);
  });
});

/**
 * Tube fins in the fin-position table.
 *
 * They belong here — OpenRocket's FinMarkingGuide collects TubeFinSet right
 * beside FinSet, and where a tube sits along the airframe is exactly as useful
 * to mark. What is NOT theirs is a root chord: the span is the tube's length.
 */
describe('finSetPositions — tube fins', () => {
  const rocket = { componentInfo: () => ({ positionX: 0.42 }) };
  const withTubes = (over: Record<string, unknown> = {}) =>
    node({
      type: 'stage',
      children: [
        node({
          type: 'bodytube',
          id: 'b',
          children: [node({ type: 'tubefinset', id: 'tf', name: 'Tube fins', length: 0.08, ...over })],
        }),
      ],
    });

  it('spans a tube fin by its LENGTH, not a rootChord it does not have', () => {
    const sets = finSetPositions(withTubes(), rocket);
    expect(sets).toHaveLength(1);
    expect(sets[0]!.name).toBe('Tube fins');
    expect(sets[0]!.topX).toBeCloseTo(0.42, 9);
    expect(sets[0]!.bottomX).toBeCloseTo(0.5, 9); // 0.42 + 0.08 length
    // Reading through `rootChord` gave every tube fin set the 0.05 m default.
    expect(sets[0]!.bottomX).not.toBeCloseTo(0.47, 6);
  });

  it('ignores a rootChord even when one is present on the node', () => {
    // An imported .ork could carry a stray attribute; the tube's length wins.
    const sets = finSetPositions(withTubes({ rootChord: 0.2 }), rocket);
    expect(sets[0]!.bottomX).toBeCloseTo(0.5, 9);
  });
});

/**
 * Each stage's summary must be built with the motor in THAT stage's mount.
 *
 * `buildConfiguredRocket` seats whatever motor it is handed into whatever
 * mount it finds in the tree it is given, and each per-stage summary is built
 * from a one-stage tree. Passing the active simulation's `motor` regardless
 * therefore put the SUSTAINER's motor in the booster, and the extra-motors
 * loop then skipped the booster's own motor because its id matched the mount
 * that had just been filled. The booster's mass and CG went into the PDF and
 * the `.ork` `<designinfo>` block describing a rocket that does not exist.
 */
describe('stageMotor', () => {
  const tree = (id: string) =>
    ({
      name: 'R',
      components: [node({ type: 'stage', children: [node({ type: 'bodytube', id, motorMount: true })] })],
    }) as never;

  const spec = (designation: string) => ({ designation }) as never;
  const active = {
    motor: spec('SUSTAINER-K550'),
    extraMotors: { boosterMount: { spec: spec('BOOSTER-M1350') } } as never,
  };

  it('gives the primary mount the active simulation motor', () => {
    expect(stageMotor(tree('sustainerMount'), 'sustainerMount', active)?.designation).toBe('SUSTAINER-K550');
  });

  it("gives a booster ITS OWN motor, not the sustainer's", () => {
    expect(stageMotor(tree('boosterMount'), 'sustainerMount', active)?.designation).toBe('BOOSTER-M1350');
  });

  it('seats nothing in a stage whose mount has no motor of its own', () => {
    expect(stageMotor(tree('emptyMount'), 'sustainerMount', active)).toBeUndefined();
  });

  it('seats nothing in a stage with no mount at all', () => {
    const noMount = { name: 'R', components: [node({ type: 'stage', children: [node({ type: 'bodytube' })] })] };
    expect(stageMotor(noMount as never, 'sustainerMount', active)).toBeUndefined();
  });
});
