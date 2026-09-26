import { describe, expect, it } from 'vitest';
import {
  MAX_LAT,
  TILE_SIZE,
  TILE_SOURCES,
  formatCoord,
  latToTileY,
  lonToTileX,
  metersPerPixel,
  normalizeLon,
  project,
  tileXToLon,
  tileYToLat,
  unproject,
  visibleTiles,
  wrapTileX,
  zoomForMetersPerPixel,
} from '../../src/services/slippyMap';

/**
 * The projection, checked against figures worked out independently of it.
 *
 * A reader and a writer that share a wrong constant agree with each other
 * perfectly, so round-trips alone would prove nothing. The anchors below are
 * either exact by definition (the world's corners) or hand-computed from the
 * Web Mercator formula, and the standard 156543.03 m/px is the published
 * figure every mapping library quotes for zoom 0 at the equator.
 */

describe('tile projection', () => {
  it('puts the world corners where they are defined to be', () => {
    // Zoom 1 is a 2x2 world: the prime meridian and the equator run through
    // the middle of it, and the edges are the projection's own limits.
    expect(lonToTileX(-180, 1)).toBeCloseTo(0, 12);
    expect(lonToTileX(0, 1)).toBeCloseTo(1, 12);
    expect(lonToTileX(180, 1)).toBeCloseTo(2, 12);

    expect(latToTileY(MAX_LAT, 1)).toBeCloseTo(0, 6);
    expect(latToTileY(0, 1)).toBeCloseTo(1, 12);
    expect(latToTileY(-MAX_LAT, 1)).toBeCloseTo(2, 6);
  });

  it('matches a hand-computed Mercator ordinate', () => {
    // y = (1 - ln(tan45 + sec45)/pi) / 2 * 2^1
    //   = 1 - ln(1 + sqrt2) / pi
    //   = 1 - 0.88137359 / 3.14159265
    //   = 1 - 0.28054993 = 0.71945007
    expect(latToTileY(45, 1)).toBeCloseTo(0.71945007, 7);
  });

  it('clamps past the poles rather than running to infinity', () => {
    // tan(90°) is infinite; a map that returned NaN here would blank out
    // instead of showing the top of the world.
    expect(latToTileY(90, 4)).toBeCloseTo(latToTileY(MAX_LAT, 4), 9);
    expect(Number.isFinite(latToTileY(-90, 4))).toBe(true);
  });

  it('round-trips a coordinate through tile space', () => {
    for (const [lat, lon] of [
      [39.05, -104.8],
      [-33.87, 151.21],
      [0, 0],
      [60.17, 24.94],
    ] as const) {
      expect(tileYToLat(latToTileY(lat, 17), 17)).toBeCloseTo(lat, 9);
      expect(tileXToLon(lonToTileX(lon, 17), 17)).toBeCloseTo(lon, 9);
    }
  });

  it('reports the published ground resolution', () => {
    expect(metersPerPixel(0, 0)).toBeCloseTo(156543.034, 2);
    // Halves with every zoom level, and shrinks with the cosine of latitude.
    expect(metersPerPixel(0, 1)).toBeCloseTo(156543.034 / 2, 2);
    expect(metersPerPixel(60, 0)).toBeCloseTo(156543.034 * 0.5, 1);
  });
});

describe('wrapping', () => {
  it('folds a column back into the world', () => {
    // Panning west past the date line asks for column -1, which no server
    // answers; it is the last column of the world.
    expect(wrapTileX(-1, 3)).toBe(7);
    expect(wrapTileX(8, 3)).toBe(0);
    expect(wrapTileX(3, 3)).toBe(3);
  });

  it('folds a longitude into the readable range', () => {
    expect(normalizeLon(190)).toBeCloseTo(-170, 9);
    expect(normalizeLon(-190)).toBeCloseTo(170, 9);
    expect(normalizeLon(-104.8)).toBeCloseTo(-104.8, 9);
    expect(normalizeLon(180)).toBeCloseTo(-180, 9);
  });
});

describe('visibleTiles', () => {
  it('covers the viewport, and places each tile where it belongs', () => {
    const tiles = visibleTiles(0, 0, 2, 512, 512);
    // A 512px box at zoom 2 (a 1024px world) is four tiles across the middle.
    expect(tiles).toHaveLength(4);
    // Every tile's box must land inside the viewport's span.
    for (const t of tiles) {
      expect(t.left).toBeGreaterThan(-TILE_SIZE);
      expect(t.top).toBeGreaterThan(-TILE_SIZE);
      expect(t.left).toBeLessThan(512);
      expect(t.top).toBeLessThan(512);
    }
    // And they tile: no gaps, no overlaps.
    const lefts = [...new Set(tiles.map((t) => t.left))].sort((a, b) => a - b);
    expect(lefts).toEqual([0, 256]);
  });

  it('drops rows off the top and bottom of the world, but wraps columns', () => {
    // Zoom 1 is a 512px world. In a 512x768 box it cannot fill the height:
    // there is nothing above the north pole, so those rows are empty space.
    const tiles = visibleTiles(0, 0, 1, 512, 768);
    expect(tiles.every((t) => t.y >= 0 && t.y < 2)).toBe(true);
    expect(new Set(tiles.map((t) => t.y))).toEqual(new Set([0, 1]));

    // East-west it does repeat, so a wide box at zoom 1 shows the world twice
    // and every requested column is one a server will answer.
    const wide = visibleTiles(0, 0, 1, 1536, 256);
    expect(wide.length).toBeGreaterThan(2);
    expect(wide.every((t) => t.x >= 0 && t.x < 2)).toBe(true);
    // Keyed on the unwrapped column, so the two copies are distinct to React.
    expect(new Set(wide.map((t) => t.key)).size).toBe(wide.length);
  });
});

describe('project / unproject', () => {
  it('puts the center coordinate at the center of the box', () => {
    const p = project(39.05, -104.8, 39.05, -104.8, 15, 400, 300);
    expect(p.x).toBeCloseTo(200, 9);
    expect(p.y).toBeCloseTo(150, 9);
  });

  it('round-trips a click back to the coordinate under it', () => {
    const c = { lat: 39.05, lon: -104.8, z: 16, w: 400, h: 300 };
    const ll = unproject(320, 90, c.lat, c.lon, c.z, c.w, c.h);
    const back = project(ll.latitudeDeg, ll.longitudeDeg, c.lat, c.lon, c.z, c.w, c.h);
    expect(back.x).toBeCloseTo(320, 6);
    expect(back.y).toBeCloseTo(90, 6);
  });

  it('takes the short way around the date line', () => {
    // A location at 179°E, seen from a map centered at 179°W, is 2° east — just off
    // the left edge — not 358° away and off the map entirely.
    const p = project(0, 179, 0, -179, 6, 400, 300);
    expect(p.x).toBeLessThan(200);
    expect(p.x).toBeGreaterThan(-400);
  });

  it('north is up and east is right', () => {
    const north = project(40, -104.8, 39.05, -104.8, 12, 400, 300);
    const east = project(39.05, -104, 39.05, -104.8, 12, 400, 300);
    expect(north.y).toBeLessThan(150);
    expect(east.x).toBeGreaterThan(200);
  });
});

describe('tile sources', () => {
  it('builds both paths in Esri z/y/x order', () => {
    // Esri is the odd one out among tile servers, and getting it backwards
    // yields a map that looks plausible and is in the wrong place.
    expect(TILE_SOURCES.satellite.url(15, 6844, 12534)).toContain('World_Imagery/MapServer/tile/15/12534/6844');
    expect(TILE_SOURCES.street.url(15, 6844, 12534)).toContain('World_Street_Map/MapServer/tile/15/12534/6844');
  });

  it('asks nobody’s volunteer tile servers', () => {
    // The street layer used to be `tile.openstreetmap.org`. Those are donated,
    // volunteer-funded machines, and OSM's Tile Usage Policy says third-party
    // apps are to run their own or buy from a provider. A test rather than a
    // comment, because the easy way to "fix" a blocked tile layer is to point
    // it back at them.
    for (const source of Object.values(TILE_SOURCES)) {
      expect(source.url(15, 1, 2)).not.toMatch(/openstreetmap\.org/);
      expect(source.url(15, 1, 2)).toMatch(/^https:\/\/server\.arcgisonline\.com\//);
    }
  });

  it('carries the attribution each service publishes', () => {
    expect(TILE_SOURCES.satellite.attribution).toMatch(/Esri/);
    // Esri's street map is built on OSM data, so the people who surveyed the
    // roads are still credited - we just are not using their servers.
    expect(TILE_SOURCES.street.attribution).toMatch(/OpenStreetMap/);
  });
});

describe('formatCoord', () => {
  it('writes hemispheres rather than signs', () => {
    // The error the map exists to catch is a dropped minus sign.
    expect(formatCoord(39.05, -104.8)).toBe('39.0500° N, 104.8000° W');
    expect(formatCoord(-33.87, 151.21)).toBe('33.8700° S, 151.2100° E');
    expect(formatCoord(0, 0)).toBe('0.0000° N, 0.0000° E');
  });
});

describe('zoomForMetersPerPixel', () => {
  /**
   * The ground track sizes itself to the flight, so its zoom is derived rather
   * than fixed the way SITE_ZOOM is. Checked against metersPerPixel itself: the
   * chosen zoom is the NEAREST on a ladder that doubles, so neither neighbor
   * can be closer to what is being drawn.
   */
  it('lands on the zoom nearest the drawing, in either direction', () => {
    for (const target of [0.4, 1.2, 7.5, 60, 400]) {
      const z = zoomForMetersPerPixel(39.05, target, 19);
      const off = (zz: number) => Math.abs(Math.log2(metersPerPixel(39.05, zz) / target));
      expect(off(z)).toBeLessThanOrEqual(off(z - 1));
      expect(off(z)).toBeLessThanOrEqual(off(z + 1));
    }
  });

  /**
   * The leftover fraction is what the caller scales the tile layer by to put it
   * at the drawing's scale, and it decides how many tiles get fetched: the
   * layer is laid out at `size / k`, so a k of 0.5 would be four times the
   * tiles of a k of 1. Bounded to one half-step either way.
   */
  it('leaves a scale factor within a half step of exact', () => {
    for (const target of [0.3, 2, 33, 250]) {
      const k = metersPerPixel(39.05, zoomForMetersPerPixel(39.05, target, 19)) / target;
      expect(k).toBeGreaterThanOrEqual(Math.SQRT1_2);
      expect(k).toBeLessThanOrEqual(Math.SQRT2);
    }
  });

  it('stops where the provider runs out of imagery, and where the world does', () => {
    // A flight that barely left the pad would ask for a zoom no server has.
    expect(zoomForMetersPerPixel(39.05, 0.0001, 19)).toBe(19);
    // And one drawn at continental scale cannot zoom out past the whole world.
    expect(zoomForMetersPerPixel(39.05, 1e9, 19)).toBe(1);
  });

  it('refuses to divide by a resolution of zero', () => {
    // A degenerate extent must not hand back NaN, which would render a tile URL
    // reading `tile/NaN/NaN/NaN`.
    expect(Number.isFinite(zoomForMetersPerPixel(39.05, 0, 19))).toBe(true);
  });
});
