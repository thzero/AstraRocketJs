import type { FlightResult, FlightSeries } from '../engine/openRocketEngine';
import type { Quantity } from '../prefs/units';

/**
 * What a flight CSV can carry: one entry per series the run actually recorded.
 *
 * The list is built from the RESULT rather than hard-coded, because which series
 * are present depends on how the simulation was run (`SimulationOptions.series`:
 * the default `summary` set, or `full`). Offering a column the file cannot fill
 * would be a menu of empty promises.
 *
 * The friendly dozen come first and in a fixed order, because that is the order
 * anyone reading a flight expects; the rest follow by symbol. A column's unit
 * comes from the user's preference where the quantity has one, and is fixed
 * where it does not (Mach, calibers).
 */
export interface FlightColumn {
  /** Key into `FlightSeries` — `altitude`, `Px`, `Cd`… */
  key: string;
  /** i18n key for the human name, or null when only the symbol is known. */
  labelKey: string | null;
  /** Preference group supplying both the scale and the unit symbol. */
  quantity?: Quantity;
  /** Fixed unit symbol, for series with no user-selectable unit. */
  unit?: string;
  /** SI → display multiplier for a fixed-unit series (kg→g, m→cm, rad→deg). */
  scale?: number;
}

/**
 * The series the app names, in reading order.
 *
 * Everything else a run records is still exportable — it just carries its
 * kernel symbol as its name, which is what the symbol means to anyone who asked
 * for the full set in the first place.
 */
const KNOWN: FlightColumn[] = [
  { key: 'time', labelKey: 'flight.time', unit: 's' },
  { key: 'altitude', labelKey: 'flight.altitude', quantity: 'distance' },
  { key: 'velocity', labelKey: 'flight.velocity', quantity: 'velocity' },
  { key: 'acceleration', labelKey: 'flight.acceleration', quantity: 'acceleration' },
  { key: 'mass', labelKey: 'flight.mass', unit: 'g', scale: 1000 },
  { key: 'thrust', labelKey: 'flight.thrust', quantity: 'force' },
  { key: 'drag', labelKey: 'flight.drag', quantity: 'force' },
  { key: 'mach', labelKey: 'flight.mach', unit: '' },
  { key: 'stability', labelKey: 'flight.stability', unit: 'cal' },
  { key: 'cpLocation', labelKey: 'flight.cp', quantity: 'length' },
  { key: 'cgLocation', labelKey: 'flight.cg', quantity: 'length' },
  { key: 'aoa', labelKey: 'flight.aoa', quantity: 'angle' },
];

/**
 * The horizontal track: where the rocket was over the ground.
 *
 * Named by the kernel table below, but singled out here because it belongs in
 * the DEFAULT export - it is the only thing in the file that answers "where
 * does it land", and it was the reason the columns were added at all.
 */
const TRACK_KEYS = ['Px', 'Py', 'Pl', 'θl'];

/**
 * Everything else the kernel records, named as OpenRocket names it.
 *
 * Generated from `FlightDataType.java` and its `messages.properties` — symbol,
 * translated name and unit group — so a variable reads the same here as in the
 * desktop app rather than appearing as a bare "Abx". The app's own dozen are
 * excluded: they already have names and keys of their own above.
 */
const KERNEL: FlightColumn[] = [
  { key: 'ha', labelKey: 'flightVar.ha', quantity: 'distance' },
  { key: 'Vz', labelKey: 'flightVar.Vz', quantity: 'velocity' },
  { key: 'Az', labelKey: 'flightVar.Az', quantity: 'acceleration' },
  { key: 'Ax', labelKey: 'flightVar.Ax', quantity: 'acceleration' },
  { key: 'Ay', labelKey: 'flightVar.Ay', quantity: 'acceleration' },
  { key: 'Abx', labelKey: 'flightVar.Abx', quantity: 'acceleration' },
  { key: 'Aby', labelKey: 'flightVar.Aby', quantity: 'acceleration' },
  { key: 'Abz', labelKey: 'flightVar.Abz', quantity: 'acceleration' },
  { key: 'Px', labelKey: 'flightVar.Px', quantity: 'distance' },
  { key: 'Py', labelKey: 'flightVar.Py', quantity: 'distance' },
  { key: 'Pl', labelKey: 'flightVar.Pl', quantity: 'distance' },
  { key: 'θl', labelKey: 'flightVar.θl', quantity: 'angle' },
  { key: 'Vl', labelKey: 'flightVar.Vl', quantity: 'velocity' },
  { key: 'Al', labelKey: 'flightVar.Al', quantity: 'acceleration' },
  { key: 'φ', labelKey: 'flightVar.φ', unit: '° N' },
  { key: 'λ', labelKey: 'flightVar.λ', unit: '° E' },
  { key: 'α', labelKey: 'flightVar.α', quantity: 'angle' },
  { key: 'dΦ', labelKey: 'flightVar.dΦ', unit: 'r/s' },
  { key: 'dθ', labelKey: 'flightVar.dθ', unit: 'r/s' },
  { key: 'dΨ', labelKey: 'flightVar.dΨ', unit: 'r/s' },
  { key: 'Θ', labelKey: 'flightVar.Θ', quantity: 'angle' },
  { key: 'Φ', labelKey: 'flightVar.Φ', quantity: 'angle' },
  { key: 'mp', labelKey: 'flightVar.mp', quantity: 'mass' },
  { key: 'Il', labelKey: 'flightVar.Il', unit: 'kg·m²' },
  { key: 'Ir', labelKey: 'flightVar.Ir', unit: 'kg·m²' },
  { key: 'g', labelKey: 'flightVar.g', quantity: 'acceleration' },
  { key: 'ζ', labelKey: 'flightVar.ζ', unit: '' },
  { key: 'ωn', labelKey: 'flightVar.ωn', unit: 'r/s' },
  { key: 'R', labelKey: 'flightVar.R', unit: '' },
  { key: 'Ft', labelKey: 'flightVar.Ft', quantity: 'force' },
  { key: 'Twr', labelKey: 'flightVar.Twr', unit: '' },
  { key: 'Cd', labelKey: 'flightVar.Cd', unit: '' },
  { key: 'Cdf', labelKey: 'flightVar.Cdf', unit: '' },
  { key: 'Cdp', labelKey: 'flightVar.Cdp', unit: '' },
  { key: 'Cdb', labelKey: 'flightVar.Cdb', unit: '' },
  { key: 'Cda', labelKey: 'flightVar.Cda', unit: '' },
  { key: 'Cn', labelKey: 'flightVar.Cn', unit: '' },
  { key: 'Cθ', labelKey: 'flightVar.Cθ', unit: '' },
  { key: 'CτΨ', labelKey: 'flightVar.CτΨ', unit: '' },
  { key: 'Cτs', labelKey: 'flightVar.Cτs', unit: '' },
  { key: 'CτΦ', labelKey: 'flightVar.CτΦ', unit: '' },
  { key: 'CfΦ', labelKey: 'flightVar.CfΦ', unit: '' },
  { key: 'CζΦ', labelKey: 'flightVar.CζΦ', unit: '' },
  { key: 'Cζθ', labelKey: 'flightVar.Cζθ', unit: '' },
  { key: 'CζΨ', labelKey: 'flightVar.CζΨ', unit: '' },
  { key: 'Cdm', labelKey: 'flightVar.Cdm', unit: 'kg·m²/s' },
  { key: 'Cdm_aero', labelKey: 'flightVar.Cdm_aero', unit: 'kg·m²/s' },
  { key: 'Cdm_prop', labelKey: 'flightVar.Cdm_prop', unit: 'kg·m²/s' },
  { key: 'Ccm', labelKey: 'flightVar.Ccm', unit: 'N·m' },
  { key: 'Ac', labelKey: 'flightVar.Ac', quantity: 'acceleration' },
  { key: 'Lr', labelKey: 'flightVar.Lr', quantity: 'length' },
  { key: 'Ar', labelKey: 'flightVar.Ar', unit: 'm²' },
  { key: 'Vw', labelKey: 'flightVar.Vw', quantity: 'velocity' },
  { key: 'θw', labelKey: 'flightVar.θw', quantity: 'angle' },
  { key: 'T', labelKey: 'flightVar.T', quantity: 'temperature' },
  { key: 'P', labelKey: 'flightVar.P', quantity: 'pressure' },
  { key: 'ρ', labelKey: 'flightVar.ρ', quantity: 'density' },
  { key: 'Vs', labelKey: 'flightVar.Vs', quantity: 'velocity' },
  { key: 'dt', labelKey: 'flightVar.dt', unit: 's' },
  { key: 'tc', labelKey: 'flightVar.tc', unit: 'ms' },
];

/** Every column, ours first so a flight reads in the order people expect. */
const ALL: FlightColumn[] = [...KNOWN, ...KERNEL];

const KNOWN_KEYS = new Set(ALL.map((c) => c.key));

/** The series of one branch: the numbered one, or the top-level trajectory. */
export function branchSeries(result: FlightResult, branchIndex: number): FlightSeries | undefined {
  return result.branches?.length ? result.branches[branchIndex]?.series : result.series;
}

/**
 * Every column this result can fill, for the given branch.
 *
 * A key counts as present when it holds an array — an empty one included, since
 * an empty series is a recorded series with nothing in it rather than a missing
 * one, and hiding it would make the offer depend on the flight rather than on
 * the run settings.
 */
export function flightColumns(result: FlightResult, branchIndex = 0): FlightColumn[] {
  const series = branchSeries(result, branchIndex);
  if (!series) return [];
  const has = (k: string) => Array.isArray((series as Record<string, unknown>)[k]);
  const out = ALL.filter((c) => has(c.key));
  for (const k of Object.keys(series)) {
    if (KNOWN_KEYS.has(k) || !has(k)) continue;
    out.push({ key: k, labelKey: null, unit: '' });
  }
  return out;
}

/** The columns a fresh export starts from: the friendly dozen plus the track. */
export const DEFAULT_CSV_COLUMNS: readonly string[] = [...KNOWN.map((c) => c.key), ...TRACK_KEYS];

/** Keep only the keys this result can actually fill, in column order. */
export function usableColumns(all: readonly FlightColumn[], wanted: readonly string[]): FlightColumn[] {
  const want = new Set(wanted);
  return all.filter((c) => want.has(c.key));
}
