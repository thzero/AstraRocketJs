// @vitest-environment jsdom
import { useEffect } from 'react';
import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { FieldRow } from '../../../src/components/design/DimensionFields';
import { FIELDS, type Field } from '../../../src/services/design/componentFields';
import { DERIVED } from '../../../src/services/design/derivedFields';
import { fieldApplies, fieldRange, liveBounds } from '../../../src/services/design/fieldRange';
import { defaultNode } from '../../../src/services/design/treeEdit';
import { useUnits, type Units } from '../../../src/prefs/useUnits';
import { unitScope, type Quantity } from '../../../src/prefs/units';
import { renderWithProviders } from '../../testing/renderWithProviders';
import type { ComponentNode, ComponentType } from '../../../src/engine/openRocketEngine';

/**
 * The box the user types into carries the floor the field declares, in the
 * field's own unit.
 *
 * `fieldRange` is the spec for the kinds it bounds: it declares a mass and a
 * distance non-negative because the bridge refuses a negative mass or deploy
 * altitude (ComponentFactory NON_NEGATIVE) and the kernel keeps a negative
 * separation altitude and never fires the altitude trigger. A box rendered with
 * no `min` clamps nothing, so a typed or pasted -150 lands on the node. The
 * kernel readback gate probes the range `fieldRange` declares, not the box, so
 * only a test on the rendered box can see the floor missing.
 *
 * A `derived` row's floor is its own spec's (`DERIVED[...].min`, zero when it
 * states none) and a `bore` is floored at zero, since neither is a stored key
 * `fieldRange` knows; both are checked against those sources.
 */

/** States in which the fields that apply only under some event or shape are on screen. */
const SEED: Partial<ComponentNode> = {
  deployEvent: 'altitude',
  separationEvent: 'altitudeascending',
  cluster: '3-ring',
};

type Case = { label: string; node: ComponentNode; field: Field };

const cases: Case[] = Object.entries(FIELDS).flatMap(([type, fields]) => {
  const node = { ...defaultNode(type as ComponentType), ...SEED, id: 'p' } as ComponentNode;
  return fields
    .filter((f) => fieldApplies(node, f) && !['select', 'bool', 'text'].includes(f.kind))
    .map((f) => ({ label: `${type}.${f.key} (${f.kind})`, node, field: f }));
});

/** The floor the box has to show: the SI figure, the unit it is shown in, and the radius-to-diameter factor. */
function expectedFloor(node: ComponentNode, f: Field): { si: number | undefined; quantity?: Quantity; scale: number } {
  switch (f.kind) {
    case 'length':
      return { si: fieldRange(node, f, liveBounds(f, null)).min, quantity: 'length', scale: f.diameter ? 2 : 1 };
    case 'mass':
    case 'distance':
    case 'angle':
      return { si: fieldRange(node, f).min, quantity: f.kind, scale: 1 };
    case 'derived': {
      const d = DERIVED[f.derived];
      return { si: d.min?.(node) ?? 0, quantity: d.quantity, scale: 1 };
    }
    case 'bore':
      return { si: 0, quantity: 'length', scale: 1 };
    default:
      return { si: fieldRange(node, f).min, scale: 1 };
  }
}

/** Hands out the unit preferences the row converts through, so the expectation is converted the same way. */
function UnitsProbe({ onUnits }: { onUnits: (u: Units) => void }) {
  const u = useUnits();
  useEffect(() => onUnits(u), [u, onUnits]);
  return null;
}

describe('the number box carries the floor fieldRange declares', () => {
  it('checks a mass and a distance field, so the altitude and mass boxes cannot slip out of the list', () => {
    expect(cases.some((c) => c.field.kind === 'mass')).toBe(true);
    expect(cases.filter((c) => c.field.kind === 'distance').map((c) => c.field.key)).toEqual(
      expect.arrayContaining(['deployAltitude', 'separationAltitude']),
    );
  });

  it.each(cases)('$label', ({ node, field }) => {
    let units: Units | null = null;
    renderWithProviders(
      <>
        <FieldRow node={node} field={field} onChange={() => {}} />
        <UnitsProbe
          onUnits={(u) => {
            units = u;
          }}
        />
      </>,
    );
    const box = screen.getByRole('spinbutton') as HTMLInputElement;
    const { si, quantity, scale } = expectedFloor(node, field);
    if (si === undefined) {
      expect(box.min).toBe('');
      return;
    }
    const want = quantity ? units!.at(unitScope('prop', node.type, field.key), quantity).toUi(scale * si) : si;
    // Asserted as text first: `Number('')` is 0, which would pass a box with no floor at all.
    expect(box.min).not.toBe('');
    expect(Number(box.min)).toBeCloseTo(want, 6);
  });
});
