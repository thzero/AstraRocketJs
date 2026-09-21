// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useLocationList } from './useLocationList';
import {
  setLaunchLocationStore,
  type LaunchLocation,
  type LaunchLocationStore,
} from '../../services/launchLocationStore';

/**
 * The ordering guard, which is the whole reason this hook exists.
 *
 * Not rendered under StrictMode here, unlike the component tests: the double
 * invoke would issue the mount read twice, and these tests count reads in order
 * to hold one of them open.
 */

const HOME: LaunchLocation = {
  id: 'home',
  name: 'Home field',
  latitudeDeg: 39.05,
  longitudeDeg: -104.8,
  launchAltitudeM: 1830,
};

const noWrites = { save: async () => undefined, remove: async () => undefined };

describe('useLocationList', () => {
  beforeEach(() => setLaunchLocationStore({ list: async () => [], ...noWrites }));

  it('reads the locations on mount', async () => {
    setLaunchLocationStore({ list: async () => [HOME], ...noWrites });
    const { result } = renderHook(() => useLocationList());
    await waitFor(() => expect(result.current.locations).toEqual([HOME]));
  });

  it('starts as null, so an unread list is not an empty one', () => {
    // The manage dialog shows "no saved locations yet" on an empty list, and would
    // flash it at somebody with a dozen if unread read as empty.
    const { result } = renderHook(() => useLocationList());
    expect(result.current.locations).toBeNull();
  });

  it('drops a first read that lands after a later one', async () => {
    // The real failure: IndexedDB's initial open makes the first list() the
    // slowest of the session. A location saved in the meantime refreshes and
    // resolves first; the stale answer then lands with the empty list it read
    // before the save, and the dropdown goes blank over a database that has
    // the location. Nothing retries, because nothing knows it is wrong.
    let landFirstRead!: (locations: LaunchLocation[]) => void;
    let reads = 0;
    const store: LaunchLocationStore = {
      list: async () => {
        reads += 1;
        if (reads === 1) return new Promise<LaunchLocation[]>((resolve) => (landFirstRead = resolve));
        return [HOME];
      },
      ...noWrites,
    };
    setLaunchLocationStore(store);

    const { result } = renderHook(() => useLocationList());
    expect(result.current.locations).toBeNull();

    // A save's refresh, issued while the mount read is still open.
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.locations).toEqual([HOME]);

    // Now the mount read finally lands, carrying the pre-save world.
    await act(async () => {
      landFirstRead([]);
    });
    expect(result.current.locations).toEqual([HOME]);
  });

  it('applies the newest read when they land in order', async () => {
    // The guard drops a SUPERSEDED answer, not every late one: a refresh after
    // a delete still has to empty the list.
    let locations = [HOME];
    setLaunchLocationStore({ list: async () => locations, ...noWrites });
    const { result } = renderHook(() => useLocationList());
    await waitFor(() => expect(result.current.locations).toEqual([HOME]));

    locations = [];
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.locations).toEqual([]);
  });

  it('settles on an empty list when the very first read fails', async () => {
    setLaunchLocationStore({
      list: async () => {
        throw new Error('blocked');
      },
      ...noWrites,
    });
    const { result } = renderHook(() => useLocationList());
    // Not left at null forever: a blocked IndexedDB would otherwise leave the
    // manage dialog showing nothing at all rather than "no saved locations yet".
    await waitFor(() => expect(result.current.locations).toEqual([]));
  });
});
