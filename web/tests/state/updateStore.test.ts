import { describe, it, expect, beforeEach } from 'vitest';
import { useUpdateStore } from '../../src/state/updateStore';

/** The manual check's answers: up to date, a version waiting, or no answer at all. */
describe('useUpdateStore.checkNow', () => {
  beforeEach(() => useUpdateStore.setState({ checker: null, result: 'idle' }));

  it('does nothing where there is no worker to ask', async () => {
    await useUpdateStore.getState().checkNow();
    expect(useUpdateStore.getState().result).toBe('idle');
  });

  it('reports what the worker found', async () => {
    useUpdateStore.getState().setChecker(async () => 'upToDate');
    await useUpdateStore.getState().checkNow();
    expect(useUpdateStore.getState().result).toBe('upToDate');
    useUpdateStore.getState().setChecker(async () => 'available');
    await useUpdateStore.getState().checkNow();
    expect(useUpdateStore.getState().result).toBe('available');
  });

  it('says it is checking while it waits, and failed when the server does not answer', async () => {
    let fail!: (e: Error) => void;
    useUpdateStore.getState().setChecker(() => new Promise((_, reject) => (fail = reject)));
    const done = useUpdateStore.getState().checkNow();
    expect(useUpdateStore.getState().result).toBe('checking');
    fail(new Error('offline'));
    await done;
    expect(useUpdateStore.getState().result).toBe('failed');
  });
});
