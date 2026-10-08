import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { rangeRings, type GroundPoint } from '../../../services/flight/groundTrack';
import { TILE_SOURCES, metersPerPixel, visibleTiles, zoomForMetersPerPixel } from '../../../services/map/slippyMap';
import { HALO, LAYERS, MAX_MAGNIFICATION } from './mapStyle';
import { MapCredit, TileImg, TileLayerButtons } from './MapParts';
import type { useGroundLayer } from './useTileVerdict';

/** Where a ground point lands in the square, for the shapes a view draws. */
export interface PlanGeometry {
  half: number;
  X: (east: number) => number;
  Y: (north: number) => number;
  /** A run of ground points as an SVG `points` attribute. */
  poly: (points: readonly GroundPoint[]) => string;
  /** Imagery is on, so lines want their liner and labels their halo. */
  mapOn: boolean;
}

const PAD = 18;

/**
 * A flight seen from directly above: the pad at the center, north up, the same
 * scale on both axes, range rings for the measurement, and ground imagery under
 * it when a site and a layer are given.
 *
 * North is up and the axes share a scale because this is read as a map of the
 * field you are standing on: stretching one axis would bend a straight drift
 * into a curve. The rings stay when imagery is on: the imagery is the context
 * and the rings are the number.
 *
 * `under` draws beneath the rings (a region the rings measure), `children`
 * above them (the tracks), and the pad goes on top of everything.
 */
export function PlanView({
  size,
  extent,
  site,
  ground,
  fmtDist,
  ariaLabel,
  under,
  children,
  overlay,
}: {
  size: number;
  /** Meters from the pad to the edge of the drawing. */
  extent: number;
  site: { lat: number; lon: number } | null;
  ground: ReturnType<typeof useGroundLayer>;
  fmtDist: (m: number) => string;
  ariaLabel: string;
  under?: (g: PlanGeometry) => ReactNode;
  children: (g: PlanGeometry) => ReactNode;
  /** Controls placed over the box, such as a panel opposite the layer buttons. */
  overlay?: ReactNode;
}) {
  const { t } = useTranslation();
  const half = size / 2;
  const scale = (half - PAD) / extent;
  const X = (east: number) => half + east * scale;
  const Y = (north: number) => half - north * scale;
  const poly = (points: readonly GroundPoint[]) =>
    points.map((p) => `${X(p.east).toFixed(1)},${Y(p.north).toFixed(1)}`).join(' ');
  const rings = rangeRings(extent);

  const { source, imagery } = ground;
  const tiles = site && source ? TILE_SOURCES[source] : null;
  /**
   * Tile zoom, and the factor that puts the tile layer at the drawing's scale.
   *
   * The rings own the scale, because they are the measurement, so the imagery
   * bends to them rather than the other way round: take the tile zoom nearest
   * the drawing's resolution, then scale the whole tile layer by the leftover
   * fraction. Laying the layer out at `size / tileScale` first is what keeps it
   * covering the box after that transform, and is also why that fraction is
   * kept near 1 rather than always rounded up (see zoomForMetersPerPixel): the
   * layout side, and so the tile count, is divided by it.
   *
   * Mercator is conformal, so its scale is uniform in every direction about the
   * pad, and the tracks' flat east/north plane matches it to well under a pixel
   * over the few kilometers a sport flight covers.
   */
  const drawnMpp = extent / (half - PAD);
  const tileZoom = site && tiles ? zoomForMetersPerPixel(site.lat, drawnMpp, tiles.maxZoom) : 0;
  const tileScale = site && tiles ? metersPerPixel(site.lat, tileZoom) / drawnMpp : 1;
  const tileBox = Math.ceil(size / tileScale);
  /** Closer in than the provider has ground to show, so there is nothing to draw. */
  const tooClose = tileScale > MAX_MAGNIFICATION;
  const mapOn = tiles !== null && imagery !== 'unavailable' && !tooClose;
  const g: PlanGeometry = { half, X, Y, poly, mapOn };
  const grid = mapOn ? 'stroke-line/40' : 'stroke-line/10';

  return (
    <div
      className={`relative shrink-0 overflow-hidden ${mapOn ? 'rounded-lg ring-1 ring-line/10' : ''}`}
      style={{ width: size, height: size }}
    >
      {mapOn && site && source && (
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-1/2"
          style={{ width: tileBox, height: tileBox, transform: `translate(-50%, -50%) scale(${tileScale})` }}
        >
          {visibleTiles(site.lat, site.lon, tileZoom, tileBox, tileBox).map((tile) => (
            <TileImg
              key={`${source}:${tile.key}`}
              source={source}
              tile={tile}
              onLoad={ground.onTileLoad}
              onError={ground.onTileError}
            />
          ))}
        </div>
      )}
      {/* Knocks the imagery back so a saturated track still reads over it. */}
      {mapOn && <div aria-hidden className="pointer-events-none absolute inset-0 bg-canvas/30" />}

      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={ariaLabel}
        className="absolute inset-0"
      >
        {under?.(g)}
        {rings.map((r) => (
          <g key={r}>
            <circle cx={half} cy={half} r={r * scale} fill="none" className={grid} />
            <text
              x={half + 3}
              y={Y(r) + 10}
              style={mapOn ? HALO : undefined}
              className={`text-[9px] tabular-nums ${mapOn ? 'fill-on-accent' : 'fill-ink-faint'}`}
            >
              {fmtDist(r)}
            </text>
          </g>
        ))}
        {/* Cardinal cross, and N so the drawing cannot be read upside down. */}
        <line x1={PAD} y1={half} x2={size - PAD} y2={half} className={grid} />
        <line x1={half} y1={PAD} x2={half} y2={size - PAD} className={grid} />
        <text
          x={half}
          y={PAD - 4}
          textAnchor="middle"
          style={mapOn ? HALO : undefined}
          className={`text-[10px] font-semibold ${mapOn ? 'fill-on-accent' : 'fill-ink-muted'}`}
        >
          {t('flight.north')}
        </text>
        {children(g)}
        {/* The pad, drawn last so it is never buried under a track. */}
        {mapOn && <circle cx={half} cy={half} r={5} className="fill-canvas/75" />}
        <circle cx={half} cy={half} r={3.5} className="fill-ink" />
      </svg>

      {/* Offered only where it can do something: with no coordinates there is
          nothing to center imagery on, so there is no button to press. */}
      {site && <TileLayerButtons layers={LAYERS} value={ground.layer} onPick={ground.pick} />}
      {overlay}
      {mapOn && tiles && <MapCredit>{tiles.attribution}</MapCredit>}
      {/* Asked for imagery and did not get it. Say which reason, rather than
          leaving the reader with a pressed button and an empty box. */}
      {tiles && !mapOn && <MapCredit warn>{tooClose ? t('map.tooClose') : t('map.offline')}</MapCredit>}
    </div>
  );
}
