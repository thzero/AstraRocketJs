import { describe, it, expect } from 'vitest';
import { activeExtraMounts, reconcileMounts } from '../../src/services/mountMotors';
import { C6 } from '../../src/engine/api';
import type { ComponentNode, RocketTree } from '../../src/engine/openRocketEngine';
import type { MountMotor } from '../../src/services/loadOrk';

const mount = (id: string): ComponentNode => ({ type: 'innertube', id, motorMount: true });
const tree = (ids: string[]): RocketTree => ({ components: [{ type: 'stage', id: 's', children: ids.map(mount) }] });
const other = (): MountMotor => ({ spec: { ...C6, designation: 'X' } });

describe('reconcileMounts', () => {
  it('is a no-op (same reference) when the map already matches the mounts', () => {
    const extra = { m2: other() };
    expect(reconcileMounts(tree(['m1', 'm2']), extra)).toBe(extra); // unchanged → same object
    const empty = {};
    expect(reconcileMounts(tree(['m1']), empty)).toBe(empty); // single primary mount → no extras
  });

  it('seeds a default C6 for a newly added non-primary mount', () => {
    const next = reconcileMounts(tree(['m1', 'm2']), {});
    expect(Object.keys(next)).toEqual(['m2']); // primary (m1) is not stored here
    expect(next.m2!.spec.designation).toBe('C6');
  });

  it('drops entries for mounts that no longer exist', () => {
    const next = reconcileMounts(tree(['m1', 'm2']), { gone: other(), m2: other() });
    expect(next.gone).toBeUndefined();
    expect(next.m2!.spec.designation).toBe('X'); // surviving mount keeps its motor
  });

  it("keeps a now-primary mount's entry (consumers ignore it) so its motor survives", () => {
    const next = reconcileMounts(tree(['m1', 'm2']), { m1: other() });
    expect(next.m1!.spec.designation).toBe('X'); // preserved even though m1 is primary
    expect(next.m2!.spec.designation).toBe('C6'); // m2 seeded
  });

  it('prunes everything when the last mount is removed', () => {
    expect(reconcileMounts(tree([]), { m1: other() })).toEqual({});
  });
});

describe('activeExtraMounts', () => {
  it('skips the primary mount and mounts no longer in the tree, keeps the rest', () => {
    const extra = { m1: other(), m2: other(), gone: other() };
    expect(activeExtraMounts(tree(['m1', 'm2']), extra).map(([id]) => id)).toEqual(['m2']);
  });

  it('accepts the primary id from a caller that already has it', () => {
    const extra = { m1: other(), m2: other() };
    // A caller asserting a different primary is believed: the filter is about
    // the id it is given, not a re-derivation.
    expect(activeExtraMounts(tree(['m1', 'm2']), extra, 'm2').map(([id]) => id)).toEqual(['m1']);
  });

  it('is empty when nothing but the primary is loaded', () => {
    expect(activeExtraMounts(tree(['m1']), { m1: other() })).toEqual([]);
  });
});
