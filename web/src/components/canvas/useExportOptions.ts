import { useRef, useState } from 'react';
import {
  asDistanceUnit,
  defaultExportOptions,
  type DistanceUnit,
  type FlightPathExportOptions,
} from '../../services/exports/flightPathExport';
import { useUnits } from '../../prefs/useUnits';
import { useSettings } from '../../state/SettingsProvider';
import { hydrateExportOptions, persistedExportSettings, type UnitField } from './pathExportFields';

/**
 * Owns the flight-path export dialog's options: the state, hydrated from the
 * stored preferences on first render, and the writers that change it. `change`
 * updates the dialog and the store together; `patchOpts` updates the dialog
 * only and is for the mission name, which is never stored. Which fields are
 * stored, and how, is `PATH_EXPORT_FIELDS`.
 */
export function useExportOptions(): {
  opts: FlightPathExportOptions;
  patchOpts: (patch: Partial<FlightPathExportOptions>) => FlightPathExportOptions;
  change: (patch: Partial<FlightPathExportOptions>) => void;
  setUnit: (which: UnitField, unit: DistanceUnit) => void;
} {
  const units = useUnits();
  const { settings, update } = useSettings();
  // Carried in from last time, except the mission name - see
  // PathExportSettings for why that one still starts fresh every export.
  const [opts, setOpts] = useState<FlightPathExportOptions>(() =>
    hydrateExportOptions(defaultExportOptions(units.sym('distance')), settings.pathExport),
  );
  // Which of the two unit fields is an explicit dialog choice. A stored unit
  // is one; so is any pick made here. Anything else stays ABSENT in the store,
  // so the next open still follows the app's distance preference rather than
  // whatever unit the app happened to show the first time this dialog opened.
  const explicitUnits = useRef<Record<UnitField, boolean>>({
    altitude: asDistanceUnit(settings.pathExport.altitudeUnit) !== undefined,
    distance: asDistanceUnit(settings.pathExport.distanceUnit) !== undefined,
  });
  // Write the preference-shaped fields back from the handlers that change them,
  // and nowhere else. An effect keyed on `opts` would run on mount and on every
  // keystroke in the mission field, and each write recreates the settings context
  // and hits localStorage. The mission name is excluded at the source (it is not
  // in PathExportSettings), so it cannot leak into the store.
  const persist = (next: FlightPathExportOptions) => {
    update({ pathExport: persistedExportSettings(next, explicitUnits.current) });
  };
  // The latest options, for handlers. Spreading the render's closed-over `opts`
  // builds the second of two changes committed in one tick on a stale copy and
  // drops the first. A ref that every writer updates gives the handlers the
  // current value without a side effect inside a state updater.
  const optsRef = useRef(opts);
  const patchOpts = (patch: Partial<FlightPathExportOptions>): FlightPathExportOptions => {
    const next = { ...optsRef.current, ...patch };
    optsRef.current = next;
    setOpts(next);
    return next;
  };
  /** Change persisted option(s): the dialog AND the store. Every handler
   *  in the dialog except the mission field's goes through this. */
  const change = (patch: Partial<FlightPathExportOptions>) => persist(patchOpts(patch));
  /** A unit picked in the dialog: a dialog choice, stored from now on. */
  const setUnit = (which: UnitField, unit: DistanceUnit) => {
    explicitUnits.current[which] = true;
    change(which === 'altitude' ? { altitudeUnit: unit } : { distanceUnit: unit });
  };
  return { opts, patchOpts, change, setUnit };
}
