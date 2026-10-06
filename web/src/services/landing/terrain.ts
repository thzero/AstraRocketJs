import { fetchElevations, type FetchOpts } from '../weather/openMeteo';
import { offsetToLatLon } from '../map/geodesy';

/**
 * The ground around a launch site, so a descent can end where it meets the
 * ground rather than at the pad's height: a drift over a hill lands on the
 * hill, one into a valley lands lower.
 *
 * A square grid of the terrain model's heights (Open-Meteo's elevation API, a
 * 90 m model) centered on the pad, read between its points by bilinear
 * interpolation and held at its edge outside it.
 */

export interface TerrainGrid {
  south: number;
  west: number;
  north: number;
  east: number;
  /** Points per side. */
  n: number;
  /** Heights (m above sea level), row by row from the south, west to east in each. */
  heights: number[];
}

/** Points per side: 15 x 15 = 225 heights, three requests, about 70 m apart over a 1 km half-width. */
export const TERRAIN_POINTS = 15;

/** The grid's corners, `halfWidthM` meters each way from the site. */
export function terrainBounds(latDeg: number, lonDeg: number, halfWidthM: number) {
  const ne = offsetToLatLon(latDeg, lonDeg, { east: halfWidthM, north: halfWidthM });
  const sw = offsetToLatLon(latDeg, lonDeg, { east: -halfWidthM, north: -halfWidthM });
  return { south: sw.lat, west: sw.lon, north: ne.lat, east: ne.lon };
}

/** The grid's points, in the order `heights` holds them. */
export function terrainPoints(b: ReturnType<typeof terrainBounds>, n = TERRAIN_POINTS) {
  const out: { latitudeDeg: number; longitudeDeg: number }[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      out.push({
        latitudeDeg: b.south + ((b.north - b.south) * i) / (n - 1),
        longitudeDeg: b.west + ((b.east - b.west) * j) / (n - 1),
      });
    }
  }
  return out;
}

/** The ground height at a point, from the grid. */
export function groundAt(grid: TerrainGrid): (latDeg: number, lonDeg: number) => number {
  const { south, west, north, east, n, heights } = grid;
  const at = (i: number, j: number) => heights[i * n + j]!;
  return (lat, lon) => {
    const fi = Math.min(n - 1, Math.max(0, ((lat - south) / (north - south)) * (n - 1)));
    const fj = Math.min(n - 1, Math.max(0, ((lon - west) / (east - west)) * (n - 1)));
    const i0 = Math.min(n - 2, Math.floor(fi));
    const j0 = Math.min(n - 2, Math.floor(fj));
    const ti = fi - i0;
    const tj = fj - j0;
    const south0 = at(i0, j0) * (1 - tj) + at(i0, j0 + 1) * tj;
    const north0 = at(i0 + 1, j0) * (1 - tj) + at(i0 + 1, j0 + 1) * tj;
    return south0 * (1 - ti) + north0 * ti;
  };
}

/** The grid around a site, fetched. Throws `WeatherError` like the weather requests. */
export async function fetchTerrain(
  latDeg: number,
  lonDeg: number,
  halfWidthM: number,
  apiKey: string | undefined,
  o: FetchOpts = {},
): Promise<TerrainGrid> {
  const b = terrainBounds(latDeg, lonDeg, halfWidthM);
  const heights = await fetchElevations(terrainPoints(b), apiKey, o);
  return { ...b, n: TERRAIN_POINTS, heights };
}
