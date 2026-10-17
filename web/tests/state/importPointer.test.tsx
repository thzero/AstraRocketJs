// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup } from '@testing-library/react';

vi.mock('../../src/engine/simClient', () => ({ warmSimWorker: vi.fn() }));
vi.mock('../../src/services/storage/persistStorage', () => ({
  requestPersistentStorage: vi.fn(() => Promise.resolve(true)),
}));
// The kernel build and the motor catalog are not what is under test, and the
// fixture carries no motors.
vi.mock('../../src/engine/openRocketEngine', async (original) => ({
  ...(await original<typeof import('../../src/engine/openRocketEngine')>()),
  OpenRocketDesign: {
    buildTree: () => ({
      setMotorById: () => {},
      setMotorIgnitionById: () => {},
      staticInfo: () => ({}),
      free: () => {},
    }),
  },
  resetEngine: () => {},
}));
vi.mock('../../src/services/motors/motorDb', async (original) => ({
  ...(await original<typeof import('../../src/services/motors/motorDb')>()),
  loadCatalog: async () => [],
}));

import { useWorkspaceEffects } from '../../src/state/useWorkspaceEffects';
import { useWorkspaceStore, workspaceSnapshot } from '../../src/state/store';
import { DesignLibrary, getDesignLibrary, setDesignLibrary } from '../../src/services/storage/designLibrary';
import { lean } from '../../src/services/storage/workspaceStore';
import type { KeyValueStore } from '../../src/services/storage/keyValueStore';
import { nsKey } from '../../src/services/storage/storageKeys';
import { renderWithProviders } from '../testing/renderWithProviders';
import { useConfirmStore } from '../../src/state/confirmStore';

/**
 * An import that ends without replacing the design on screen, while an open it
 * superseded has already named its own design active. The library must name
 * the design on screen again, or the next boot opens one nobody was looking at.
 */

const designKey = (id: string) => nsKey(`designs:${id}`);
const ACTIVE = nsKey('designs:active');

/** In-memory storage that can hold one read open and refuse one write. */
class TestKv implements KeyValueStore {
  map = new Map<string, string>();
  private held: { key: string; skip: number; reached: () => void; release?: () => void } | null = null;
  private refuse: string | null = null;

  hold(key: string, skip = 0): { reached: Promise<void>; release: () => void } {
    let reached!: () => void;
    const whenReached = new Promise<void>((r) => (reached = r));
    const h = { key, skip, reached } as NonNullable<TestKv['held']>;
    this.held = h;
    return { reached: whenReached, release: () => h.release!() };
  }
  /** Refuse the next write to `key`, as a full store does. */
  refuseNext(key: string) {
    this.refuse = key;
  }
  async get(k: string) {
    const v = this.map.get(k) ?? null;
    const h = this.held;
    if (h && h.key === k && h.skip-- <= 0) {
      this.held = null;
      await new Promise<void>((r) => {
        h.release = r;
        h.reached();
      });
    }
    return v;
  }
  async set(k: string, v: string) {
    if (this.refuse === k) {
      this.refuse = null;
      return false;
    }
    this.map.set(k, v);
    return true;
  }
  async remove(k: string) {
    this.map.delete(k);
  }
  async update(k: string, fn: (raw: string | null) => string | null) {
    const next = fn(this.map.get(k) ?? null);
    if (next === null) this.map.delete(k);
    else return this.set(k, next);
    return true;
  }
}

/** A desktop file whose rocket is named like the design on screen. */
const orkNamed = (name: string) => `<?xml version='1.0' encoding='utf-8'?>
<openrocket version="1.10" creator="OpenRocket 24.12">
  <rocket>
    <name>${name}</name>
    <subcomponents>
      <stage>
        <name>Sustainer</name>
        <subcomponents>
          <bodytube>
            <name>Body</name>
            <length>0.3</length>
            <thickness>0.0005</thickness>
            <radius>0.0125</radius>
          </bodytube>
        </subcomponents>
      </stage>
    </subcomponents>
  </rocket>
</openrocket>`;

const fileOf = (text: string) => {
  const bytes = new TextEncoder().encode(text);
  return { size: bytes.byteLength, arrayBuffer: async () => bytes.buffer as ArrayBuffer } as unknown as Blob;
};

function Host() {
  useWorkspaceEffects();
  return null;
}

const s = () => useWorkspaceStore.getState();
const flush = async () => {
  for (let i = 0; i < 100; i++) await Promise.resolve();
};

let kv: TestKv;
let original: DesignLibrary;
let a: string;
let b: string;

beforeEach(async () => {
  localStorage.clear();
  original = getDesignLibrary();
  kv = new TestKv();
  setDesignLibrary(new DesignLibrary(kv));
  s().resetWorkspace();
  const base = workspaceSnapshot(s());
  const lib = getDesignLibrary();
  b = (await lib.create('B', lean({ ...base, tree: { ...base.tree, name: 'Rocket B' } }))).id;
  a = (await lib.create('A', lean({ ...base, tree: { ...base.tree, name: 'Rocket A' } }))).id;
  renderWithProviders(<Host />);
  await act(flush);
  await act(() => s().refreshDesigns());
  expect(s().tree.name).toBe('Rocket A');
  expect(await lib.activeId()).toBe(a);
});

afterEach(() => {
  cleanup();
  setDesignLibrary(original);
});

/** Start opening B and stop inside its read, after it has named B active. */
async function openBHeld() {
  // The first read of B is openDesign's own check; the second is the open.
  const held = kv.hold(designKey(b), 1);
  const opening = s().openDesign(b);
  await held.reached;
  expect(kv.map.get(ACTIVE)).toBe(b);
  return { opening, release: held.release };
}

describe('an import that ends without replacing the design on screen', () => {
  it('points the library back at it when the import is abandoned', async () => {
    const { opening, release } = await openBHeld();
    // Overwrite the clashing design, and storage refuses the pointer write.
    const answer = useConfirmStore.subscribe((st) => {
      if (st.request) useConfirmStore.getState().settle(true);
    });
    kv.refuseNext(ACTIVE);
    try {
      await act(async () => {
        await s().openOrkFile(fileOf(orkNamed('A')));
        await flush();
      });
    } finally {
      answer();
    }
    // The refusal is what abandoned it.
    expect(s().storageWarning).toBeTruthy();
    release();
    await act(async () => {
      await opening;
      await flush();
    });

    expect(s().tree.name).toBe('Rocket A');
    expect(await getDesignLibrary().activeId()).toBe(a);
  });

  it('points the library back at it when the file does not parse', async () => {
    const { opening, release } = await openBHeld();
    await act(async () => {
      await s().openOrkFile(fileOf('not a design file'));
      await flush();
    });
    expect(s().err).toBeTruthy();
    release();
    await act(async () => {
      await opening;
      await flush();
    });

    expect(s().tree.name).toBe('Rocket A');
    expect(await getDesignLibrary().activeId()).toBe(a);
  });
});
