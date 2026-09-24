import { describe, it, expect } from 'vitest';
import { FIELDS, PANEL_SCOPE_KEYS } from '../../services/componentFields';
import { unitScope } from '../../prefs/units';
import { isAxial } from '../../services/treeEdit';

/**
 * Unit scopes are strings assembled at the call site — `unitScope('prop',
 * node.type, field.key)` — which is flexible but unchecked by the compiler.
 * The realistic way that bites is a copy-paste: two fields on one component
 * type sharing a key, which silently makes them share one unit choice, so
 * changing the unit on one moves the other. These guard that.
 */
describe('property-panel unit scopes', () => {
  it('gives every field of a type its own scope', () => {
    for (const [type, fields] of Object.entries(FIELDS)) {
      const scopes = fields.map((f) => unitScope('prop', type, f.key));
      expect(new Set(scopes).size, `duplicate field key in FIELDS.${type}`).toBe(scopes.length);
    }
  });

  it('keeps the panel rows from colliding with a type-specific field', () => {
    // The mass/CG overrides and the placement offset are rendered alongside the
    // fields and scoped the same way, so a field keyed 'offset' would share the
    // placement row's unit.
    for (const [type, fields] of Object.entries(FIELDS)) {
      for (const reserved of PANEL_SCOPE_KEYS) {
        expect(
          fields.some((f) => f.key === reserved),
          `FIELDS.${type} reuses the reserved scope key '${reserved}'`,
        ).toBe(false);
      }
    }
  });

  it('only puts a field in `placement` on a type whose panel shows that section', () => {
    // PropertyPanel renders PlacementSection for nested parts only
    // (`type !== 'stage' && !isAxial(type)`), and `visibleFields` drops every
    // sectioned field from the dimension list. Mark one on a body tube and it
    // falls out of both: not editable anywhere, with nothing to say so.
    //
    // The other sections need no such test: FieldSection is rendered
    // unconditionally and draws nothing when the part has no field in it.
    for (const [type, fields] of Object.entries(FIELDS)) {
      if (!fields.some((f) => f.section === 'placement')) continue;
      expect(type === 'stage' || isAxial(type), `FIELDS.${type} has a placement field but no placement section`).toBe(
        false,
      );
    }
  });

  it('separates the same field name on different component types', () => {
    // Deliberate: a nose cone's Length and a body tube's Length are different
    // fields on different cards, and get their own units.
    expect(unitScope('prop', 'nosecone', 'length')).not.toBe(unitScope('prop', 'bodytube', 'length'));
  });
});
