// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, screen } from '@testing-library/react';

vi.mock('../../src/engine/simClient', () => ({ warmSimWorker: vi.fn() }));
vi.mock('../../src/services/storage/persistStorage', () => ({
  requestPersistentStorage: vi.fn(() => Promise.resolve(true)),
}));
// The drawing needs a layout jsdom does not have; the banner above it is what
// these tests click.
vi.mock('../../src/components/canvas/CenterCanvas', () => ({ CenterCanvas: () => null }));

import { useWorkspaceEffects } from '../../src/state/useWorkspaceEffects';
import { useWorkspaceStore, workspaceSnapshot } from '../../src/state/store';
import { DesignLibrary, getDesignLibrary, setDesignLibrary } from '../../src/services/storage/designLibrary';
import { lean } from '../../src/services/storage/workspaceStore';
import type { KeyValueStore } from '../../src/services/storage/keyValueStore';
import { nsKey } from '../../src/services/storage/storageKeys';
import { renderWithProviders } from '../testing/renderWithProviders';
import { useConfirmStore } from '../../src/state/confirmStore';
import { CenterView } from '../../src/components/canvas/CenterView';

/**
 * Switching designs, or deleting the open one, while the open design still has
 * a debounced autosave pending.
 *
 * Everything below the store is real: the library on an in-memory key-value
 * store, the workspace store, and the hook that arms the autosave. One storage
 * read or delete is held open so the timer can fire in the middle of the
 * switch, as it does when IndexedDB is slower than the 500 ms debounce.
 */

type Op = 'get' | 'remove';

/** In-memory storage whose `update` is atomic, like the IndexedDB transaction behind it. */
class HeldKv implements KeyValueStore {
  map = new Map<string, string>();
  private held: { op: Op; key: string; skip: number; release?: () => void; reached: () => void }[] = [];
  private lock: Promise<unknown> = Promise.resolve();

  /** Hold the `skip`+1-th `op` on `key` until `release` is called. */
  hold(op: Op, key: string, skip = 0): { reached: Promise<void>; release: () => void } {
    let reached!: () => void;
    const whenReached = new Promise<void>((r) => (reached = r));
    const h = { op, key, skip, reached } as HeldKv['held'][number];
    this.held.push(h);
    return { reached: whenReached, release: () => h.release!() };
  }

  private gate(op: Op, key: string): Promise<void> | null {
    const h = this.held.find((x) => x.op === op && x.key === key);
    if (!h) return null;
    if (h.skip-- > 0) return null;
    this.held = this.held.filter((x) => x !== h);
    return new Promise<void>((r) => {
      h.release = r;
      h.reached();
    });
  }

  async get(k: string) {
    // The value as of the call, the way a read transaction sees it.
    const v = this.map.has(k) ? this.map.get(k)! : null;
    const g = this.gate('get', k);
    if (g) await g;
    return v;
  }
  async set(k: string, v: string) {
    this.map.set(k, v);
    return true;
  }
  async remove(k: string) {
    const g = this.gate('remove', k);
    if (g) await g;
    this.map.delete(k);
  }
  async update(k: string, fn: (raw: string | null) => string | null) {
    const prev = this.lock;
    let release!: () => void;
    this.lock = new Promise<void>((r) => (release = r));
    await prev;
    try {
      const next = fn(this.map.get(k) ?? null);
      if (next === null) {
        this.map.delete(k);
        return true;
      }
      return await this.set(k, next);
    } finally {
      release();
    }
  }
}

const designKey = (id: string) => nsKey(`designs:${id}`);
const journalKey = (id: string) => `${nsKey('designs:unload')}:${id}`;

function Host() {
  useWorkspaceEffects();
  return null;
}

const s = () => useWorkspaceStore.getState();
const flush = async () => {
  for (let i = 0; i < 100; i++) await Promise.resolve();
};

let kv: HeldKv;
let original: DesignLibrary;
let a: string;
let b: string;

beforeEach(async () => {
  vi.useFakeTimers();
  localStorage.clear();
  original = getDesignLibrary();
  kv = new HeldKv();
  setDesignLibrary(new DesignLibrary(kv));
  s().resetWorkspace();
  const base = workspaceSnapshot(s());
  const lib = getDesignLibrary();
  b = (await lib.create('B', lean({ ...base, tree: { ...base.tree, name: 'Rocket B' } }))).id;
  a = (await lib.create('A', lean({ ...base, tree: { ...base.tree, name: 'Rocket A' } }))).id;
  // Boot opens A.
  renderWithProviders(<Host />);
  await act(flush);
  expect(s().tree.name).toBe('Rocket A');
  // What opening the library dialog does first.
  await act(() => s().refreshDesigns());
});

afterEach(() => {
  cleanup();
  setDesignLibrary(original);
  vi.useRealTimers();
});

/** Let the debounce run out while the held storage call is still open. */
const fireAutosave = () =>
  act(async () => {
    vi.advanceTimersByTime(600);
    await flush();
  });

describe('opening another design with an autosave pending', () => {
  it('leaves the incoming design as stored when an edit made before the switch is saved during it', async () => {
    const before = kv.map.get(designKey(b));
    act(() => s().updateDesignMeta({ designer: 'Edited in A' }));
    // The first read of B is openDesign's own check; the second is the open.
    const held = kv.hold('get', designKey(b), 1);
    const opening = s().openDesign(b);
    await held.reached;
    await fireAutosave();
    held.release();
    await act(async () => {
      await opening;
      await flush();
    });

    expect(kv.map.get(designKey(b))).toBe(before);
    expect(s().tree.name).toBe('Rocket B');
  });

  it('leaves the incoming design as stored when an edit made during the switch is saved', async () => {
    const before = kv.map.get(designKey(b));
    const held = kv.hold('get', designKey(b), 1);
    const opening = s().openDesign(b);
    await held.reached;
    act(() => s().updateDesignMeta({ designer: 'Edited during the switch' }));
    await fireAutosave();
    held.release();
    await act(async () => {
      await opening;
      await flush();
    });

    expect(kv.map.get(designKey(b))).toBe(before);
  });

  it('journals nothing under the incoming design when the page hides during the switch', async () => {
    const before = localStorage.getItem(journalKey(b));
    const held = kv.hold('get', designKey(b), 1);
    const opening = s().openDesign(b);
    await held.reached;
    act(() => s().updateDesignMeta({ designer: 'Edited during the switch' }));
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    held.release();
    await act(async () => {
      await opening;
      await flush();
    });

    expect(localStorage.getItem(journalKey(b))).toBe(before);
  });
});

describe('a second open claiming the workspace while the first is still reading', () => {
  it('leaves the first design as stored when the second open fails', async () => {
    const before = kv.map.get(designKey(b));
    const held = kv.hold('get', designKey(b), 1);
    const opening = s().openDesign(b);
    await held.reached;
    // A design the library no longer has: the second open claims the
    // workspace, then stops with the first design still on screen.
    await act(async () => {
      await s().openDesign('missing-design');
      await flush();
    });
    held.release();
    await act(async () => {
      await opening;
      await flush();
    });
    expect(s().tree.name).toBe('Rocket A');
    act(() => s().updateDesignMeta({ designer: 'Edited in A' }));
    await fireAutosave();

    expect(kv.map.get(designKey(b))).toBe(before);
    expect((await getDesignLibrary().read(a))?.tree.designer).toBe('Edited in A');
    // The next boot opens what is on screen.
    expect(await getDesignLibrary().activeId()).toBe(a);
  });

  it('leaves the first design as stored when the second open succeeds after it', async () => {
    const base = workspaceSnapshot(s());
    const c = (await getDesignLibrary().create('C', lean({ ...base, tree: { ...base.tree, name: 'Rocket C' } }))).id;
    const before = kv.map.get(designKey(b));
    const heldB = kv.hold('get', designKey(b), 1);
    const heldC = kv.hold('get', designKey(c));
    const openingB = s().openDesign(b);
    await heldB.reached;
    const openingC = s().openDesign(c);
    await heldC.reached;
    // Made after the first open's flush, so the second open's flush is the
    // write that carries it.
    act(() => s().updateDesignMeta({ designer: 'Edited in A' }));
    heldB.release();
    await act(async () => {
      await openingB;
      await flush();
    });
    heldC.release();
    await act(async () => {
      await openingC;
      await flush();
    });
    await fireAutosave();

    expect(s().tree.name).toBe('Rocket C');
    expect(kv.map.get(designKey(b))).toBe(before);
    expect((await getDesignLibrary().read(a))?.tree.designer).toBe('Edited in A');
  });
});

describe('starting a new design with an autosave pending', () => {
  it('stores the last edit in the design being left, and nowhere else', async () => {
    const ids = (await getDesignLibrary().list()).map((m) => m.id);
    act(() => s().updateDesignMeta({ designer: 'Edited in A' }));
    const answer = useConfirmStore.subscribe((st) => {
      if (st.request) useConfirmStore.getState().settle(true);
    });
    try {
      await act(async () => {
        await s().newWorkspace();
        await flush();
      });
    } finally {
      answer();
    }
    await fireAutosave();

    expect((await getDesignLibrary().read(a))?.tree.designer).toBe('Edited in A');
    expect((await getDesignLibrary().list()).map((m) => m.id).sort()).toEqual(ids.sort());
  });
});

describe('closing a loaded design with an autosave pending', () => {
  it('stores the last edit in the design being closed', async () => {
    act(() => {
      useWorkspaceStore.setState({ loadedMeta: { name: 'Rocket A', notes: [], exportMotors: {} } });
    });
    await fireAutosave();
    // jsdom has no matchMedia; the pane asks it which layout it is in.
    window.matchMedia = ((query: string) => ({
      matches: true,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    })) as unknown as typeof window.matchMedia;
    renderWithProviders(<CenterView />);
    act(() => s().updateDesignMeta({ designer: 'Edited in A' }));
    const answer = useConfirmStore.subscribe((st) => {
      if (st.request) useConfirmStore.getState().settle(true);
    });
    try {
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Close' }));
        await flush();
      });
    } finally {
      answer();
    }
    await fireAutosave();

    expect(s().loadedMeta).toBeNull();
    expect((await getDesignLibrary().read(a))?.tree.designer).toBe('Edited in A');
  });
});

describe('deleting the open design with an autosave pending', () => {
  it('stays deleted when the autosave would have landed during the delete', async () => {
    const remaining = (await getDesignLibrary().list()).map((m) => m.id).filter((id) => id !== a);
    act(() => s().updateDesignMeta({ designer: 'Edited in A' }));
    const held = kv.hold('remove', designKey(a));
    const deleting = s().deleteDesign(a);
    await held.reached;
    await fireAutosave();
    held.release();
    await act(async () => {
      await deleting;
      await flush();
    });

    expect((await getDesignLibrary().list()).map((m) => m.id)).toEqual(remaining);
  });

  it('stays deleted when an edit made during the delete is saved', async () => {
    const remaining = (await getDesignLibrary().list()).map((m) => m.id).filter((id) => id !== a);
    const held = kv.hold('remove', designKey(a));
    const deleting = s().deleteDesign(a);
    await held.reached;
    act(() => s().updateDesignMeta({ designer: 'Edited during the delete' }));
    await fireAutosave();
    held.release();
    await act(async () => {
      await deleting;
      await flush();
    });
    await fireAutosave();

    expect((await getDesignLibrary().list()).map((m) => m.id)).toEqual(remaining);
    expect(kv.map.has(designKey(a))).toBe(false);
  });
});
