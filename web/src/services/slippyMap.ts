/**
 * Web Mercator tile math, and the two tile sources the site map draws from.
 *
 * Hand-rolled rather than Leaflet or MapLibre. What the map has to do here is
 * narrow — show one point, let it be dragged, pan and zoom — and the libraries
 * that do it bring a stylesheet, a DOM layer system and a plugin surface for
 * markers, popups, layers and controls we would never use. The projection is
 * the four formulas below; the rest is `<img>` tags at computed offsets.
 *
 * Everything here is pure, so the projection is tested against published tile
 * numbers rather than by looking at whether the picture came out right.
 */

/** Every source below serves 256px tiles. */
export const TILE_SIZE = 256;

/**
 * The latitude Web Mercator runs out at.
 *
 * The projection sends the poles to infinity, so every slippy map cuts off at
 * the latitude that makes the world square: atan(sinh(pi)) = 85.051129°.
 */
export const MAX_LAT = 85.051129;

export type TileSourceId = 'satellite' | 'street';

export interface TileSource {
  id: TileSourceId;
  /** Beyond this the server has no imagery and returns blank or 404 tiles. */
  maxZoom: number;
  url(z: number, x: number, y: number): string;
  /** Shown on the map, because both sources require it. */
  attribution: string;
}

/**
 * Both layers come from Esri's ArcGIS tile services, and NOT from
 * `tile.openstreetmap.org`.
 *
 * The street layer used to be OSM's own tile servers. That was wrong: those are
 * donated, volunteer-funded infrastructure, and the OSM Tile Usage Policy is
 * explicit that they exist for OpenStreetMap's own use and that third-party
 * applications are to run their own or buy from a provider. They enforce it, so
 * the layer also simply 403'd in the browser. Making it work would have meant
 * complying our way into using someone's charity as a CDN, which is the part
 * that was actually wrong.
 *
 * Esri's street map carries OSM DATA and credits it in the attribution below,
 * so the mapping still reaches the people who made it - over a commercial CDN
 * that is provisioned for being used.
 *
 * Both paths are {z}/{y}/{x}, not the {z}/{x}/{y} most tile servers use.
 * Attribution strings are the `copyrightText` each service publishes in its own
 * `?f=json` metadata rather than something paraphrased.
 */
const ESRI = (service: string) => (z: number, x: number, y: number) =>
  `https://server.arcgisonline.com/ArcGIS/rest/services/${service}/MapServer/tile/${z}/${y}/${x}`;

export const TILE_SOURCES: Record<TileSourceId, TileSource> = {
  /**
   * The reason this feature is worth having: a club field is a mown strip in a
   * hayfield, invisible on a street map and unmistakable from above.
   */
  satellite: {
    id: 'satellite',
    maxZoom: 19,
    url: ESRI('World_Imagery'),
    attribution: 'Imagery: Esri, Vantor, Earthstar Geographics',
  },
  /** For reading the roads in and the town you are near, which imagery does not tell you. */
  street: {
    id: 'street',
    maxZoom: 19,
    url: ESRI('World_Street_Map'),
    attribution: 'Esri, HERE, Garmin, USGS, NGA, © OpenStreetMap contributors',
  },
};

export const MIN_ZOOM = 1;

/** Fractional tile X of a longitude. Whole part is the tile, fraction is into it. */
export function lonToTileX(lonDeg: number, zoom: number): number {
  return ((lonDeg + 180) / 360) * 2 ** zoom;
}

/** Fractional tile Y of a latitude, clamped to the projection's limit. */
export function latToTileY(latDeg: number, zoom: number): number {
  const lat = (Math.max(-MAX_LAT, Math.min(MAX_LAT, latDeg)) * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2) * 2 ** zoom;
}

export function tileXToLon(x: number, zoom: number): number {
  return (x / 2 ** zoom) * 360 - 180;
}

export function tileYToLat(y: number, zoom: number): number {
  const n = Math.PI * (1 - (2 * y) / 2 ** zoom);
  return (Math.atan(Math.sinh(n)) * 180) / Math.PI;
}

/**
 * A tile column wrapped into [0, 2^zoom).
 *
 * The world repeats east-west, so panning past the date line asks for column
 * -1 or 2^zoom, which no server answers. Latitude does NOT wrap — there is
 * nothing above the north pole — so rows are clamped by the caller instead.
 */
export function wrapTileX(x: number, zoom: number): number {
  const n = 2 ** zoom;
  return ((x % n) + n) % n;
}

/** Ground resolution, for the scale bar. Shrinks with the cosine of latitude. */
export function metersPerPixel(latDeg: number, zoom: number): number {
  const EARTH_CIRCUMFERENCE_M = 40075016.686;
  return (EARTH_CIRCUMFERENCE_M * Math.cos((latDeg * Math.PI) / 180)) / (TILE_SIZE * 2 ** zoom);
}

/** Longitude folded into [-180, 180), so panning across the date line reads right. */
export function normalizeLon(lonDeg: number): number {
  return ((((lonDeg + 180) % 360) + 360) % 360) - 180;
}

/**
 * A coordinate as a person reads it: hemisphere letters rather than a sign.
 *
 * The error this whole map exists to catch is a dropped minus sign, and
 * "104.8000° W" is harder to misread than "-104.8000".
 */
export function formatCoord(latDeg: number, lonDeg: number, places = 4): string {
  const lat = `${Math.abs(latDeg).toFixed(places)}° ${latDeg < 0 ? 'S' : 'N'}`;
  const lon = `${Math.abs(lonDeg).toFixed(places)}° ${lonDeg < 0 ? 'W' : 'E'}`;
  return `${lat}, ${lon}`;
}

export interface TileRef {
  key: string;
  /** The column actually requested, wrapped into range. */
  x: number;
  y: number;
  z: number;
  /** Offset of this tile's top-left corner from the viewport's, in CSS pixels. */
  left: number;
  top: number;
}

/**
 * The tiles covering a viewport, with where to put each one.
 *
 * Rows outside [0, 2^zoom) are dropped rather than wrapped: zoomed out far
 * enough that the whole world is shorter than the box, the space above and
 * below the map is empty space, not more map.
 */
export function visibleTiles(
  centerLat: number,
  centerLon: number,
  zoom: number,
  width: number,
  height: number,
): TileRef[] {
  const n = 2 ** zoom;
  const cx = lonToTileX(centerLon, zoom);
  const cy = latToTileY(centerLat, zoom);
  // World-pixel coordinate of the viewport's top-left corner.
  const originX = cx * TILE_SIZE - width / 2;
  const originY = cy * TILE_SIZE - height / 2;

  const first = { x: Math.floor(originX / TILE_SIZE), y: Math.floor(originY / TILE_SIZE) };
  const last = {
    x: Math.floor((originX + width - 1) / TILE_SIZE),
    y: Math.floor((originY + height - 1) / TILE_SIZE),
  };

  const out: TileRef[] = [];
  for (let ty = first.y; ty <= last.y; ty++) {
    if (ty < 0 || ty >= n) continue;
    for (let tx = first.x; tx <= last.x; tx++) {
      const wrapped = wrapTileX(tx, zoom);
      out.push({
        // Keyed on the UNWRAPPED column: two copies of the same tile are on
        // screen at once when the world is narrower than the viewport, and a
        // key on the wrapped column would make React treat them as one.
        key: `${zoom}/${tx}/${ty}`,
        x: wrapped,
        y: ty,
        z: zoom,
        left: tx * TILE_SIZE - originX,
        top: ty * TILE_SIZE - originY,
      });
    }
  }
  return out;
}

/** Where a coordinate lands in the viewport, in CSS pixels from its top-left. */
export function project(
  latDeg: number,
  lonDeg: number,
  centerLat: number,
  centerLon: number,
  zoom: number,
  width: number,
  height: number,
): { x: number; y: number } {
  const n = 2 ** zoom;
  let dx = (lonToTileX(lonDeg, zoom) - lonToTileX(centerLon, zoom)) * TILE_SIZE;
  // Take the short way around: a location at 179°E seen from a map centered on
  // 179°W is one degree away, not 358.
  const worldWidth = n * TILE_SIZE;
  if (dx > worldWidth / 2) dx -= worldWidth;
  if (dx < -worldWidth / 2) dx += worldWidth;
  const dy = (latToTileY(latDeg, zoom) - latToTileY(centerLat, zoom)) * TILE_SIZE;
  return { x: width / 2 + dx, y: height / 2 + dy };
}

/** The inverse of `project`: what coordinate a point in the viewport is over. */
export function unproject(
  x: number,
  y: number,
  centerLat: number,
  centerLon: number,
  zoom: number,
  width: number,
  height: number,
): { latitudeDeg: number; longitudeDeg: number } {
  const tx = lonToTileX(centerLon, zoom) + (x - width / 2) / TILE_SIZE;
  const ty = latToTileY(centerLat, zoom) + (y - height / 2) / TILE_SIZE;
  return {
    latitudeDeg: tileYToLat(ty, zoom),
    longitudeDeg: normalizeLon(tileXToLon(tx, zoom)),
  };
}

/**
 * A sensible zoom for showing one location.
 *
 * Close enough to see the field and the road to it, far enough that a
 * coordinate typed a few hundred meters out is still on screen.
 */
export const SITE_ZOOM = 15;
