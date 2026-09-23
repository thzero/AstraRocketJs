import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUnits } from '../../prefs/useUnits';
import { unitScope } from '../../prefs/units';
import { fmtNum } from '../../i18n/format';
import { groundTrackLine, rangeRings, trackExtent, type GroundTrackLine } from '../../services/groundTrack';
import {
  TILE_SIZE,
  TILE_SOURCES,
  metersPerPixel,
  visibleTiles,
  zoomForMetersPerPixel,
  type TileSourceId,
} from '../../services/slippyMap';
import { groundImagery, rememberGroundImagery, rememberTileLayer, tileLayer } from '../../services/tileLayer';
import { buildTraces, type ChartFlight } from './FlightChart';

/**
 * The flight from directly above: the path over the ground, the pad at the
 * center, where it came down - and the ground itself underneath.
 *
 * North is up and the scale is the same on both axes, because this is read as a
 * map of the field you are standing on - stretching one axis would bend a
 * straight drift into a curve and turn a circle of equal distance into an
 * ellipse. Range rings carry the measurement; without them a drift is a
 * squiggle rather than "180 m that way". They stay when imagery is on: the
 * imagery is the context and the rings are the number.
 *
 * It draws the same traces the flight charts do, so a staged flight shows each
 * stage's own descent - which is the case where this earns its place, since a
 * spent booster usually lands somewhere quite different from the sustainer.
 *
 * The imagery is the same tile machinery the launch-site map uses
 * (services/slippyMap.ts), at the coordinates the flight was actually FLOWN
 * from: latitude and longitude are required simulation inputs that go to the
 * kernel (services/requiredLaunch.ts, services/simulations.ts), so there is
 * nothing to infer. Tiles are cached by the service worker, so a site looked at
 * at home still draws at the field; somewhere never viewed draws without them,
 * which is the view this had before and is still a correct picture.
 */

/** 'off' is a real choice: imagery is context, and sometimes it is in the way. */
type Layer = 'off' | TileSourceId;

/**
 * The three buttons, with their labels spelled out.
 *
 * Not `t(`map.${id}`)`: a key built from a variable is invisible to the
 * key-coverage test, which then reports these as dead strings.
 */
const LAYERS = [
  { id: 'off', labelKey: 'map.none' },
  { id: 'satellite', labelKey: 'map.satellite' },
  { id: 'street', labelKey: 'map.street' },
] as const satisfies readonly { id: Layer; labelKey: string }[];

/** Ink for a label that has to read over aerial imagery as well as over nothing. */
const HALO = {
  paintOrder: 'stroke',
  stroke: 'rgba(2,6,23,0.75)',
  strokeWidth: 3,
  strokeLinejoin: 'round',
} as const;

/** The dark liner under every marked line, so a track never sinks into a field. */
const LINER = 'rgba(2,6,23,0.75)';

/**
 * How far the imagery may be magnified past its own resolution before it stops
 * being worth drawing.
 *
 * The zoom normally lands within a half step of the drawing, so this never
 * fires on a real flight. It fires on a SMALL one: a still-air launch lands a
 * handful of centimeters from the pad, the view sizes itself to that, and the
 * zoom runs into the provider's maximum. Past that the layer is one tile blown
 * up eighty times - a smear at best, and in practice a box that draws nothing
 * at all while the Satellite button sits there looking pressed.
 *
 * Four, not two. A calm-day club flight lands twenty or thirty meters out, and
 * imagery four times coarser than the plot is blocky but still tells you
 * whether that is the mown strip or the beans beside it - which is the whole
 * job. Below about twenty meters across, a screen pixel is finer than anything
 * Esri holds and there is no ground left to show.
 */
const MAX_MAGNIFICATION = 4;

export function GroundTrack({
  flight,
  latitudeDeg,
  longitudeDeg,
}: {
  flight: ChartFlight;
  /** The site this flight was flown from. Null only if it was never filled in. */
  latitudeDeg: number | null;
  longitudeDeg: number | null;
}) {
  const { t } = useTranslation();
  const u = useUnits();
  const fitRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(420);
  const [layer, setLayer] = useState<Layer>(() => (groundImagery() ? tileLayer() : 'off'));
  /**
   * Whether tiles are getting through, and for WHICH source.
   *
   * Carrying the source with the verdict is what makes switching layers re-ask
   * the network: the stale verdict is simply not the current source's, so it
   * reads as unknown again without an effect reaching in to clear it. Same rule
   * as the site map.
   */
  const [reached, setReached] = useState<{ src: TileSourceId; state: 'ok' | 'unavailable' } | null>(null);
  const errors = useRef(0);

  // Share the chart's unit scope, so a drift read in feet on one view reads in
  // feet on the other.
  const dist = u.at(unitScope('sim', 'apogee'), 'distance');

  const lines = useMemo<GroundTrackLine[]>(
    () =>
      buildTraces(flight, (i) => `${t('flight.stage')} ${i + 1}`).map((tr) =>
        groundTrackLine(tr.key, tr.name, tr.color, tr.series),
      ),
    [flight, t],
  );
  const drawn = lines.filter((l) => l.points.length >= 2);
  const extent = useMemo(() => trackExtent(lines), [lines]);
  const rings = useMemo(() => rangeRings(extent), [extent]);

  /**
   * Fit the square to the space LEFT OVER by the legend, not to the whole pane.
   *
   * Measuring the outer host instead took the full height, so the square plus
   * the legend beneath it was taller than the pane that held them and the
   * centered overflow was clipped at both ends: the N marker off the top, the
   * distance and bearing - the two numbers the view exists to give you - cut in
   * half at the bottom. The inner box is what is actually available, so a square
   * that fits it cannot push anything out.
   */
  useEffect(() => {
    const el = fitRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]!.contentRect;
      setSize(Math.max(200, Math.min(r.width, r.height)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Pad at the center; +north is up (SVG y grows downward, hence the negation).
  const half = size / 2;
  const pad = 18;
  const scale = (half - pad) / extent;
  const X = (east: number) => half + east * scale;
  const Y = (north: number) => half - north * scale;

  const site = latitudeDeg != null && longitudeDeg != null ? { lat: latitudeDeg, lon: longitudeDeg } : null;
  const source: TileSourceId | null = site && layer !== 'off' ? layer : null;
  const tiles = source ? TILE_SOURCES[source] : null;
  const imagery = source && reached?.src === source ? reached.state : 'unknown';

  /**
   * Tile zoom, and the factor that puts the tile layer at the DRAWING's scale.
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
  const drawnMpp = extent / (half - pad);
  const tileZoom = site && tiles ? zoomForMetersPerPixel(site.lat, drawnMpp, tiles.maxZoom) : 0;
  const tileScale = site && tiles ? metersPerPixel(site.lat, tileZoom) / drawnMpp : 1;
  const tileBox = Math.ceil(size / tileScale);

  /** Closer in than the provider has ground to show, so there is nothing to draw. */
  const tooClose = tileScale > MAX_MAGNIFICATION;
  const mapOn = source !== null && tiles !== null && imagery !== 'unavailable' && !tooClose;

  /**
   * Switching layers re-asks the network, so the failure count starts over.
   *
   * The failed VERDICT is dropped too, which is what makes pressing the layer
   * you are already on a retry rather than a button that does nothing. Offline
   * is the state this view is most often in, and a dead retry in the one place
   * somebody is standing in a field waiting for a bar of signal is worse than
   * no button at all.
   */
  const pickLayer = (next: Layer) => {
    rememberGroundImagery(next !== 'off');
    if (next !== 'off') rememberTileLayer(next);
    errors.current = 0;
    setReached((prev) => (prev?.state === 'unavailable' ? null : prev));
    setLayer(next);
  };

  // `toUi` rather than a raw factor: the field unit owns the conversion, and a
  // distance carries no temperature-style offset to worry about either way.
  const fmtDist = (m: number) => {
    const v = dist.toUi(m);
    return `${fmtNum(v, Math.abs(v) >= 100 ? 0 : 1)} ${dist.sym}`;
  };

  const gridStroke = mapOn ? 'stroke-white/40' : 'stroke-white/10';

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 overflow-hidden">
      <div ref={fitRef} className="flex min-h-0 w-full flex-1 items-center justify-center">
        <div
          className={`relative shrink-0 overflow-hidden ${mapOn ? 'rounded-lg ring-1 ring-white/10' : ''}`}
          style={{ width: size, height: size }}
        >
          {mapOn && site && source && tiles && (
            <div
              aria-hidden
              className="pointer-events-none absolute left-1/2 top-1/2"
              style={{ width: tileBox, height: tileBox, transform: `translate(-50%, -50%) scale(${tileScale})` }}
            >
              {visibleTiles(site.lat, site.lon, tileZoom, tileBox, tileBox).map((tile) => (
                <img
                  key={`${source}:${tile.key}`}
                  src={tiles.url(tile.z, tile.x, tile.y)}
                  alt=""
                  draggable={false}
                  // CORS, to match the 3D ground map (FlightGroundMap.tsx), which loads
                  // these same tiles as WebGL textures and cannot use an opaque
                  // response. Without it the service worker caches this request's
                  // opaque copy and then hands it to the texture loader, which fails.
                  // Esri answers `Access-Control-Allow-Origin: *`.
                  crossOrigin="anonymous"
                  // No `referrerPolicy="no-referrer"`. Stripping the Referer hides
                  // WHO is asking, which is the one thing every tile provider's
                  // usage policy wants to be able to see.
                  width={TILE_SIZE}
                  height={TILE_SIZE}
                  // Sized in CSS, not just by the attributes, and `max-w-none`
                  // to beat the `img { max-width: 100% }` every CSS reset ships
                  // (Tailwind's preflight here).
                  //
                  // That cap is relative to the CONTAINING BLOCK, which is this
                  // layer - and the layer is deliberately narrower than the box
                  // whenever the imagery is being magnified, so it goes under
                  // 256px exactly when a flight is small. The tiles were then
                  // drawn at the layer's width while still being SPACED a full
                  // tile apart, which left gaps between them; at extreme zoom
                  // the spacing ran the tiles off the box entirely and the map
                  // came up empty.
                  className="absolute max-w-none select-none"
                  style={{ left: tile.left, top: tile.top, width: TILE_SIZE, height: TILE_SIZE }}
                  onLoad={() => {
                    errors.current = 0;
                    setReached({ src: source, state: 'ok' });
                  }}
                  onError={() => {
                    // One 404 is a hole in the coverage at this zoom; a whole
                    // screenful failing is no network. Only the second is worth
                    // dropping back to the bare plot over.
                    errors.current += 1;
                    if (errors.current < 3) return;
                    setReached((prev) =>
                      prev?.src === source && prev.state === 'ok' ? prev : { src: source, state: 'unavailable' },
                    );
                  }}
                />
              ))}
            </div>
          )}
          {/* Knocks the imagery back so a saturated track still reads over it. */}
          {mapOn && <div aria-hidden className="pointer-events-none absolute inset-0 bg-slate-950/30" />}

          <svg
            width={size}
            height={size}
            viewBox={`0 0 ${size} ${size}`}
            role="img"
            aria-label={t('flight.groundTrackLabel')}
            className="absolute inset-0"
          >
            {/* Range rings, outermost first so their labels sit under the tracks. */}
            {rings.map((r) => (
              <g key={r}>
                <circle cx={half} cy={half} r={r * scale} fill="none" className={gridStroke} />
                <text
                  x={half + 3}
                  y={Y(r) + 10}
                  style={mapOn ? HALO : undefined}
                  className={`text-[9px] tabular-nums ${mapOn ? 'fill-white' : 'fill-slate-500'}`}
                >
                  {fmtDist(r)}
                </text>
              </g>
            ))}
            {/* Cardinal cross, and N so the drawing cannot be read upside down. */}
            <line x1={pad} y1={half} x2={size - pad} y2={half} className={gridStroke} />
            <line x1={half} y1={pad} x2={half} y2={size - pad} className={gridStroke} />
            <text
              x={half}
              y={pad - 4}
              textAnchor="middle"
              style={mapOn ? HALO : undefined}
              className={`text-[10px] font-semibold ${mapOn ? 'fill-white' : 'fill-slate-400'}`}
            >
              {t('flight.north')}
            </text>

            {drawn.map((l) => {
              const points = l.points.map((p) => `${X(p.east).toFixed(1)},${Y(p.north).toFixed(1)}`).join(' ');
              return (
                <g key={l.key}>
                  {mapOn && (
                    <polyline
                      points={points}
                      fill="none"
                      stroke={LINER}
                      strokeWidth={3.75}
                      vectorEffect="non-scaling-stroke"
                    />
                  )}
                  <polyline
                    points={points}
                    fill="none"
                    stroke={l.color}
                    strokeWidth={1.75}
                    vectorEffect="non-scaling-stroke"
                  />
                </g>
              );
            })}
            {/* Landing marker per track: a ring, so it reads as a place rather than
              as another sample on the line. */}
            {drawn.map((l) =>
              l.landing ? (
                <g key={`${l.key}-end`}>
                  {mapOn && (
                    <circle
                      cx={X(l.landing.east)}
                      cy={Y(l.landing.north)}
                      r={4}
                      fill="none"
                      stroke={LINER}
                      strokeWidth={4}
                    />
                  )}
                  <circle
                    cx={X(l.landing.east)}
                    cy={Y(l.landing.north)}
                    r={4}
                    fill="none"
                    stroke={l.color}
                    strokeWidth={2}
                  />
                </g>
              ) : null,
            )}
            {/* The pad, drawn last so it is never buried under a track. */}
            {mapOn && <circle cx={half} cy={half} r={5} className="fill-slate-950/75" />}
            <circle cx={half} cy={half} r={3.5} className="fill-slate-200" />
          </svg>

          {/* Offered only where it can do something: with no coordinates there is
            nothing to center imagery on, so there is no button to press. */}
          {site && (
            <div className="absolute left-1 top-1 flex overflow-hidden rounded-md ring-1 ring-black/40">
              {LAYERS.map((l) => (
                <button
                  key={l.id}
                  onClick={() => pickLayer(l.id)}
                  aria-pressed={layer === l.id}
                  className={`px-2 py-1 text-[11px] font-medium ${
                    layer === l.id ? 'bg-sky-600 text-white' : 'bg-slate-900/80 text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  {t(l.labelKey)}
                </button>
              ))}
            </div>
          )}
          {mapOn && tiles && (
            <p className="pointer-events-none absolute bottom-0 right-0 bg-slate-900/70 px-1 text-[9px] leading-tight text-slate-400">
              {tiles.attribution}
            </p>
          )}
          {/* Asked for imagery and did not get it. Say WHICH reason, rather than
            leaving the reader with a pressed button and an empty box. */}
          {source !== null && !mapOn && (
            <p className="pointer-events-none absolute bottom-0 right-0 bg-slate-900/70 px-1 text-[9px] leading-tight text-amber-400">
              {tooClose ? t('map.tooClose') : t('map.offline')}
            </p>
          )}
        </div>
      </div>

      {/* Distance and bearing per track: the two numbers you actually act on.
          Named as a group of its own, because a stage's name and its drift are
          also the names in the simulations table behind this - a reader (or a
          spec) asking for "Stage 1" has to be able to say WHICH one. */}
      <div
        role="group"
        aria-label={t('flight.groundTrackReadout')}
        className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 px-3 pb-1"
      >
        {drawn.map((l) => (
          <span key={l.key} className="flex items-center gap-1.5 text-[11px] text-slate-300">
            <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: l.color }} />
            {/* The name in an element of its own rather than a bare text node,
                so it can be read (and matched) apart from the figures beside it. */}
            <span>{l.name}</span>
            <span className="tabular-nums text-slate-400">
              {fmtDist(l.distance)} · {fmtNum(l.bearing, 0)}°
            </span>
          </span>
        ))}
        {!drawn.length && <span className="text-[11px] text-slate-500">{t('flight.groundTrackEmpty')}</span>}
      </div>
    </div>
  );
}
