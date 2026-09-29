import { describe, it, expect, beforeEach } from 'vitest';
import type { ComponentNode } from '../../src/engine/openRocketEngine';
import {
  customPartToRow,
  customRowsForType,
  deleteCustomPart,
  listSavedParts,
  updateCustomPart,
  onSavedPartsChanged,
  presetNode,
  saveCustomPart,
  savedPartsVersion,
} from '../../src/services/customParts';
import { setPresetStore, type CustomPart, type PresetStore } from '../../src/services/presetStore';
import { catalogPatch } from '../../src/services/treeEdit';

/** An in-memory PresetStore, so these tests never touch IndexedDB. */
class MemoryPresetStore implements PresetStore {
  parts: CustomPart[] = [];
  async list() {
    return this.parts;
  }
  async add(part: CustomPart) {
    this.parts = [part, ...this.parts.filter((p) => p.id !== part.id)];
  }
  async remove(id: string) {
    this.parts = this.parts.filter((p) => p.id !== id);
  }
}

let store: MemoryPresetStore;
beforeEach(() => {
  store = new MemoryPresetStore();
  setPresetStore(store);
});

const meta = { mfr: 'Mine', partNo: 'BT-50ish', desc: 'the one that fits' };

const tube = (): ComponentNode => ({
  type: 'bodytube',
  id: 'node-1',
  name: 'Payload bay',
  length: 0.2,
  outerRadius: 0.013,
  thickness: 0.0005,
  density: 680,
  materialName: 'Cardboard',
  motorMount: true,
  color: '#ff0000',
  position: { method: 'after', offset: 0 },
});

describe('presetNode', () => {
  it('keeps everything the part IS and drops what identifies the node', () => {
    expect(presetNode(tube())).toEqual({
      length: 0.2,
      outerRadius: 0.013,
      thickness: 0.0005,
      density: 680,
      materialName: 'Cardboard',
      motorMount: true,
      color: '#ff0000',
    });
  });

  it('drops children: a part saves as a part, not as an assembly', () => {
    const withFins: ComponentNode = { ...tube(), children: [{ type: 'trapezoidfinset', id: 'f1', finCount: 3 }] };
    expect(presetNode(withFins).children).toBeUndefined();
  });
});

describe('a saved part as a picker row', () => {
  it('publishes the dimensions the catalog columns sort and rank by', async () => {
    const part = await saveCustomPart(tube(), 'bodytube', meta);
    const row = customPartToRow(part)!;
    expect(row.type).toBe('bodytube');
    expect(row.mfr).toBe('Mine');
    expect(row.partNo).toBe('BT-50ish');
    expect(row.custom).toBe(true);
    expect(row).toMatchObject({ outerDiameter: 0.026, length: 0.2, material: 'Cardboard', materialDensity: 680 });
    // OD less two walls, which is what `catalogPatch` turns back into a wall.
    expect((row as { innerDiameter: number }).innerDiameter).toBeCloseTo(0.025, 9);
  });

  it('reads a tube with no wall as a bore the row does not publish', () => {
    const part: CustomPart = {
      id: 'x',
      type: 'bodytube',
      mfr: 'm',
      partNo: 'p',
      desc: '',
      node: { length: 0.2, outerRadius: 0.013 },
    };
    expect((customPartToRow(part) as { innerDiameter: number | null }).innerDiameter).toBeNull();
  });

  it('marks a solid nose cone filled, the way catalogPatch writes one', () => {
    const solid: CustomPart = {
      id: 'x',
      type: 'nosecone',
      mfr: 'm',
      partNo: 'p',
      desc: '',
      node: { shape: 'ogive', length: 0.1, aftRadius: 0.013, thickness: 0.013 },
    };
    const hollow: CustomPart = { ...solid, node: { ...solid.node, thickness: 0.001 } };
    expect((customPartToRow(solid) as { filled: boolean }).filled).toBe(true);
    expect((customPartToRow(hollow) as { filled: boolean }).filled).toBe(false);
  });

  it('carries a parachute with no drag coefficient as the null the catalog uses', () => {
    const chute: CustomPart = {
      id: 'x',
      type: 'parachute',
      mfr: 'm',
      partNo: 'p',
      desc: '',
      node: { diameter: 0.4, lineCount: 6 },
    };
    expect(customPartToRow(chute)).toMatchObject({ diameter: 0.4, cd: null });
  });

  it('refuses a node that cannot fill the columns', () => {
    const noGeometry: CustomPart = {
      id: 'x',
      type: 'bodytube',
      mfr: 'm',
      partNo: 'p',
      desc: '',
      node: { length: 0.2 },
    };
    expect(customPartToRow(noGeometry)).toBeNull();
  });
});

describe('applying a saved part', () => {
  it('restores the WHOLE node, not just the catalog dimensions', async () => {
    const node = tube();
    const part = await saveCustomPart(node, 'bodytube', meta);
    const patch = catalogPatch(customPartToRow(part)!);
    // Plus the pin: a saved part states a diameter, so applying it turns the
    // automatic flag off on whatever it is applied to, exactly as the kernel's
    // own `setOuterRadius` does. Without it the auto resolver would overwrite
    // the part on its next pass and the picker would read as doing nothing.
    expect(patch).toEqual({ ...presetNode(node), outerRadiusAuto: false });
    // The point of the feature: a flag no catalog row has a column for.
    expect(patch.motorMount).toBe(true);
    expect(patch.color).toBe('#ff0000');
  });

  it('keeps a nose cone shoulder, which a catalog row cannot describe', async () => {
    const cone: ComponentNode = {
      type: 'nosecone',
      id: 'n',
      shape: 'haack',
      shapeParameter: 0.4,
      length: 0.1,
      aftRadius: 0.013,
      thickness: 0.001,
      shoulderLength: 0.03,
      shoulderRadius: 0.0125,
      shoulderCapped: true,
    };
    const part = await saveCustomPart(cone, 'nosecone', { ...meta, partNo: 'my cone' });
    expect(catalogPatch(customPartToRow(part)!)).toMatchObject({
      shapeParameter: 0.4,
      shoulderLength: 0.03,
      shoulderRadius: 0.0125,
      shoulderCapped: true,
    });
  });

  it('hands back a copy, so applying a part cannot mutate the stored one', async () => {
    const part = await saveCustomPart(tube(), 'bodytube', meta);
    const patch = catalogPatch(customPartToRow(part)!);
    patch.length = 99;
    expect(part.node.length).toBe(0.2);
  });
});

describe('saveCustomPart', () => {
  it('files an inner tube under the body tubes that serve it', async () => {
    const inner: ComponentNode = { type: 'innertube', id: 'i', length: 0.07, outerRadius: 0.0095, thickness: 0.0005 };
    await saveCustomPart(inner, 'innertube', { ...meta, partNo: '29mm mount' });
    expect((await customRowsForType('bodytube')).map((r) => r.partNo)).toEqual(['29mm mount']);
    expect(await customRowsForType('nosecone')).toEqual([]);
  });

  it('replaces a part saved again under the same maker and name', async () => {
    await saveCustomPart(tube(), 'bodytube', meta);
    await saveCustomPart({ ...tube(), length: 0.3 }, 'bodytube', meta);
    const rows = await customRowsForType('bodytube');
    expect(rows.length).toBe(1);
    expect((rows[0] as { length: number }).length).toBe(0.3);
  });

  it('refuses a blank part number', async () => {
    await expect(saveCustomPart(tube(), 'bodytube', { ...meta, partNo: '  ' })).rejects.toThrow(/part number/i);
  });

  it('refuses a part the picker could not list, rather than losing it silently', async () => {
    const bare: ComponentNode = { type: 'bodytube', id: 'b' };
    await expect(saveCustomPart(bare, 'bodytube', meta)).rejects.toThrow(/dimensions/i);
    expect(store.parts).toEqual([]);
  });

  it('falls back to a maker name rather than an empty column', async () => {
    const part = await saveCustomPart(tube(), 'bodytube', { ...meta, mfr: '   ' });
    expect(part.mfr).toBe('Custom');
  });
});

describe('customRowsForType', () => {
  it('drops a stored part that no longer projects, keeping the rest', async () => {
    await saveCustomPart(tube(), 'bodytube', meta);
    store.parts.push({ id: 'broken', type: 'bodytube', mfr: 'm', partNo: 'p', desc: '', node: {} });
    expect((await customRowsForType('bodytube')).map((r) => r.partNo)).toEqual(['BT-50ish']);
  });
});

describe('updateCustomPart', () => {
  it('renames in place rather than leaving the old part behind', async () => {
    const part = await saveCustomPart(tube(), 'bodytube', meta);
    await updateCustomPart(part.id, { mfr: 'Bench', partNo: 'BT-50 v2', desc: 'rev b' }, part.node);
    const all = await listSavedParts();
    expect(all.length).toBe(1);
    expect(all[0]!.part).toMatchObject({ id: part.id, mfr: 'Bench', partNo: 'BT-50 v2', desc: 'rev b' });
  });

  it('edits the geometry, and the picker row follows it', async () => {
    const part = await saveCustomPart(tube(), 'bodytube', meta);
    await updateCustomPart(part.id, meta, { ...part.node, length: 0.45 });
    const rows = await customRowsForType('bodytube');
    expect((rows[0] as { length: number }).length).toBe(0.45);
  });

  it('keeps what the edit did not touch', async () => {
    const part = await saveCustomPart(tube(), 'bodytube', meta);
    await updateCustomPart(part.id, meta, { ...part.node, length: 0.45 });
    const patch = catalogPatch(customPartToRow((await listSavedParts())[0]!.part)!);
    expect(patch.motorMount).toBe(true);
    expect(patch.color).toBe('#ff0000');
  });

  it('refuses a name another part of the same type already uses', async () => {
    await saveCustomPart(tube(), 'bodytube', meta);
    const second = await saveCustomPart(tube(), 'bodytube', { ...meta, partNo: 'other' });
    await expect(updateCustomPart(second.id, meta, second.node)).rejects.toThrow(/already uses/i);
    // Two parts still, neither of them merged into the other.
    expect((await listSavedParts()).length).toBe(2);
  });

  it('allows the same name on a DIFFERENT type', async () => {
    await saveCustomPart(tube(), 'bodytube', meta);
    const bulkhead: ComponentNode = { type: 'bulkhead', id: 'bh', length: 0.003, outerRadius: 0.025 };
    const b = await saveCustomPart(bulkhead, 'bulkhead', { ...meta, partNo: 'other' });
    await expect(updateCustomPart(b.id, meta, b.node)).resolves.toMatchObject({ partNo: meta.partNo });
  });

  it('refuses an edit that would leave the part impossible to list', async () => {
    const part = await saveCustomPart(tube(), 'bodytube', meta);
    await expect(updateCustomPart(part.id, meta, { length: 0.2 })).rejects.toThrow(/dimensions/i);
  });

  it('refuses to edit a part that is no longer saved', async () => {
    await expect(updateCustomPart('gone', meta, {})).rejects.toThrow(/no longer saved/i);
  });
});

describe('a saved part keeps its identity across a rename', () => {
  it('saving again under a NEW name adds a part; under the old name replaces it', async () => {
    const first = await saveCustomPart(tube(), 'bodytube', meta);
    const again = await saveCustomPart({ ...tube(), length: 0.3 }, 'bodytube', meta);
    expect(again.id).toBe(first.id);
    const fresh = await saveCustomPart(tube(), 'bodytube', { ...meta, partNo: 'a different one' });
    expect(fresh.id).not.toBe(first.id);
    expect((await listSavedParts()).length).toBe(2);
  });
});

describe('listSavedParts (the manage view)', () => {
  it('KEEPS a part that no longer projects, which customRowsForType drops', async () => {
    await saveCustomPart(tube(), 'bodytube', meta);
    store.parts.push({ id: 'broken', type: 'bodytube', mfr: 'm', partNo: 'p', desc: '', node: {} });
    // The picker hides it; the only list you can delete from must not, or it
    // is a part that can never be removed.
    expect((await customRowsForType('bodytube')).map((r) => r.partNo)).toEqual(['BT-50ish']);
    const all = await listSavedParts();
    expect(all.map((e) => e.part.partNo).sort()).toEqual(['BT-50ish', 'p']);
    expect(all.find((e) => e.part.id === 'broken')?.row).toBeNull();
  });

  it('spans every type, so nothing depends on what the open design holds', async () => {
    await saveCustomPart(tube(), 'bodytube', meta);
    const bulkhead: ComponentNode = { type: 'bulkhead', id: 'bh', length: 0.003, outerRadius: 0.025 };
    await saveCustomPart(bulkhead, 'bulkhead', { ...meta, partNo: 'my bulkhead' });
    expect((await listSavedParts()).map((e) => e.part.type).sort()).toEqual(['bodytube', 'bulkhead']);
  });
});

describe('the change signal the picker subscribes to', () => {
  it('fires on a save and on a delete', async () => {
    let fired = 0;
    const stop = onSavedPartsChanged(() => fired++);
    try {
      const before = savedPartsVersion();
      const part = await saveCustomPart(tube(), 'bodytube', meta);
      await deleteCustomPart(part.id);
      expect(fired).toBe(2);
      expect(savedPartsVersion()).toBe(before + 2);
      expect(await customRowsForType('bodytube')).toEqual([]);
    } finally {
      stop();
    }
  });

  it('stops firing once unsubscribed', async () => {
    let fired = 0;
    onSavedPartsChanged(() => fired++)();
    await saveCustomPart(tube(), 'bodytube', meta);
    expect(fired).toBe(0);
  });
});
