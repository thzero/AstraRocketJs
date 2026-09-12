import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const load = async () => {
  vi.resetModules();
  return (await import('./persistStorage')).requestPersistentStorage;
};

const stubStorage = (s: unknown) => vi.stubGlobal('navigator', { storage: s });

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

describe('requestPersistentStorage', () => {
  it('requests persistence when not yet granted', async () => {
    const persist = vi.fn().mockResolvedValue(true);
    stubStorage({ persisted: vi.fn().mockResolvedValue(false), persist });
    await expect((await load())()).resolves.toBe(true);
    expect(persist).toHaveBeenCalledOnce();
  });

  it('does not re-request when already granted', async () => {
    const persist = vi.fn();
    stubStorage({ persisted: vi.fn().mockResolvedValue(true), persist });
    await expect((await load())()).resolves.toBe(true);
    expect(persist).not.toHaveBeenCalled();
  });

  it('only asks once per session — autosave fires on every edit', async () => {
    const persist = vi.fn().mockResolvedValue(false);
    stubStorage({ persisted: vi.fn().mockResolvedValue(false), persist });
    const req = await load();
    await Promise.all([req(), req(), req()]);
    expect(persist).toHaveBeenCalledOnce();
  });

  it('reports false rather than throwing when the API is missing', async () => {
    stubStorage(undefined); // Safari < 17 and older browsers
    await expect((await load())()).resolves.toBe(false);
  });

  it('swallows a rejection — the app works unpersisted', async () => {
    stubStorage({
      persisted: vi.fn().mockResolvedValue(false),
      persist: vi.fn().mockRejectedValue(new Error('blocked by policy')),
    });
    await expect((await load())()).resolves.toBe(false);
  });
});
