import { describe, it, expect, beforeEach } from 'vitest';
import { fireAction } from '../../src/state/fireAction';
import { useWorkspaceStore } from '../../src/state/store';

/**
 * A click must not be able to fail in silence.
 *
 * Every async store action catches its own failures and reports them through
 * `err`, and that convention was the only thing making a bare `onSave()` in a
 * click handler safe. It was convention ONLY, which is the whole reason
 * `no-floating-promises` was worth enabling: an action that forgets leaves a
 * button that does nothing, with every gate green.
 *
 * `void onSave()` would have satisfied the linter and preserved the hazard exactly.
 * This is what was done instead, so the test is about the DIFFERENCE between the
 * two: a rejection reaches the banner.
 */
const s = () => useWorkspaceStore.getState();

describe('fireAction', () => {
  beforeEach(() => {
    s().setErr(null);
  });

  it('reports a rejection the action forgot to catch', async () => {
    fireAction(Promise.reject(new Error('the export blew up')));
    await Promise.resolve();
    await Promise.resolve();
    expect(s().err).toBe('the export blew up');
  });

  it('reports a non-Error rejection as its string', async () => {
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the case under test: a rejection that is not an Error
    fireAction(Promise.reject('just a string'));
    await Promise.resolve();
    await Promise.resolve();
    expect(s().err).toBe('just a string');
  });

  it('leaves the banner alone when the action succeeds', async () => {
    fireAction(Promise.resolve('fine'));
    await Promise.resolve();
    await Promise.resolve();
    expect(s().err).toBeNull();
  });

  it('passes a synchronous action straight through', () => {
    // So a caller does not have to know which actions are async. `undefined` is
    // what a void-returning action gives back.
    expect(() => fireAction(undefined)).not.toThrow();
    expect(s().err).toBeNull();
  });

  it('does not itself leave an unhandled rejection', async () => {
    // The point of the helper: the promise it is handed is terminated. If the
    // `.catch` were missing, this would print an unhandled rejection warning and
    // the error would never reach the user.
    const rejected = Promise.reject(new Error('handled'));
    fireAction(rejected);
    await expect(rejected.catch((e: unknown) => (e as Error).message)).resolves.toBe('handled');
    expect(s().err).toBe('handled');
  });
});
