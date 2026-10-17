import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * `resetEngine()` voids every handle, the open design's included. A file that
 * will not parse must leave that design's handle alive, so the reset waits for
 * the parse to succeed.
 */
const order = vi.hoisted(() => [] as string[]);
const resetEngine = vi.hoisted(() => vi.fn(() => order.push('reset')));
vi.mock('../../../src/engine/openRocketEngine', () => ({
  engineActive: () => true, // the kernel is loaded: the file goes through it
  OpenRocketDesign: {
    buildTree: () => {
      order.push('build');
      throw new Error('stop here: the build is not under test');
    },
  },
  resetEngine,
}));

const parseDesignFile = vi.hoisted(() => vi.fn());
vi.mock('../../../src/services/files/designFile', () => ({ parseDesignFile }));

const { loadOrk } = await import('../../../src/services/files/loadOrk');

beforeEach(() => {
  order.length = 0;
  resetEngine.mockClear();
  parseDesignFile.mockReset();
});

describe('loadOrk and the engine reset', () => {
  it('does not reset the engine for a file that does not parse', async () => {
    parseDesignFile.mockImplementation(() => {
      throw new Error('not a design file');
    });
    await expect(loadOrk(new Uint8Array([0xde, 0xad]).buffer)).rejects.toThrow('not a design file');
    expect(resetEngine).not.toHaveBeenCalled();
  });

  it('resets once the file has parsed, before building it', async () => {
    parseDesignFile.mockReturnValue({ tree: { name: 'R', components: [] }, notes: [], ignored: [] });
    await expect(loadOrk(new ArrayBuffer(0))).rejects.toThrow(/stop here/);
    expect(resetEngine).toHaveBeenCalledOnce();
    expect(order[0]).toBe('reset');
    expect(order).toContain('build');
  });
});
