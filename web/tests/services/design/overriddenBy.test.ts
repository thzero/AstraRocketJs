import { describe, it, expect } from 'vitest';
import type { RocketTree } from '../../../src/engine/openRocketEngine';
import { overriddenBy } from '../../../src/services/design/overriddenBy';

/** The kernel's getMassOverriddenBy and its CG and CD twins. */
const tree = (stage: Record<string, unknown>, tube: Record<string, unknown>): RocketTree =>
  ({
    components: [
      {
        id: 's',
        type: 'stage',
        name: 'Sustainer',
        ...stage,
        children: [
          {
            id: 't',
            type: 'bodytube',
            name: 'Tube',
            ...tube,
            children: [{ id: 'r', type: 'centeringring' }],
          },
        ],
      },
    ],
  }) as unknown as RocketTree;

describe('overriddenBy', () => {
  it('names an ancestor that overrides the value for all its subcomponents', () => {
    const t = tree({ overrideMass: 0.2, overrideSubcomponentsMass: true }, {});
    expect(overriddenBy(t, 'r', 'mass')!.id).toBe('s');
    expect(overriddenBy(t, 't', 'mass')!.id).toBe('s');
  });

  it('ignores an override that covers only the ancestor itself', () => {
    expect(overriddenBy(tree({ overrideMass: 0.2 }, {}), 'r', 'mass')).toBeNull();
  });

  it('takes the outermost ancestor when two cover the part', () => {
    const t = tree(
      { overrideCGX: 0.3, overrideSubcomponentsCG: true },
      { overrideCGX: 0.1, overrideSubcomponentsCG: true },
    );
    expect(overriddenBy(t, 'r', 'cg')!.id).toBe('s');
  });

  it('keeps the three kinds apart, and never names the part itself', () => {
    const t = tree({}, { overrideCD: 0.6, overrideSubcomponentsCD: true });
    expect(overriddenBy(t, 'r', 'cd')!.id).toBe('t');
    expect(overriddenBy(t, 'r', 'mass')).toBeNull();
    expect(overriddenBy(t, 't', 'cd')).toBeNull();
  });
});
