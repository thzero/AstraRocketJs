import { describe, expect, it } from 'vitest';
import { groundMapLayout } from '../../../src/components/canvas/FlightGroundMap';
import { TILE_SIZE } from '../../../src/services/slippyMap';
import { MIN_EXTENT_M } from '../../../src/services/groundTrack';

/**
 * Where the ground map's tiles land in the 3D scene.
 *
 * This is the one part of that view worth a test and the one part a screenshot
 * cannot check: a map laid down mirrored, or rotated a quarter turn, is still a
 * convincing photograph of a field. The arc is drawn with +x east and +z north
 * (flightScene.ts), so the ground under it has to agree, and tile rows count
 * SOUTHWARD while the scene counts north.
 */

const HOME = { lat: 39.05, lon: -104.8 };
/** A 271 m flight: peak altitude is pinned to 24 scene units. */
const UNITS_PER_METER = 24 / 271;
/** The ground to cover, in meters from the pad: a flight's reach plus a margin. */
const RADIUS = 360;

const layout = () => groundMapLayout(HOME.lat, HOME.lon, RADIUS, UNITS_PER_METER, 'satellite');

describe('groundMapLayout', () => {
  it('covers the ground it was asked for, in tiles of the same scale', () => {
    const { quad, refs } = layout();
    expect(refs.length).toBeGreaterThan(1);

    // The quads together have to reach the edge of the ground they stand in
    // for, which is measured in scene units like everything else in the scene.
    //
    // To within one tile pixel: `visibleTiles` covers a viewport's pixels 0 to
    // width-1, so the very last column can fall a pixel short of the width it
    // was given. At these scales that is a few centimeters of ground at the
    // outer edge, under the grid.
    const reach = RADIUS * UNITS_PER_METER - quad / TILE_SIZE;
    const east = refs.map((r) => r.east);
    const north = refs.map((r) => r.north);
    expect(Math.max(...east) + quad / 2).toBeGreaterThanOrEqual(reach);
    expect(Math.min(...east) - quad / 2).toBeLessThanOrEqual(-reach);
    expect(Math.max(...north) + quad / 2).toBeGreaterThanOrEqual(reach);
    expect(Math.min(...north) - quad / 2).toBeLessThanOrEqual(-reach);

    // Square, and the same scale as everything else in the scene: a tile is
    // TILE_SIZE pixels of ground, so its quad is that many pixels of meters.
    expect(quad).toBeGreaterThan(0);
    expect(refs.every((r) => Number.isFinite(r.east) && Number.isFinite(r.north))).toBe(true);
  });

  /**
   * The flip that would be invisible. Tile row numbers grow southward, so the
   * NORTHERNMOST tiles are the ones with the smallest `y` - and they have to
   * end up at the greatest +z.
   */
  it('puts northern tiles north, not south', () => {
    const { refs } = layout();
    const rows = [...new Set(refs.map((r) => r.y))].sort((a, b) => a - b);
    expect(rows.length).toBeGreaterThan(1);

    const northOf = (row: number) => refs.find((r) => r.y === row)!.north;
    expect(northOf(rows[0]!)).toBeGreaterThan(northOf(rows[rows.length - 1]!));
  });

  /** And the same for east, which is the axis that is easy to get right. */
  it('puts eastern tiles east', () => {
    const { refs } = layout();
    const cols = [...new Set(refs.map((r) => r.x))].sort((a, b) => a - b);
    expect(cols.length).toBeGreaterThan(1);

    const eastOf = (col: number) => refs.find((r) => r.x === col)!.east;
    expect(eastOf(cols[0]!)).toBeLessThan(eastOf(cols[cols.length - 1]!));
  });

  /**
   * The pad is the scene's origin and the tile viewport's center, so whichever
   * tile covers the origin must straddle it rather than sit beside it.
   */
  it('centers the ground on the pad', () => {
    const { quad, refs } = layout();
    const over = refs.filter((r) => Math.abs(r.east) <= quad / 2 && Math.abs(r.north) <= quad / 2);
    expect(over.length).toBeGreaterThan(0);
  });

  /** Neighboring quads meet exactly: a gap would show as a seam of bare grid. */
  it('lays the quads edge to edge', () => {
    const { quad, refs } = layout();
    // Rounded before de-duplicating, because the same column arrives from
    // several rows and float noise would otherwise make each one its own value.
    const cols = [...new Set(refs.map((r) => r.east.toFixed(6)))].map(Number).sort((a, b) => a - b);
    for (let i = 1; i < cols.length; i++) {
      expect(cols[i]! - cols[i - 1]!).toBeCloseTo(quad, 4);
    }
  });

  it('asks the layer it was given for its tiles', () => {
    expect(layout().refs.every((r) => r.url.includes('World_Imagery'))).toBe(true);
    const street = groundMapLayout(HOME.lat, HOME.lon, RADIUS, UNITS_PER_METER, 'street');
    expect(street.refs.every((r) => r.url.includes('World_Street_Map'))).toBe(true);
    // Never OpenStreetMap's own volunteer servers: see the note in slippyMap.ts.
    expect(street.refs.some((r) => r.url.includes('openstreetmap.org'))).toBe(false);
  });

  /**
   * A bigger flight covers more ground at a COARSER zoom rather than fetching
   * more tiles: the ground is covered in about the same number of texture
   * pixels however many meters wide it is.
   */
  it('zooms out for a wider flight rather than fetching more tiles', () => {
    const club = groundMapLayout(HOME.lat, HOME.lon, 200, UNITS_PER_METER, 'satellite');
    const big = groundMapLayout(HOME.lat, HOME.lon, 8_000, UNITS_PER_METER, 'satellite');
    expect(big.refs[0]!.z).toBeLessThan(club.refs[0]!.z);
    expect(big.refs.length).toBeLessThanOrEqual(club.refs.length * 2);
    expect(TILE_SIZE).toBe(256);
  });

  /**
   * The budget this exists to keep. Imagery is fetched from someone else's
   * servers and kept in a capped offline cache shared with two other surfaces,
   * so a single flight must not cost a screenful of tiles per view. Covering
   * the whole ground plane rather than the flight used to cost 36.
   */
  it('costs a modest number of tiles at any scale', () => {
    for (const radius of [MIN_EXTENT_M, 120, 360, 1_500, 20_000]) {
      const { refs } = groundMapLayout(HOME.lat, HOME.lon, radius, UNITS_PER_METER, 'satellite');
      expect(refs.length).toBeGreaterThan(0);
      expect(refs.length).toBeLessThanOrEqual(25);
    }
  });
});
