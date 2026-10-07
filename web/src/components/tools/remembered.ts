import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import type { LaunchConditions } from '../../services/design/orkTree';
import type { ToolSite } from './SiteFields';

/**
 * A tool's inputs and last result, kept for the page's life. Each tool is
 * mounted only while the Tools tab is open (hidden, its fields would be a
 * second Latitude and Longitude in the document), so this is what lets a trip
 * to another tab come back to the tool as it was left.
 */
export interface RememberedSlot<T> {
  value: Partial<T>;
  /** Keeps one field's latest value. */
  hold: <K extends keyof T>(key: K, value: T[K]) => void;
  /** Drops what is held, so the next mount starts from the defaults. */
  forget: () => void;
}

export function rememberedSlot<T>(): RememberedSlot<T> {
  const slot: RememberedSlot<T> = {
    value: {},
    hold: (key, value) => {
      slot.value[key] = value;
    },
    forget: () => {
      slot.value = {};
    },
  };
  return slot;
}

/**
 * `useState` for one field of a remembered slot: starts from the held value
 * when there is one (a held `null` is a value, so a cleared box stays cleared)
 * and writes every change back. `restore` adjusts a held value on the way in,
 * such as a request that was still out when the tab closed.
 */
export function useRemembered<T, K extends keyof T>(
  slot: RememberedSlot<T>,
  key: K,
  init: T[K],
  restore?: (held: T[K]) => T[K],
): [T[K], Dispatch<SetStateAction<T[K]>>] {
  const [value, setValue] = useState<T[K]>(() => {
    if (!(key in slot.value)) return init;
    const held = slot.value[key] as T[K];
    return restore ? restore(held) : held;
  });
  useEffect(() => {
    slot.hold(key, value);
  }, [slot, key, value]);
  return [value, setValue];
}

/** A tool's starting site: the launch defaults' coordinates, with the elevation left to the terrain model. */
export function defaultToolSite(defaults: Pick<LaunchConditions, 'latitudeDeg' | 'longitudeDeg'>): ToolSite {
  return { latitudeDeg: defaults.latitudeDeg, longitudeDeg: defaults.longitudeDeg, launchAltitudeM: null };
}
