import { describe, it, expect, vi } from 'vitest';

/**
 * store.ts calls `createFileSlice` while it loads. If fileSlice imported store
 * at run time, a module graph that reached fileSlice first would hand store a
 * `createFileSlice` still in its temporal dead zone.
 */
describe('fileSlice import order', () => {
  it('loads before the store without a TDZ error', async () => {
    vi.resetModules();
    await expect(import('../../src/state/fileSlice')).resolves.toHaveProperty('createFileSlice');
    const { useWorkspaceStore } = await import('../../src/state/store');
    expect(typeof useWorkspaceStore.getState().saveDesignAs).toBe('function');
  });
});
