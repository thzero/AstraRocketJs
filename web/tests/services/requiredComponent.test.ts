import { describe, it, expect } from 'vitest';
import { badDimensions, isDimension, REQUIRED_COMPONENT_FIELDS } from '../../src/services/requiredComponent';
import { designBlocker, designBlockerText } from '../../src/services/runnability';
import type { RocketTree } from '../../src/engine/openRocketEngine';

const tree = (over: Record<string, unknown> = {}): RocketTree =>
  ({
    components: [
      {
        id: 'stage1',
        type: 'stage',
        children: [
          { id: 'nose', type: 'nosecone', name: 'Nose cone', length: 0.1, aftRadius: 0.013, thickness: 0.001 },
          {
            id: 'tube',
            type: 'bodytube',
            name: 'Body tube',
            length: 0.2,
            outerRadius: 0.013,
            thickness: 0.0005,
            motorMount: true,
            children: [
              {
                id: 'fins',
                type: 'trapezoidfinset',
                name: 'Fins',
                finCount: 3,
                rootChord: 0.06,
                tipChord: 0, // a delta fin — legitimately zero
                sweep: 0, // unswept — legitimately zero
                height: 0.05,
                thickness: 0.003,
                ...(over.fins ?? {}),
              },
            ],
            ...(over.tube ?? {}),
          },
        ],
      },
    ],
  }) as unknown as RocketTree;

const t = (key: string, vars?: Record<string, unknown>) =>
  `${key}${
    vars
      ? `(${Object.entries(vars)
          .map(([k, v]) => `${k}=${String(v)}`)
          .join(',')})`
      : ''
  }`;

describe('isDimension', () => {
  it('accepts only a real positive number', () => {
    expect(isDimension(0.05)).toBe(true);
    expect(isDimension(0)).toBe(false); // the whole point
    expect(isDimension(-1)).toBe(false);
    expect(isDimension(null)).toBe(false);
    expect(isDimension(undefined)).toBe(false);
    expect(isDimension(NaN)).toBe(false);
    expect(isDimension('0.05')).toBe(false);
  });
});

describe('badDimensions', () => {
  it('finds nothing in a healthy design', () => {
    expect(badDimensions(tree())).toEqual([]);
  });

  it('does NOT flag the legitimately-zero fin dimensions', () => {
    // tipChord 0 is a delta fin and sweep 0 is an unswept one; flagging either
    // would put a red box on a perfectly ordinary design.
    expect(badDimensions(tree()).map((d) => d.field)).not.toContain('tipChord');
    expect(badDimensions(tree()).map((d) => d.field)).not.toContain('sweep');
  });

  it('catches a zeroed dimension and names the part', () => {
    const bad = badDimensions(tree({ tube: { outerRadius: 0 } }));
    expect(bad).toHaveLength(1);
    expect(bad[0]).toMatchObject({ id: 'tube', type: 'bodytube', name: 'Body tube', field: 'outerRadius' });
  });

  it('catches a dimension that is missing entirely', () => {
    const bad = badDimensions(tree({ tube: { thickness: undefined } }));
    expect(bad.map((d) => d.field)).toContain('thickness');
  });

  it('reports every bad dimension, nested parts included', () => {
    const bad = badDimensions(tree({ tube: { outerRadius: 0 }, fins: { thickness: 0 } }));
    expect(bad.map((d) => `${d.name}.${d.field}`)).toEqual(['Body tube.outerRadius', 'Fins.thickness']);
  });

  it('falls back to the type when a part has no name', () => {
    const bad = badDimensions(tree({ tube: { name: undefined, outerRadius: 0 } }));
    expect(bad[0]!.name).toBe('bodytube');
  });

  it('knows nothing about types it has no rules for', () => {
    expect(REQUIRED_COMPONENT_FIELDS['stage']).toBeUndefined();
  });
});

describe('designBlocker', () => {
  it('passes a healthy design', () => {
    expect(designBlocker(tree())).toBeNull();
  });

  it('blocks a design with a zeroed dimension', () => {
    const b = designBlocker(tree({ tube: { outerRadius: 0 } }));
    expect(b?.kind).toBe('badGeometry');
  });

  it('reports the missing MOUNT first, since without one there is no flight', () => {
    const b = designBlocker(tree({ tube: { motorMount: false, outerRadius: 0 } }));
    expect(b?.kind).toBe('noMount');
  });

  it('translates the part TYPE when the part has no name of its own', () => {
    // The fallback is a bare token like "bodytube"; printing that at the user
    // would leak an internal name into the message.
    const b = designBlocker(tree({ tube: { name: undefined, outerRadius: 0 } }))!;
    expect(designBlockerText(b, t)).toContain('part.bodytube');
  });

  it('names each part once, listing all of its bad dimensions together', () => {
    // One thing to go and fix, not two.
    const b = designBlocker(tree({ tube: { outerRadius: 0, thickness: 0 } }))!;
    const msg = designBlockerText(b, t);
    expect(msg).toContain('sim.badGeometry');
    expect(msg).toContain('"Body tube"');
    expect(msg).toContain('part.field.outerRadius');
    expect(msg).toContain('part.field.thickness');
    // The part is named once, not repeated per field.
    expect(msg.match(/"Body tube"/g)).toHaveLength(1);
  });
});
