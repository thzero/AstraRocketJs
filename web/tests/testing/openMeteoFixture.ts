import { ALOFT_VARS, SURFACE_VARS, unitFor } from '../../src/services/weather/openMeteo';

/**
 * Open-Meteo answers for tests, in the service's own shape, so no test reaches
 * the network. Every variable is filled from a plausible column: the surface at
 * 12 °C and 850 hPa (a pad near 1500 m), pressure levels at the heights the
 * barometric formula gives them.
 */
/** An answer in Open-Meteo's shape: `hours` hourly samples from `start`, every variable filled. */
export function answer(
  elevation: number,
  { start = 1_760_000_400, hours = 3, archive = false, units = {} as Record<string, string> } = {},
) {
  const vars = ['time', ...SURFACE_VARS, ...(archive ? [] : ALOFT_VARS)];
  const hourly: Record<string, number[]> = {};
  const hourlyUnits: Record<string, string> = {};
  for (const v of vars) {
    hourlyUnits[v] = units[v] ?? unitFor(v);
    hourly[v] = Array.from({ length: hours }, (_, i) => valueFor(v, i, start));
  }
  return { elevation, timezone: 'America/Denver', hourly_units: hourlyUnits, hourly };
}

function valueFor(v: string, i: number, start: number): number {
  if (v === 'time') return start + i * 3600;
  if (v === 'temperature_2m') return 12 + i;
  if (v === 'relative_humidity_2m') return 40;
  if (v === 'surface_pressure') return 850;
  if (v === 'wind_speed_10m') return 4;
  if (v === 'wind_gusts_10m') return 7;
  if (v === 'wind_direction_10m') return 270;
  const p = /_(\d+)hPa$/.exec(v);
  if (p) {
    const hPa = Number(p[1]);
    // A standard-ish column: height from the pressure, colder with height.
    const h = 44330 * (1 - (hPa / 1013.25) ** 0.1903);
    if (v.startsWith('geopotential_height_')) return Math.round(h);
    if (v.startsWith('temperature_')) return 15 - 0.0065 * h;
    if (v.startsWith('relative_humidity_')) return 30;
    if (v.startsWith('wind_speed_')) return 10;
    return 280;
  }
  if (v.startsWith('wind_speed_')) return 6;
  return 275;
}
