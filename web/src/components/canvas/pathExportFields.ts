import {
  asAltitudeReference,
  asDistanceUnit,
  asStageTrackStart,
  asWaypointKinds,
  type FlightPathExportOptions,
} from '../../services/exports/flightPathExport';
import { decodeStageColors, encodeStageColors, type PathExportSettings } from '../../services/storage/settings';

/**
 * The flight-path export options that outlive one export, as ONE table that
 * both directions read: `hydrateExportOptions` fills the dialog from the store
 * and `persistedExportSettings` writes the dialog back. A field is remembered
 * by adding a row here, and a row cannot load without saving or save without
 * loading, so the two directions cannot drift.
 *
 * The mission name has no row on purpose: it describes one export, and a stale
 * value silently mislabels the next file (see PathExportSettings).
 */

/** The two unit fields, which are stored only once they are an explicit dialog choice. */
export type UnitField = 'altitude' | 'distance';

interface Field<O extends keyof FlightPathExportOptions, S extends keyof PathExportSettings> {
  option: O;
  setting: S;
  /** The dialog value from the stored one, or `fallback` where the stored one is absent or unreadable. */
  load: (stored: PathExportSettings[S], fallback: FlightPathExportOptions[O]) => FlightPathExportOptions[O];
  save: (value: FlightPathExportOptions[O]) => PathExportSettings[S];
  /** Set on a unit field: it stays ABSENT in the store until it is an explicit choice. */
  unit?: UnitField;
}

/** A row with its key pairing erased, so rows of different types share one array. */
interface AnyField {
  option: keyof FlightPathExportOptions;
  setting: keyof PathExportSettings;
  load: (stored: unknown, fallback: unknown) => unknown;
  save: (value: unknown) => unknown;
  unit?: UnitField;
}

const field = <O extends keyof FlightPathExportOptions, S extends keyof PathExportSettings>(f: Field<O, S>): AnyField =>
  f as unknown as AnyField;

type Shared = keyof FlightPathExportOptions & keyof PathExportSettings;

/** The options stored under their own name with the same type. */
type PlainKey = { [K in Shared]: FlightPathExportOptions[K] extends PathExportSettings[K] ? K : never }[Shared];

/** A field stored as-is under the same name, falling back only when absent. */
const plain = <K extends PlainKey>(key: K): AnyField =>
  field({
    option: key,
    setting: key,
    load: (stored, fallback) => (stored ?? fallback) as FlightPathExportOptions[K],
    // PlainKey guarantees the types match; the compiler cannot see that through K.
    save: (value) => value as unknown as PathExportSettings[K],
  });

/**
 * Each field falls back independently: a stored value that this build does not
 * recognize (an older store, a newer one, a hand edit) costs that field and
 * nothing else. Rows are in the order the stored object lists its keys.
 */
export const PATH_EXPORT_FIELDS: readonly AnyField[] = [
  field({
    option: 'labelWaypointsWithMission',
    setting: 'labelWaypointsWithMission',
    load: (stored) => stored,
    save: (value) => value,
  }),
  field({
    option: 'waypoints',
    setting: 'waypoints',
    // A saved EMPTY selection is a selection (the user unchecked every marker),
    // not an absence; only a missing or unreadable list falls back.
    load: (stored, fallback) => asWaypointKinds(stored) ?? fallback,
    save: (value) => [...value],
  }),
  plain('includeFlightPath'),
  plain('includeGroundTrack'),
  plain('pathStride'),
  // The units are the interesting case - ABSENT means follow the app's distance
  // preference, which is what a fresh install does, while a stored value is an
  // explicit dialog choice and outranks it.
  field({
    option: 'altitudeUnit',
    setting: 'altitudeUnit',
    load: (stored, fallback) => asDistanceUnit(stored) ?? fallback,
    save: (value) => value,
    unit: 'altitude',
  }),
  field({
    option: 'distanceUnit',
    setting: 'distanceUnit',
    load: (stored, fallback) => asDistanceUnit(stored) ?? fallback,
    save: (value) => value,
    unit: 'distance',
  }),
  field({
    option: 'altitudeReference',
    setting: 'altitudeReference',
    load: (stored, fallback) => asAltitudeReference(stored) ?? fallback,
    save: (value) => value,
  }),
  field({
    option: 'waypointAltitudeReference',
    setting: 'waypointAltitudeReference',
    load: (stored, fallback) => asAltitudeReference(stored) ?? fallback,
    save: (value) => value,
  }),
  plain('drawShadow'),
  field({
    option: 'stageTrackStart',
    setting: 'stageTrackStart',
    load: (stored, fallback) => asStageTrackStart(stored) ?? fallback,
    save: (value) => value,
  }),
  plain('showWaypointLabels'),
  plain('colorWaypointPins'),
  plain('includeDescriptions'),
  field({
    option: 'language',
    setting: 'exportLanguage',
    // '' is a real choice ("follow the app"), so unlike the units there is no
    // absent-means-something rule here: whatever is stored is what was picked.
    load: (stored, fallback) => stored ?? fallback,
    save: (value) => value,
  }),
  field({
    option: 'branchColors',
    setting: 'branchColors',
    load: (stored) => decodeStageColors(stored),
    save: (value) => encodeStageColors(value),
  }),
  field({
    option: 'branchGroundColors',
    setting: 'branchGroundColors',
    load: (stored) => decodeStageColors(stored),
    save: (value) => encodeStageColors(value),
  }),
  field({
    option: 'branchPinColors',
    setting: 'branchPinColors',
    load: (stored) => decodeStageColors(stored),
    save: (value) => encodeStageColors(value),
  }),
];

/** The dialog's opening options: `base` with every stored field laid over it. */
export function hydrateExportOptions(
  base: FlightPathExportOptions,
  stored: PathExportSettings,
): FlightPathExportOptions {
  const out = { ...base } as unknown as Record<string, unknown>;
  for (const f of PATH_EXPORT_FIELDS) out[f.option] = f.load(stored[f.setting], base[f.option]);
  return out as unknown as FlightPathExportOptions;
}

/**
 * The stored form of `next`. A unit field that is not an explicit choice is
 * left out, so the next open still follows the app's distance preference.
 */
export function persistedExportSettings(
  next: FlightPathExportOptions,
  explicit: Record<UnitField, boolean>,
): PathExportSettings {
  const out: Record<string, unknown> = {};
  for (const f of PATH_EXPORT_FIELDS) {
    if (f.unit && !explicit[f.unit]) continue;
    out[f.setting] = f.save(next[f.option]);
  }
  return out as unknown as PathExportSettings;
}
