import type { Quantity } from './units';

/**
 * The bridge between `LaunchConditions` and SI.
 *
 * Launch conditions are stored in the .ork's own conventions, which are NOT all
 * SI: angles in degrees, temperature in Celsius, pressure in hPa. Everything
 * else in the app hands SI to the unit helpers, so these fields convert here
 * and nowhere else.
 *
 * It lives in its own module rather than inside LaunchPanel because it is pure
 * arithmetic — including the app's only offset conversion outside units.ts —
 * and the test runner only collects `.test.ts`, so logic parked in a `.tsx`
 * cannot be unit-tested at all.
 */
export interface LaunchUnitBridge {
  /** Which preference group the field is shown in. */
  q: Quantity;
  /** Stored value → SI. */
  toSi: (v: number) => number;
  /** SI → stored value. */
  fromSi: (v: number) => number;
}

const identity = (q: Quantity): LaunchUnitBridge => ({ q, toSi: (v) => v, fromSi: (v) => v });

export const LAUNCH_SI = {
  /** Launch-rod length: already meters. */
  length: identity('length'),
  /** Site and layer altitudes: already meters. */
  distance: identity('distance'),
  /** Wind speed and gusts: already m/s. */
  windspeed: identity('windspeed'),
  /** Rod angle, rod direction, wind direction: stored in degrees. */
  deg: {
    q: 'angle',
    toSi: (v: number) => (v * Math.PI) / 180,
    fromSi: (v: number) => (v * 180) / Math.PI,
  },
  /** Air temperature: stored in Celsius, SI is kelvin. */
  degC: {
    q: 'temperature',
    toSi: (v: number) => v + 273.15,
    fromSi: (v: number) => v - 273.15,
  },
  /** Air pressure: stored in hectopascals, SI is pascals. */
  hPa: {
    q: 'pressure',
    toSi: (v: number) => v * 100,
    fromSi: (v: number) => v / 100,
  },
  /** Constant gravity: already m/s^2. */
  accel: identity('acceleration'),
} satisfies Record<string, LaunchUnitBridge>;

export type LaunchUnitKind = keyof typeof LAUNCH_SI;
