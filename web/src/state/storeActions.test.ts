import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useWorkspaceStore } from './store';
import { DesignLibrary, setDesignLibrary } from '../services/designLibrary';
import type { KeyValueStore } from '../services/keyValueStore';

/**
 * The store actions that produce files or mutate the design library.
 *
 * These were the untested ones, and they are exactly the actions whose
 * failures are SILENT: the user gets a wrong file, or a lost design, with no
 * exception anywhere. The rest of the store is well covered, which made the
 * gap sharper rather than smaller.
 */

class FakeKv implements KeyValueStore {
  readonly map = new Map<string, string>();
  full = false;
  async get(k: string) {
    return this.map.get(k) ?? null;
  }
  async set(k: string, v: string) {
    if (this.full) return false;
    this.map.set(k, v);
    return true;
  }
  async remove(k: string) {
    this.map.delete(k);
  }
  async update(k: string, fn: (raw: string | null) => string | null) {
    const next = fn(await this.get(k));
    if (next === null) {
      await this.remove(k);
      return true;
    }
    return await this.set(k, next);
  }
}

const s = () => useWorkspaceStore.getState();
let kv: FakeKv;

beforeEach(() => {
  kv = new FakeKv();
  setDesignLibrary(new DesignLibrary(kv));
  s().resetWorkspace();
  useWorkspaceStore.setState({ err: null, storageWarning: null });
});

describe('scaleDesign', () => {
  const bodyLength = () => {
    const find = (ns: { type?: string; length?: number; children?: unknown[] }[]): number | undefined => {
      for (const n of ns) {
        if (n.type === 'bodytube') return n.length;
        const hit = find((n.children ?? []) as typeof ns);
        if (hit !== undefined) return hit;
      }
      return undefined;
    };
    return find(s().tree.components as unknown as Parameters<typeof find>[0]);
  };

  it('scales the design and can be undone in one step', () => {
    const before = bodyLength()!;
    s().scaleDesign(2);
    expect(bodyLength()).toBeCloseTo(before * 2, 9);

    s().undo();
    expect(bodyLength()).toBeCloseTo(before, 9);
  });

  it('is a no-op for 1x and for a nonsense factor, leaving the tree identical', () => {
    const tree = s().tree;
    for (const f of [1, 0, -2, NaN]) {
      s().scaleDesign(f);
      expect(s().tree).toBe(tree); // same object: nothing was rewritten
    }
  });

  it('clears the selection, which no longer points at a current node', () => {
    const id = s().tree.components[0]!.id;
    s().setSelectedId(id ?? null);
    s().scaleDesign(2);
    expect(s().selectedId).toBeNull();
  });
});

describe('saveDesignAs when storage refuses the write', () => {
  it('raises the storage-full warning instead of resolving silently', async () => {
    kv.full = true;
    await s().saveDesignAs('Doomed');
    expect(s().storageWarning).toBeTruthy();
    // ...and no phantom entry is left behind in the library.
    expect(await new DesignLibrary(kv).list()).toEqual([]);
  });

  it('creates the design and makes it active when storage cooperates', async () => {
    await s().saveDesignAs('Keeper');
    const list = await new DesignLibrary(kv).list();
    expect(list.map((m) => m.name)).toEqual(['Keeper']);
    expect(s().storageWarning).toBeNull();
  });
});

describe('deleteDesign', () => {
  it('resets the workspace when the OPEN design is deleted', async () => {
    await s().saveDesignAs('Open one');
    await s().refreshDesigns();
    const id = s().activeDesignId!;
    expect(id).toBeTruthy();

    const treeBefore = s().tree;
    await s().deleteDesign(id);

    expect(await new DesignLibrary(kv).list()).toEqual([]);
    expect(s().activeDesignId).toBeNull();
    // A fresh workspace, not the one that was just deleted.
    expect(s().tree).not.toBe(treeBefore);
  });

  it('leaves the workspace alone when a DIFFERENT design is deleted', async () => {
    await s().saveDesignAs('Other');
    await s().refreshDesigns();
    const other = s().activeDesignId!;
    await s().saveDesignAs('Open one');
    await s().refreshDesigns();
    const openId = s().activeDesignId!;

    const treeBefore = s().tree;
    await s().deleteDesign(other);

    expect(s().activeDesignId).toBe(openId);
    expect(s().tree).toBe(treeBefore); // untouched
  });
});

describe('newWorkspace', () => {
  it('starts a blank design once the user confirms', async () => {
    await s().saveDesignAs('Existing');
    await s().refreshDesigns();
    s().addSim();
    const simsBefore = s().sims.length;

    const { useConfirmStore } = await import('./confirmStore');
    const run = s().newWorkspace();
    // The confirm modal is imperative; answer it.
    await Promise.resolve();
    useConfirmStore.getState().settle(true);
    await run;

    expect(s().sims).toHaveLength(1);
    expect(simsBefore).toBeGreaterThan(1);
    expect(s().activeDesignId).toBeNull(); // detached, so autosave creates a new entry
  });

  it('changes nothing when the user declines', async () => {
    s().addSim();
    const before = s().sims.length;

    const { useConfirmStore } = await import('./confirmStore');
    const run = s().newWorkspace();
    await Promise.resolve();
    useConfirmStore.getState().settle(false);
    await run;

    expect(s().sims).toHaveLength(before);
  });
});

describe('exportComponent', () => {
  it('reports a format the component cannot produce, rather than failing mutely', async () => {
    // A stage has no printable solid, so the export declines.
    const stageId = s().tree.components[0]!.id!;
    await s().exportComponent(stageId, 'stl');
    expect(s().err).toBeTruthy();
  });

  it('surfaces a thrown exporter error', async () => {
    vi.resetModules();
    await s().exportComponent('no-such-node', 'stl');
    expect(s().err).toBeTruthy();
  });
});
