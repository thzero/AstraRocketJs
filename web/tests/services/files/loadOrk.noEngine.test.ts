import { describe, it, expect, vi, beforeEach } from 'vitest';
import { KeyedError } from '../../../src/i18n/keyedError';

/**
 * A file opens before the engine has loaded.
 *
 * The app mounts before the kernel is downloaded, and the kernel's share of an
 * open (freeing the previous handles, probing the tree) is nothing the file
 * needs: the tree, the drawing and the exports read no kernel, and the rebuild
 * effect builds the design when the engine arrives. The engine module here has
 * the real one's shape with no engine behind it: every call in refuses with
 * `errors.engine.notReady`, as `eng()` does.
 */
const resetEngine = vi.hoisted(() => vi.fn());
const buildTree = vi.hoisted(() => vi.fn());
vi.mock('../../../src/engine/openRocketEngine', () => ({
  engineActive: () => false,
  resetEngine,
  OpenRocketDesign: { buildTree },
}));

const tree = {
  name: 'Early',
  components: [
    {
      id: 'stage',
      type: 'stage',
      children: [{ id: 'body', type: 'bodytube', length: 0.3, outerRadius: 0.0125, thickness: 0.0005 }],
    },
  ],
};
vi.mock('../../../src/services/files/designFile', () => ({
  parseDesignFile: () => ({ name: 'Early', tree, notes: [], ignored: [] }),
}));

vi.mock('../../../src/services/motors/motorDb', async (orig) => ({
  ...(await orig<typeof import('../../../src/services/motors/motorDb')>()),
  loadCatalog: async () => [],
}));

const { loadOrk } = await import('../../../src/services/files/loadOrk');

beforeEach(() => {
  const refuse = () => {
    throw new KeyedError('errors.engine.notReady');
  };
  resetEngine.mockReset().mockImplementation(refuse);
  buildTree.mockReset().mockImplementation(refuse);
});

describe('loadOrk with no engine loaded', () => {
  it('opens the file without the kernel and hands back the parsed tree', async () => {
    const loaded = await loadOrk(new ArrayBuffer(0));
    expect(loaded.tree).toBe(tree);
    expect(loaded.name).toBe('Early');
    expect(loaded.configs).toHaveLength(1);
    expect(loaded.design).toBeNull();
    expect(loaded.info).toBeNull();
  });

  it('neither resets the engine nor builds the design', async () => {
    await loadOrk(new ArrayBuffer(0));
    expect(resetEngine).not.toHaveBeenCalled();
    expect(buildTree).not.toHaveBeenCalled();
  });
});
