import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import {
  TILE_SIZE,
  TILE_SOURCES,
  metersPerPixel,
  visibleTiles,
  zoomForMetersPerPixel,
  type TileRef,
  type TileSourceId,
} from '../../services/map/slippyMap';

/**
 * Aerial imagery laid on the 3D view's ground plane.
 *
 * The trajectory is drawn over real ground in meters east and north of the pad
 * (flightScene.ts), so the ground it is drawn over may as well be the real one:
 * a descent that ends in the treeline reads as the treeline rather than as a
 * point on a grid. Same tiles, same projection and the same session layer as
 * the launch-site map and the ground track (services/map/slippyMap.ts).
 *
 * One quad per tile rather than one stitched texture. Stitching would mean
 * drawing every tile into a canvas and uploading the result, which taints
 * nothing but does cost a full-size readback on every flight; a quad each is
 * the same triangles the ground plane already was, and each tile appears as it
 * arrives instead of the whole map appearing at the end.
 *
 * CORS on purpose, and it matters beyond the texture: the 3D canvas is created
 * with `preserveDrawingBuffer` so the image export can read it back, and a
 * single texture loaded without CORS would taint the canvas and break that
 * export. Esri answers with `Access-Control-Allow-Origin: *`, so the textures
 * load clean; if that ever stops being true the tiles simply fail to load and
 * the plain ground plane shows through, which is the right way to lose.
 */

/**
 * Roughly how many texture pixels wide a picture of the ground should be.
 *
 * It picks the zoom, and with it the tile count: the ground is covered in about
 * this many pixels however wide it is in meters, so a 300 m flight and a 3 km
 * one fetch about the same number of tiles at different zooms. Too low and the
 * ground is a blur under the trajectory; too high and one flight pulls a
 * hundred tiles for scenery.
 */
const GROUND_TEX_PX = 512;

/** Just above the ground plane, below the grid, so both still read. */
const MAP_Y = 0.01;

export interface GroundMapProps {
  /** The pad, which is the scene's origin. */
  latitudeDeg: number;
  longitudeDeg: number;
  /** Half the side of the ground to cover, in METERS from the pad. */
  radiusM: number;
  /** Scene units per meter, from the flight scene's own scale. */
  unitsPerMeter: number;
  source: TileSourceId;
  /** Told of each tile that loads and each that fails, for the view's offline verdict (useTileVerdict). */
  onTileLoad?: () => void;
  onTileError?: () => void;
}

/** One tile, and where its quad sits in the scene. */
export interface GroundQuad extends TileRef {
  url: string;
  /** Quad center, in scene units: +east is +x, +north is +z, as the arc uses. */
  east: number;
  north: number;
}

/**
 * The tiles to lay down, and how big each is in scene units.
 *
 * The pad is both the tile viewport's center and the scene's origin, so a
 * tile's offset in tile pixels converts straight to meters and then to scene
 * units. Pixel y grows south while the scene's +z is north, which is the one
 * subtraction that runs the other way - and the one mistake here that would
 * still look like a perfectly good map.
 *
 * Pure, and exported, because that mistake is invisible on screen: a mirrored
 * aerial photograph of a field is a photograph of a field.
 *
 * `radiusM` is the flight's own reach, not the ground plane's. The plane and
 * its grid are a fixed size whatever the flight did, and covering all of it
 * can mean fetching tiles for a kilometer of ground either side of a rocket
 * that went three hundred meters. Sized to the track instead, with the margin
 * its caller adds, the imagery ends just past where the rocket got to.
 */
export function groundMapLayout(
  latitudeDeg: number,
  longitudeDeg: number,
  radiusM: number,
  unitsPerMeter: number,
  source: TileSourceId,
): { quad: number; refs: GroundQuad[] } {
  const tiles = TILE_SOURCES[source];
  const sideM = radiusM * 2;
  const zoom = zoomForMetersPerPixel(latitudeDeg, sideM / GROUND_TEX_PX, tiles.maxZoom);
  const mpp = metersPerPixel(latitudeDeg, zoom);
  const sidePx = sideM / mpp;
  const half = sidePx / 2;
  return {
    quad: TILE_SIZE * mpp * unitsPerMeter,
    refs: visibleTiles(latitudeDeg, longitudeDeg, zoom, sidePx, sidePx).map((tile) => ({
      ...tile,
      url: tiles.url(tile.z, tile.x, tile.y),
      east: (tile.left + TILE_SIZE / 2 - half) * mpp * unitsPerMeter,
      north: (half - (tile.top + TILE_SIZE / 2)) * mpp * unitsPerMeter,
    })),
  };
}

export function FlightGroundMap({
  latitudeDeg,
  longitudeDeg,
  radiusM,
  unitsPerMeter,
  source,
  onTileLoad,
  onTileError,
}: GroundMapProps) {
  const layer = useMemo(
    () => groundMapLayout(latitudeDeg, longitudeDeg, radiusM, unitsPerMeter, source),
    [latitudeDeg, longitudeDeg, radiusM, unitsPerMeter, source],
  );

  /**
   * The textures in hand, tagged with the layout they belong to.
   *
   * Tagged rather than cleared on a change: a tile key is a zoom and a column,
   * so the same keys come back when the layer switches from imagery to street,
   * and a stale texture would sit under the new one until it loaded. Carrying the
   * layout with them means the previous set simply stops matching, with no state
   * reset from inside an effect.
   */
  const [loaded, setLoaded] = useState<{ of: typeof layer; texes: Record<string, THREE.Texture> }>({
    of: layer,
    texes: {},
  });

  useEffect(() => {
    const loader = new THREE.TextureLoader();
    // Without this the canvas is tainted and the image export stops working.
    loader.setCrossOrigin('anonymous');
    let live = true;
    const mine: THREE.Texture[] = [];

    for (const ref of layer.refs) {
      loader.load(
        ref.url,
        (tex) => {
          if (!live) {
            tex.dispose();
            return;
          }
          // The image's top row is north. A plane laid flat by rotating -90°
          // about x sends its own +y to -z (south), so the default flip would
          // mirror the ground north for south - a map that looks entirely
          // plausible and is wrong.
          tex.flipY = false;
          tex.colorSpace = THREE.SRGBColorSpace;
          // One tile is one quad and is never minified far, so mipmaps would be
          // memory spent on levels nothing samples.
          tex.generateMipmaps = false;
          tex.minFilter = THREE.LinearFilter;
          mine.push(tex);
          onTileLoad?.();
          setLoaded((prev) => ({
            of: layer,
            texes: prev.of === layer ? { ...prev.texes, [ref.key]: tex } : { [ref.key]: tex },
          }));
        },
        undefined,
        () => {
          // The view decides whether this is a hole in the coverage or no
          // network, so it can stop claiming a layer it does not have.
          if (live) onTileError?.();
        },
      );
    }

    return () => {
      live = false;
      for (const tex of mine) tex.dispose();
    };
    // The tile callbacks are left out on purpose: they are reports, not inputs, and
    // an unmemoized callback from the parent would re-fetch every tile on every
    // HUD tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layer]);

  return (
    <group position={[0, MAP_Y, 0]}>
      {layer.refs.map((ref) => {
        const tex = loaded.of === layer ? loaded.texes[ref.key] : undefined;
        if (!tex) return null;
        return (
          <mesh key={ref.key} position={[ref.east, 0, ref.north]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[layer.quad, layer.quad]} />
            {/* Unlit, so the imagery is the color it actually is rather than
                whatever the scene's two lights would make of it. */}
            <meshBasicMaterial map={tex} toneMapped={false} />
          </mesh>
        );
      })}
    </group>
  );
}
