import { describe, it, expect, beforeEach } from 'vitest';
import { useWorkspaceStore, selectActive } from '../../src/state/store';

const active = () => selectActive(useWorkspaceStore.getState());

describe('clearSimPrefs', () => {
  beforeEach(() => {
    useWorkspaceStore.getState().clearSimPrefs();
  });

  it('drops every override so all of them follow the globals again', () => {
    const s = useWorkspaceStore.getState();
    s.setSimPref('timeStep', 0.01);
    s.setSimPref('maxTime', 300);
    expect(active().prefs).toEqual({ timeStep: 0.01, maxTime: 300 });

    useWorkspaceStore.getState().clearSimPrefs();
    // undefined, not {}: `prefs` is spread over the globals at run time, and the
    // editor reads "is anything overridden" from the key count.
    expect(active().prefs).toBeUndefined();
  });

  it('ages the cached result, because the next run can differ', () => {
    const s = useWorkspaceStore.getState();
    s.setSimPref('timeStep', 0.01);
    useWorkspaceStore.getState().clearSimPrefs();
    expect(active().outdated).toBe(true);
  });

  it('is a no-op when nothing was overridden', () => {
    expect(active().prefs).toBeUndefined();
    const before = active();
    useWorkspaceStore.getState().clearSimPrefs();
    // Same object: an edit that changes nothing must not open an undo entry or
    // flag a result that is still valid.
    expect(active()).toBe(before);
  });
});
