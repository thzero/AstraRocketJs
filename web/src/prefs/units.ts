/** Meters to millimeters. The unit constant for every dimensional export. */
export const M_TO_MM = 1000;

/**
 * User-selectable units of measure, mirroring the desktop's UnitGroup
 * (info.openrocket.core.unit). Quantities are the desktop's unit groups; the
 * factors come from UnitGroup.java. Conversion convention matches the desktop:
 *
 *     si = (ui + offset) * toSI        (offset is temperature-only)
 *
 * The kernel and every stored document stay pure SI / radians — these
 * conversions live at the UI edge ONLY. A unit that leaks inward is how the
 * desktop got bugs like #2475, and .ork round-trips must stay byte-stable.
 */

export type Quantity =
  | 'length' // component dimensions (UNITS_LENGTH)
  | 'motorDimensions' // motor diameter / length (UNITS_MOTOR_DIMENSIONS)
  | 'distance' // altitude, apogee, drift (UNITS_DISTANCE)
  | 'mass' // UNITS_MASS
  | 'velocity' // UNITS_VELOCITY
  | 'windspeed' // UNITS_WINDSPEED
  | 'acceleration' // UNITS_ACCELERATION
  | 'angle' // UNITS_ANGLE
  | 'density' // bulk material density (UNITS_DENSITY_BULK)
  | 'surfaceDensity' // fabric / sheet density (UNITS_DENSITY_SURFACE)
  | 'lineDensity' // cord / line density (UNITS_DENSITY_LINE)
  | 'temperature' // UNITS_TEMPERATURE
  | 'pressure' // UNITS_PRESSURE
  | 'force' // motor thrust (UNITS_FORCE)
  | 'impulse'; // total impulse (UNITS_IMPULSE)

export interface UnitDef {
  symbol: string;
  /** SI units per 1 of this unit. */
  toSI: number;
  /** Added to the UI value before scaling (temperature only). */
  offset?: number;
}

const VELOCITY_UNITS: UnitDef[] = [
  { symbol: 'm/s', toSI: 1 },
  { symbol: 'km/h', toSI: 1 / 3.6 },
  { symbol: 'ft/s', toSI: 0.3048 },
  { symbol: 'mph', toSI: 0.44704 },
  { symbol: 'kt', toSI: 0.51444445 },
];

export const UNITS: Record<Quantity, UnitDef[]> = {
  length: [
    { symbol: 'mm', toSI: 0.001 },
    { symbol: 'cm', toSI: 0.01 },
    { symbol: 'm', toSI: 1 },
    { symbol: 'in', toSI: 0.0254 },
    { symbol: 'ft', toSI: 0.3048 },
  ],
  motorDimensions: [
    { symbol: 'mm', toSI: 0.001 },
    { symbol: 'cm', toSI: 0.01 },
    { symbol: 'in', toSI: 0.0254 },
  ],
  distance: [
    { symbol: 'm', toSI: 1 },
    { symbol: 'km', toSI: 1000 },
    { symbol: 'ft', toSI: 0.3048 },
    { symbol: 'yd', toSI: 0.9144 },
    { symbol: 'mi', toSI: 1609.344 },
  ],
  mass: [
    { symbol: 'g', toSI: 0.001 },
    { symbol: 'kg', toSI: 1 },
    { symbol: 'oz', toSI: 0.0283495231 },
    { symbol: 'lb', toSI: 0.45359237 },
  ],
  velocity: VELOCITY_UNITS,
  windspeed: VELOCITY_UNITS,
  acceleration: [
    { symbol: 'm/s²', toSI: 1 },
    { symbol: 'ft/s²', toSI: 0.3048 },
    { symbol: 'G', toSI: 9.80665 },
  ],
  angle: [
    { symbol: '°', toSI: Math.PI / 180 },
    { symbol: 'rad', toSI: 1 },
  ],
  density: [
    { symbol: 'kg/m³', toSI: 1 },
    { symbol: 'g/cm³', toSI: 1000 },
    { symbol: 'oz/in³', toSI: 1729.99404 },
    { symbol: 'lb/ft³', toSI: 16.0184634 },
  ],
  // Areal and linear densities. Unlike the groups above (copied from
  // UnitGroup.java), these factors are WRITTEN AS THE DEFINING DIVISION rather
  // than a decimal, so each one can be checked by eye: an ounce per square yard
  // is one ounce over one square yard, and nothing is lost to a typo.
  surfaceDensity: [
    { symbol: 'kg/m²', toSI: 1 },
    { symbol: 'g/m²', toSI: 0.001 },
    { symbol: 'g/cm²', toSI: 0.001 / 0.0001 },
    { symbol: 'oz/yd²', toSI: 0.0283495231 / 0.83612736 },
    { symbol: 'oz/ft²', toSI: 0.0283495231 / 0.09290304 },
    { symbol: 'lb/ft²', toSI: 0.45359237 / 0.09290304 },
  ],
  lineDensity: [
    { symbol: 'kg/m', toSI: 1 },
    { symbol: 'g/m', toSI: 0.001 },
    { symbol: 'g/cm', toSI: 0.001 / 0.01 },
    { symbol: 'oz/ft', toSI: 0.0283495231 / 0.3048 },
    { symbol: 'oz/in', toSI: 0.0283495231 / 0.0254 },
    { symbol: 'lb/ft', toSI: 0.45359237 / 0.3048 },
  ],
  temperature: [
    { symbol: '°C', toSI: 1, offset: 273.15 },
    { symbol: '°F', toSI: 5 / 9, offset: 459.67 },
    { symbol: 'K', toSI: 1 },
  ],
  pressure: [
    { symbol: 'mbar', toSI: 100 },
    { symbol: 'hPa', toSI: 100 },
    { symbol: 'bar', toSI: 1.0e5 },
    { symbol: 'atm', toSI: 1.01325e5 },
    { symbol: 'mmHg', toSI: 101325 / 760 },
    { symbol: 'inHg', toSI: 3386.389 },
    { symbol: 'psi', toSI: 6894.75729 },
    { symbol: 'Pa', toSI: 1 },
  ],
  force: [
    { symbol: 'N', toSI: 1 },
    { symbol: 'lbf', toSI: 4.4482216 },
  ],
  impulse: [
    { symbol: 'N·s', toSI: 1 },
    { symbol: 'lbf·s', toSI: 4.4482216 },
  ],
};

/** Every quantity, in the order the preferences UI lists them. */
export const QUANTITIES = Object.keys(UNITS) as Quantity[];

export type UnitSelection = Record<Quantity, string>;

/**
 * Units changed from an inline chip, keyed by the FIELD the chip sits on — not
 * by quantity. Setting the nose cone's Length to inches changes that readout
 * and nothing else: not its Thickness, not the tree, not the stats strip.
 *
 * Per-field rather than per-quantity because changing a unit where you are
 * reading is a local act. A chip that silently re-based every length in the app
 * is a big effect to hang off a small control, and the owner's call is that it
 * should not (2026-09-13).
 *
 * A field with no entry here follows Settings ▸ Units, and keeps following it
 * — so changing a default still moves everything the user never touched.
 *
 * Keys come from `unitScope()`. Values are unit symbols, validated lazily by
 * `unitFor` against the quantity the field turns out to be, since a key alone
 * does not say which quantity it belongs to. (The .ork format has nowhere to
 * put any of this — its only `unit` tokens are the per-stat SI labels inside
 * the optional <designinfo> block — so, like desktop OpenRocket, it lives in
 * app preferences.)
 */
export type UnitOverrides = Record<string, string>;

/**
 * A stable id for one unit-bearing field. Parts are joined with '.', so a
 * caller reads as `unitScope('prop', node.type, field.key)`.
 *
 * Component fields are scoped BY COMPONENT TYPE, not per instance: selecting
 * another body tube must not forget the unit you just set, and every body tube
 * is the same field on the same card.
 */
export function unitScope(...parts: (string | number)[]): string {
  return parts.join('.');
}

/**
 * Desktop UnitGroup.setDefaultMetricUnits() — and the app's starting units: a
 * fresh install, an older settings blob with no `units` key, and the Units
 * tab's Reset all land here.
 *
 * There is deliberately only ONE metric set. Having two (the app's original
 * hard-coded mm / kg·m⁻³ as the default, the desktop's cm / g·cm⁻³ as the
 * preset) left Reset and "Metric defaults" disagreeing about length and
 * density, with nothing on screen to explain why.
 */
export const METRIC_UNITS: UnitSelection = {
  length: 'cm',
  motorDimensions: 'mm',
  distance: 'm',
  mass: 'g',
  velocity: 'm/s',
  windspeed: 'm/s',
  acceleration: 'm/s²',
  angle: '°',
  density: 'g/cm³',
  surfaceDensity: 'kg/m²',
  lineDensity: 'kg/m',
  temperature: '°C',
  pressure: 'hPa',
  force: 'N',
  impulse: 'N·s',
};

/** Desktop UnitGroup.setDefaultImperialUnits(). */
export const IMPERIAL_UNITS: UnitSelection = {
  length: 'in',
  motorDimensions: 'in',
  distance: 'ft',
  mass: 'oz',
  velocity: 'ft/s',
  windspeed: 'mph',
  acceleration: 'ft/s²',
  angle: '°',
  density: 'oz/in³',
  // Fabric and cord are sold by these in the US, the way bulk stock is by oz/in³.
  surfaceDensity: 'oz/yd²',
  lineDensity: 'oz/ft',
  temperature: '°F',
  pressure: 'psi',
  force: 'lbf',
  impulse: 'lbf·s',
};

/**
 * What an export should be written in. An export is a document that outlives
 * the session and often goes to someone else, so its units are its own choice
 * rather than whatever the app happened to be showing — but `current` keeps
 * them in step for the common case of printing what you are looking at.
 */
export type UnitChoice = 'current' | 'metric' | 'imperial';

export const UNIT_CHOICES: UnitChoice[] = ['current', 'metric', 'imperial'];

/** Resolve an export's unit choice against the units currently on screen. */
export function resolveUnitChoice(choice: UnitChoice, current: UnitSelection): UnitSelection {
  if (choice === 'metric') return METRIC_UNITS;
  if (choice === 'imperial') return IMPERIAL_UNITS;
  return current;
}

function unitDef(quantity: Quantity, symbol: string): UnitDef {
  const list = UNITS[quantity];
  return list.find((u) => u.symbol === symbol) ?? list[0]!;
}

/** SI → the user's unit. */
export function siToUi(quantity: Quantity, symbol: string, si: number): number {
  const u = unitDef(quantity, symbol);
  return si / u.toSI - (u.offset ?? 0);
}

/** The user's unit → SI. */
export function uiToSi(quantity: Quantity, symbol: string, ui: number): number {
  const u = unitDef(quantity, symbol);
  return (ui + (u.offset ?? 0)) * u.toSI;
}

/**
 * SI → the user's unit for a DIFFERENCE rather than a reading: the temperature
 * offset cancels across a delta, so a 1 K step is 1 °C and not −272.15 °C.
 */
export function siToUiDelta(quantity: Quantity, symbol: string, si: number): number {
  return si / unitDef(quantity, symbol).toSI;
}

/** Rounds a converted step to a "nice" 1–2–5 value so spinners stay usable. */
/**
 * A 1-2-5 step for a SPINNER increment, in the user's unit.
 *
 * Not the same function as `schematicGeometry.niceRulerStep`, which divides by
 * 8 first and has a 2.5 rung: normalized 2.2 gives 2 here and 2.5 there. They
 * shared the name `niceStep`, so importing the wrong one gave tick spacing
 * off by ~8x with no type error and nothing cross-referencing them.
 */
export function niceStep(x: number): number {
  if (!(x > 0) || !Number.isFinite(x)) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(x)));
  const m = x / mag;
  const nice = m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10;
  return nice * mag;
}

/**
 * Format an SI value in the selected unit. With `digits`, shows UP TO that many
 * decimals (trailing zeros stripped); without, a magnitude ladder. Plain ASCII
 * digits — locale-aware display goes through i18n/format's `fmtNum` instead
 * (see prefs/useUnits), so this stays usable from non-React export code.
 */
export function fmtSi(quantity: Quantity, symbol: string, si: number, digits?: number): string {
  if (si === null || si === undefined || !Number.isFinite(si)) return '—';
  const v = siToUi(quantity, symbol, si);
  if (digits !== undefined) return String(Number(v.toFixed(digits)));
  const a = Math.abs(v);
  return v.toFixed(a >= 100 ? 0 : a >= 10 ? 1 : a >= 1 ? 2 : 3);
}

/**
 * Drop anything a stored preference blob holds that this build doesn't know —
 * an unknown symbol would make every readout of that quantity fall back to the
 * first unit silently, and a hand-edited store shouldn't be able to do that.
 */
export function normalizeUnits(raw: unknown): UnitSelection {
  const out = { ...METRIC_UNITS };
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  for (const q of QUANTITIES) {
    const sym = r[q];
    if (typeof sym === 'string' && UNITS[q].some((u) => u.symbol === sym)) out[q] = sym;
  }
  return out;
}

/**
 * Same, for the per-field override layer: an absent field stays absent (it
 * means "follow the saved default").
 */
export function normalizeUnitOverrides(raw: unknown): UnitOverrides {
  const out: UnitOverrides = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [scope, sym] of Object.entries(raw as Record<string, unknown>)) {
    // Only the shape is checked here. Whether the symbol suits the field's
    // quantity is `unitFor`'s job: a scope key does not name its quantity, and
    // a field that no longer exists has no quantity to check against at all.
    if (typeof sym === 'string' && sym) out[scope] = sym;
  }
  return out;
}

/**
 * The unit one field is shown in: its own override if it has a valid one, else
 * the Settings default for its quantity.
 *
 * The symbol is checked against THIS quantity, which is where a stale or
 * hand-edited store gets caught — a key says nothing about which quantity it
 * belongs to, and 'in' left over from a length field would otherwise be handed
 * to a mass readout, where `unitDef` would quietly fall back to grams and hide
 * the problem.
 */
export function unitFor(units: UnitSelection, overrides: UnitOverrides, quantity: Quantity, scope?: string): string {
  const sym = scope ? overrides[scope] : undefined;
  return sym && UNITS[quantity].some((u) => u.symbol === sym) ? sym : units[quantity];
}

/**
 * Just the symbol lookup, so a SERVICE can render a figure in the reader's unit
 * without importing the settings module.
 *
 * Services under `services/` sit in an import cycle with `settings.ts` (settings
 * → simulations → safetyLimits/runnability), so one of them reaching for
 * `loadSettings()` is a module-init crash rather than a layering opinion. The
 * caller resolves the units and passes them down instead. `Units` from
 * `useUnits` satisfies this, so a component passes itself.
 */
export interface UnitSymbols {
  sym: (q: Quantity) => string;
}

/** {@link UnitSymbols} from a stored preference blob, for code outside React. */
export function unitSymbols(units: UnitSelection, overrides: UnitOverrides): UnitSymbols {
  return { sym: (q) => unitFor(units, overrides, q) };
}
