import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fmtGroundDistance, type FieldUnit } from '../../prefs/useUnits';
import { rangeRings, type GroundPoint } from '../../services/flight/groundTrack';
import { ellipsePolygon, type DriftEllipse } from '../../services/flight/driftEllipse';
import {
  TILE_SIZE,
  TILE_SOURCES,
  metersPerPixel,
  visibleTiles,
  zoomForMetersPerPixel,
  type TileSourceId,
} from '../../services/map/slippyMap';
import { groundImagery, rememberGroundImagery, rememberTileLayer, tileLayer } from '../../services/map/tileLayer';
import { HALO, LAYERS, LINER, MAX_MAGNIFICATION, type Layer } from '../canvas/GroundTrack';

/**
 * The landing estimate seen from above: the pad at the center, north up, the
 * descent's drift, where it lands, every dispersion landing as a dot and the
 * two-sigma zone around them, with range rings for scale. Imagery under it is
 * the ground track's: off until asked for, the same None / Satellite / Street
 * choice, remembered across both.
 */
export function LandingMap({
  latitudeDeg,
  longitudeDeg,
  path,
  landing,
  samples,
  ellipse,
  distanceUnit,
}: {
  latitudeDeg: number;
  longitudeDeg: number;
  path: readonly GroundPoint[];
  landing: GroundPoint;
  samples: readonly GroundPoint[];
  ellipse: DriftEllipse | null;
  /** The unit the host reads this landing's distance in, so the rings agree with it. */
  distanceUnit: FieldUnit;
}) {
  const { t } = useTranslation();
  const [size, setSize] = useState(320);
  const fitRef = useRef<HTMLDivElement>(null);
  const [layer, setLayer] = useState<Layer>(() => (groundImagery() ? tileLayer() : 'off'));
  const [failed, setFailed] = useState<TileSourceId | null>(null);
  const errors = useRef(0);

  useEffect(() => {
    const el = fitRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]!.contentRect;
      setSize(Math.max(240, Math.min(r.width, 640)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const zone = useMemo(() => (ellipse ? ellipsePolygon(ellipse) : []), [ellipse]);
  const extent = useMemo(() => {
    let m = 50;
    for (const p of [...path, ...samples, ...zone, landing]) m = Math.max(m, Math.abs(p.east), Math.abs(p.north));
    return m * 1.1;
  }, [path, samples, zone, landing]);
  const rings = useMemo(() => rangeRings(extent), [extent]);

  const half = size / 2;
  const pad = 18;
  const scale = (half - pad) / extent;
  const X = (east: number) => half + east * scale;
  const Y = (north: number) => half - north * scale;
  const poly = (points: readonly GroundPoint[]) =>
    points.map((p) => `${X(p.east).toFixed(1)},${Y(p.north).toFixed(1)}`).join(' ');

  const source: TileSourceId | null = layer !== 'off' ? layer : null;
  const tiles = source ? TILE_SOURCES[source] : null;
  const drawnMpp = extent / (half - pad);
  const tileZoom = tiles ? zoomForMetersPerPixel(latitudeDeg, drawnMpp, tiles.maxZoom) : 0;
  const tileScale = tiles ? metersPerPixel(latitudeDeg, tileZoom) / drawnMpp : 1;
  const tileBox = Math.ceil(size / tileScale);
  const tooClose = tileScale > MAX_MAGNIFICATION;
  const mapOn = source !== null && tiles !== null && failed !== source && !tooClose;

  const pickLayer = (next: Layer) => {
    rememberGroundImagery(next !== 'off');
    if (next !== 'off') rememberTileLayer(next);
    errors.current = 0;
    setFailed(null);
    setLayer(next);
  };

  const fmtDist = (m: number) => fmtGroundDistance(distanceUnit, m);
  const grid = mapOn ? 'stroke-white/40' : 'stroke-white/10';

  return (
    <div ref={fitRef} className="flex w-full justify-center">
      <div
        className={`relative shrink-0 overflow-hidden ${mapOn ? 'rounded-lg ring-1 ring-white/10' : ''}`}
        style={{ width: size, height: size }}
      >
        {mapOn && source && tiles && (
          <div
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-1/2"
            style={{ width: tileBox, height: tileBox, transform: `translate(-50%, -50%) scale(${tileScale})` }}
          >
            {visibleTiles(latitudeDeg, longitudeDeg, tileZoom, tileBox, tileBox).map((tile) => (
              <img
                key={`${source}:${tile.key}`}
                src={tiles.url(tile.z, tile.x, tile.y)}
                alt=""
                draggable={false}
                crossOrigin="anonymous"
                width={TILE_SIZE}
                height={TILE_SIZE}
                className="absolute max-w-none select-none"
                style={{ left: tile.left, top: tile.top, width: TILE_SIZE, height: TILE_SIZE }}
                onLoad={() => {
                  errors.current = 0;
                }}
                onError={() => {
                  // A screenful failing is no network; one hole is coverage.
                  errors.current += 1;
                  if (errors.current >= 3) setFailed(source);
                }}
              />
            ))}
          </div>
        )}
        {mapOn && <div aria-hidden className="pointer-events-none absolute inset-0 bg-slate-950/30" />}

        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          role="img"
          aria-label={t('landing.mapLabel', { distance: fmtDist(Math.hypot(landing.east, landing.north)) })}
          className="absolute inset-0"
        >
          {zone.length > 2 && (
            <polygon
              points={poly(zone)}
              fill="#f59e0b"
              fillOpacity={0.12}
              stroke="#f59e0b"
              strokeWidth={1.5}
              strokeDasharray="4 3"
            />
          )}
          {samples.map((p, i) => (
            <circle key={i} cx={X(p.east)} cy={Y(p.north)} r={1.6} className="fill-amber-300/70" />
          ))}
          {rings.map((r) => (
            <g key={r}>
              <circle cx={half} cy={half} r={r * scale} fill="none" className={grid} />
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
          <line x1={pad} y1={half} x2={size - pad} y2={half} className={grid} />
          <line x1={half} y1={pad} x2={half} y2={size - pad} className={grid} />
          <text
            x={half}
            y={pad - 4}
            textAnchor="middle"
            style={mapOn ? HALO : undefined}
            className={`text-[10px] font-semibold ${mapOn ? 'fill-white' : 'fill-slate-400'}`}
          >
            {t('flight.north')}
          </text>
          {mapOn && <polyline points={poly(path)} fill="none" stroke={LINER} strokeWidth={3.75} />}
          <polyline points={poly(path)} fill="none" stroke="#38bdf8" strokeWidth={1.75} />
          {mapOn && (
            <circle cx={X(landing.east)} cy={Y(landing.north)} r={5} fill="none" stroke={LINER} strokeWidth={4} />
          )}
          <circle cx={X(landing.east)} cy={Y(landing.north)} r={5} fill="none" stroke="#38bdf8" strokeWidth={2} />
          {mapOn && <circle cx={half} cy={half} r={5} className="fill-slate-950/75" />}
          <circle cx={half} cy={half} r={3.5} className="fill-slate-200" />
        </svg>

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
        {mapOn && tiles && (
          <p className="pointer-events-none absolute bottom-0 right-0 bg-slate-900/70 px-1 text-[9px] leading-tight text-slate-400">
            {tiles.attribution}
          </p>
        )}
        {source !== null && !mapOn && (
          <p className="pointer-events-none absolute bottom-0 right-0 bg-slate-900/70 px-1 text-[9px] leading-tight text-amber-400">
            {tooClose ? t('map.tooClose') : t('map.offline')}
          </p>
        )}
      </div>
    </div>
  );
}
