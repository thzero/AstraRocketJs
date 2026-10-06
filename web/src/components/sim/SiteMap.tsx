import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  MIN_ZOOM,
  SITE_ZOOM,
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
  type TileSourceId,
} from '../../services/map/slippyMap';
import { rememberTileLayer, tileLayer } from '../../services/map/tileLayer';
import { useUnits, type Units } from '../../prefs/useUnits';
import { fmtNum, withUnit } from '../../i18n/format';
import { siToUi } from '../../prefs/units';
import { useElementResize } from '../common/useElementResize';
import { useTileVerdict } from '../common/map/useTileVerdict';
import { MapCredit, TileImg, TileLayerButtons } from '../common/map/MapParts';
import { SOURCE_LAYERS } from '../common/map/mapStyle';

/**
 * The launch site, seen from above.
 *
 * A latitude and a longitude are four digits each and no feedback whatsoever:
 * a dropped minus sign moves a Colorado field to western China and nothing on
 * screen looks any different. This is the confirmation — and for a club field
 * with no published coordinates, the way to enter them at all, since you can
 * recognize the mown strip from the air when you could never have looked its
 * numbers up.
 *
 * Tiles come from Esri's imagery or OpenStreetMap, drawn as plain `<img>` tags
 * at computed offsets rather than through a mapping library: showing one point
 * and letting it be dragged is the whole requirement, and Leaflet or MapLibre
 * would bring a layer system, a plugin surface and a stylesheet for the parts
 * we do not use. The projection lives in `services/map/slippyMap.ts`, where it is
 * tested against hand-computed figures.
 *
 * Tiles are cached by the service worker (see the runtime rule in
 * vite.config.ts), so a location you looked at at home still draws at the field with
 * no signal. Somewhere you have NEVER viewed cannot draw offline, and the map
 * says so rather than showing an empty gray box.
 */

/** Below this many pixels of pointer travel, a drag was really a click. */
const CLICK_SLOP_PX = 4;

/** How far one arrow key pans the map, in screen pixels. */
const KEY_PAN_PX = 80;

interface View {
  lat: number;
  lon: number;
  zoom: number;
}

export function SiteMap({
  latitudeDeg,
  longitudeDeg,
  onPick,
  className = 'h-64',
}: {
  latitudeDeg: number | null;
  longitudeDeg: number | null;
  /** Given, the map is a control: clicking moves the location. Omitted, it only shows. */
  onPick?: (latitudeDeg: number, longitudeDeg: number) => void;
  className?: string;
}) {
  const { t } = useTranslation();
  const u = useUnits();
  const hostRef = useRef<HTMLDivElement>(null);
  const keysId = useId();
  const [size, setSize] = useState({ w: 320, h: 256 });
  const [source, setSource] = useState<TileSourceId>(tileLayer());
  const [view, setView] = useState<View>({
    lat: latitudeDeg ?? 0,
    lon: longitudeDeg ?? 0,
    zoom: latitudeDeg === null || longitudeDeg === null ? 2 : SITE_ZOOM,
  });
  const { imagery, onTileLoad, onTileError, retry } = useTileVerdict(source);
  const tiles = TILE_SOURCES[source];

  /**
   * Switching layers re-asks the network, and pressing the layer already shown
   * is a retry, so the buttons stay up while the map is offline.
   */
  const pickSource = (id: TileSourceId) => {
    rememberTileLayer(id);
    retry();
    setSource(id);
  };

  useElementResize(hostRef, (r) => {
    if (r.width > 0 && r.height > 0) setSize({ w: r.width, h: r.height });
  });

  /**
   * Recenter when the coordinates change from OUTSIDE the map.
   *
   * A location picked from the dropdown, an imported `.ork` or "use my location" all
   * move the site and the map has to follow. A click on the map moves it too,
   * and following that one would snap the view out from under the pointer
   * mid-correction, so the coordinate we last emitted is remembered and skipped.
   */
  const emitted = useRef<{ lat: number; lon: number } | null>(null);
  useEffect(() => {
    if (latitudeDeg === null || longitudeDeg === null) return;
    const mine = emitted.current;
    if (mine && Math.abs(mine.lat - latitudeDeg) < 1e-9 && Math.abs(mine.lon - longitudeDeg) < 1e-9) return;
    setView((v) => ({
      lat: latitudeDeg,
      lon: longitudeDeg,
      // Keep the zoom the user has chosen, but come in from the world view:
      // arriving at a real place still zoomed out to whole continents is the
      // same non-answer as no map at all.
      zoom: v.zoom < SITE_ZOOM - 3 ? SITE_ZOOM : v.zoom,
    }));
  }, [latitudeDeg, longitudeDeg]);

  const setZoom = (next: number, about?: { x: number; y: number }) => {
    const z = Math.max(MIN_ZOOM, Math.min(tiles.maxZoom, next));
    if (z === view.zoom) return;
    if (!about) return setView((v) => ({ ...v, zoom: z }));
    // Keep whatever is under the pointer under the pointer.
    const at = unproject(about.x, about.y, view.lat, view.lon, view.zoom, size.w, size.h);
    const cx = lonToTileX(at.longitudeDeg, z) - (about.x - size.w / 2) / TILE_SIZE;
    const cy = latToTileY(at.latitudeDeg, z) - (about.y - size.h / 2) / TILE_SIZE;
    setView({ lat: tileYToLat(cy, z), lon: normalizeLon(tileXToLon(cx, z)), zoom: z });
  };

  // Pan, and the click that is not a pan. One pointer, captured, so a drag that
  // leaves the box keeps working until the button comes up.
  const drag = useRef<{ id: number; x: number; y: number; view: View; moved: number } | null>(null);

  const localPoint = (e: { clientX: number; clientY: number }) => {
    const r = hostRef.current?.getBoundingClientRect();
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (imagery === 'unavailable') return;
    // A control inside the map is NOT the map.
    //
    // The layer buttons, the zoom buttons and the recenter button are children
    // of this box, so their pointer events bubble to these handlers. Without
    // this the handler read a click on a button as a click on the GROUND and
    // moved the launch site to whatever the button was covering: switching to
    // the street layer quietly relocated you to the top-left corner of the map,
    // which is where the layer buttons sit. Leaving `drag` unset also makes
    // `onPointerUp` bail, so one guard covers both halves.
    if ((e.target as Element).closest?.('button')) return;
    // Captured on the BOX, not on `e.target`: the target is usually a tile,
    // and a tile unmounts as soon as the drag pans or zooms past it, which
    // drops the capture mid-gesture.
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, view, moved: 0 };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    d.moved = Math.max(d.moved, Math.abs(dx) + Math.abs(dy));
    if (d.moved < CLICK_SLOP_PX) return;
    const n = 2 ** d.view.zoom;
    const cx = lonToTileX(d.view.lon, d.view.zoom) - dx / TILE_SIZE;
    // Clamped rather than wrapped: the world repeats east-west but there is
    // nothing above the north pole to pan onto.
    const cy = Math.max(0, Math.min(n, latToTileY(d.view.lat, d.view.zoom) - dy / TILE_SIZE));
    setView({
      lat: tileYToLat(cy, d.view.zoom),
      lon: normalizeLon(tileXToLon(cx, d.view.zoom)),
      zoom: d.view.zoom,
    });
  };

  /**
   * The keyboard path, for everything the pointer does: arrows pan, + and -
   * zoom, and Enter or Space puts the location at the center of the view, which
   * a crosshair marks while the map has keyboard focus. Keys aimed at the
   * buttons inside the map are theirs.
   */
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.target !== e.currentTarget) return;
    const pan = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (pan) {
      e.preventDefault();
      const n = 2 ** view.zoom;
      const cx = lonToTileX(view.lon, view.zoom) + (pan[0]! * KEY_PAN_PX) / TILE_SIZE;
      const cy = Math.max(0, Math.min(n, latToTileY(view.lat, view.zoom) + (pan[1]! * KEY_PAN_PX) / TILE_SIZE));
      setView({ lat: tileYToLat(cy, view.zoom), lon: normalizeLon(tileXToLon(cx, view.zoom)), zoom: view.zoom });
    } else if (e.key === '+' || e.key === '=') {
      e.preventDefault();
      setZoom(view.zoom + 1);
    } else if (e.key === '-' || e.key === '_') {
      e.preventDefault();
      setZoom(view.zoom - 1);
    } else if ((e.key === 'Enter' || e.key === ' ') && onPick) {
      e.preventDefault();
      // Rounded like a click (see onPointerUp).
      const lat = +view.lat.toFixed(4);
      const lon = +view.lon.toFixed(4);
      emitted.current = { lat, lon };
      onPick(lat, lon);
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.id !== e.pointerId) return;
    if (d.moved >= CLICK_SLOP_PX || !onPick) return;
    const p = localPoint(e);
    const at = unproject(p.x, p.y, view.lat, view.lon, view.zoom, size.w, size.h);
    // Four places is about 10 m, which is finer than anyone can point at a
    // field and matches what "use my location" writes.
    const lat = +at.latitudeDeg.toFixed(4);
    const lon = +at.longitudeDeg.toFixed(4);
    emitted.current = { lat, lon };
    onPick(lat, lon);
  };

  const pin =
    latitudeDeg === null || longitudeDeg === null
      ? null
      : project(latitudeDeg, longitudeDeg, view.lat, view.lon, view.zoom, size.w, size.h);
  const pinVisible = pin !== null && pin.x > -40 && pin.y > -40 && pin.x < size.w + 40 && pin.y < size.h + 40;

  const ariaLabel =
    latitudeDeg === null || longitudeDeg === null
      ? t('map.label')
      : `${t('map.label')}: ${formatCoord(latitudeDeg, longitudeDeg)}`;

  /**
   * Wheel zoom as a NATIVE non-passive listener, like `useWheelZoom` and
   * `useChartZoom`.
   *
   * React's `onWheel` is registered passive at the root, so a `preventDefault`
   * inside it does nothing: scrolling over the map zoomed the map AND scrolled the
   * launch form underneath it, which on a phone means the map slides out from
   * under the finger that is zooming it.
   *
   * The handler closes over `view` and `imagery`, so it is re-registered when
   * either moves - cheap, and it keeps this a plain effect rather than a
   * latest-value ref.
   */
  useEffect(() => {
    const host = hostRef.current;
    if (!host || imagery === 'unavailable') return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setZoom(view.zoom + (e.deltaY < 0 ? 1 : -1), localPoint(e));
    };
    host.addEventListener('wheel', onWheel, { passive: false });
    return () => host.removeEventListener('wheel', onWheel);
  });

  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <div
        ref={hostRef}
        role="group"
        aria-label={ariaLabel}
        aria-describedby={imagery === 'unavailable' ? undefined : keysId}
        tabIndex={imagery === 'unavailable' ? undefined : 0}
        onKeyDown={imagery === 'unavailable' ? undefined : onKeyDown}
        // `active:` rather than a class chosen from the drag ref: whether a
        // pointer is down is the browser's business, and reading a ref while
        // rendering is how a component ends up not re-rendering when it moves.
        className={`group relative min-h-0 flex-1 overflow-hidden rounded-lg bg-slate-800 ring-1 ring-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${
          imagery === 'unavailable'
            ? 'cursor-default'
            : `${onPick ? 'cursor-crosshair' : 'cursor-grab'} active:cursor-grabbing`
        }`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (drag.current = null)}
      >
        {imagery === 'unavailable' ? (
          <Graticule latitudeDeg={latitudeDeg} longitudeDeg={longitudeDeg} width={size.w} height={size.h} />
        ) : (
          visibleTiles(view.lat, view.lon, view.zoom, size.w, size.h).map((tile) => (
            <TileImg
              key={`${source}:${tile.key}`}
              source={source}
              tile={tile}
              className="pointer-events-none"
              onLoad={onTileLoad}
              onError={onTileError}
            />
          ))
        )}

        {pinVisible && pin && (
          <div
            aria-hidden
            className="pointer-events-none absolute text-lg drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]"
            // The pin's point is the bottom center of the glyph, not its middle.
            style={{ left: pin.x, top: pin.y, transform: 'translate(-50%, -100%)' }}
          >
            📍
          </div>
        )}

        {/* Up offline too: pressing a layer is the retry. */}
        <TileLayerButtons layers={SOURCE_LAYERS} value={source} onPick={pickSource} />
        {imagery !== 'unavailable' && (
          <>
            <span id={keysId} className="sr-only">
              {t(onPick ? 'map.keysPick' : 'map.keysView')}
            </span>
            {onPick && (
              // Where Enter will put the location. Shown only for keyboard focus:
              // a pointer user clicks the spot itself.
              <div
                aria-hidden
                className="pointer-events-none absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 text-xl text-sky-300 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)] group-focus-visible:block"
              >
                +
              </div>
            )}
            <div className="absolute right-1 top-1 flex flex-col overflow-hidden rounded-md ring-1 ring-black/40">
              <button
                onClick={() => setZoom(view.zoom + 1)}
                disabled={view.zoom >= tiles.maxZoom}
                aria-label={t('map.zoomIn')}
                className="bg-slate-900/80 px-2 py-0.5 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-40"
              >
                +
              </button>
              <button
                onClick={() => setZoom(view.zoom - 1)}
                disabled={view.zoom <= MIN_ZOOM}
                aria-label={t('map.zoomOut')}
                className="bg-slate-900/80 px-2 py-0.5 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-40"
              >
                −
              </button>
            </div>
            {!pinVisible && latitudeDeg !== null && longitudeDeg !== null && (
              <button
                onClick={() => setView((v) => ({ ...v, lat: latitudeDeg, lon: longitudeDeg }))}
                className="absolute bottom-1 left-1 rounded-md bg-slate-900/80 px-2 py-1 text-[11px] text-slate-200 ring-1 ring-black/40 hover:bg-slate-800"
              >
                ◎ {t('map.recenter')}
              </button>
            )}
            <MapCredit>{tiles.attribution}</MapCredit>
          </>
        )}
      </div>

      <p className="flex items-baseline justify-between gap-2 text-[11px] leading-tight text-slate-400">
        <span className="tabular-nums">
          {latitudeDeg === null || longitudeDeg === null ? t('map.noCoords') : formatCoord(latitudeDeg, longitudeDeg)}
        </span>
        {imagery === 'unavailable' ? (
          <span className="shrink-0 text-amber-400">{t('map.offline')}</span>
        ) : (
          <span className="shrink-0 tabular-nums">{scaleLabel(u, view.lat, view.zoom)}</span>
        )}
      </p>
      {onPick && imagery !== 'unavailable' && (
        <p className="text-[11px] leading-tight text-slate-500">{t('map.pick')}</p>
      )}
    </div>
  );
}

/**
 * The unit a scale bar PROMOTES to once the number gets large, by the unit the
 * user picked.
 *
 * The label hardcoded m and km, so a user working in feet read the one length on
 * this panel in a unit they do not use. Promoting is still worth doing - "1.2 km"
 * beats "1234 m" - so the ladder is stated rather than dropped, and only for the
 * two base units that have a large sibling in `UNITS.distance`. A user who
 * already picked `km`, `yd` or `mi` is shown that unit at every size.
 */
/** The larger unit a distance unit's scale label moves up to past one of it. */
const SCALE_PROMOTION: Record<string, string> = { m: 'km', ft: 'mi' };

/**
 * Roughly how much ground a hundred pixels covers, for a sense of scale, in the
 * user's own distance unit.
 */
function scaleLabel(u: Units, lat: number, zoom: number): string {
  const meters = metersPerPixel(lat, zoom) * 100;
  const sym = u.sym('distance');
  const up = SCALE_PROMOTION[sym];
  const big = up ? siToUi('distance', up, meters) : 0;
  if (up && big >= 1) return withUnit(fmtNum(big, big >= 10 ? 0 : 1), up);
  return `${u.fmt('distance', meters, 0)} ${sym}`;
}

/**
 * What is left when there are no tiles: a lat/lon grid with the point on it.
 *
 * Deliberately not a drawn coastline. There is no map data in this app and
 * inventing a rough one would put the pin in a shape that is nearly a country,
 * which is worse than no shape at all when the whole job is telling you whether
 * the coordinates are where you meant. The grid and the hemisphere labels do
 * catch the error that actually happens, which is a sign the wrong way round.
 */
function Graticule({
  latitudeDeg,
  longitudeDeg,
  width,
  height,
}: {
  latitudeDeg: number | null;
  longitudeDeg: number | null;
  width: number;
  height: number;
}) {
  const x = longitudeDeg === null ? null : ((longitudeDeg + 180) / 360) * width;
  const y = latitudeDeg === null ? null : ((90 - latitudeDeg) / 180) * height;
  const meridians = [-150, -120, -90, -60, -30, 0, 30, 60, 90, 120, 150];
  const parallels = [-60, -30, 0, 30, 60];

  return (
    <svg width={width} height={height} className="absolute inset-0" aria-hidden>
      <rect width={width} height={height} className="fill-slate-800" />
      {meridians.map((lon) => (
        <line
          key={lon}
          x1={((lon + 180) / 360) * width}
          x2={((lon + 180) / 360) * width}
          y1={0}
          y2={height}
          className={lon === 0 ? 'stroke-slate-500' : 'stroke-slate-700'}
          strokeWidth={1}
        />
      ))}
      {parallels.map((lat) => (
        <line
          key={lat}
          y1={((90 - lat) / 180) * height}
          y2={((90 - lat) / 180) * height}
          x1={0}
          x2={width}
          className={lat === 0 ? 'stroke-slate-500' : 'stroke-slate-700'}
          strokeWidth={1}
        />
      ))}
      {x !== null && y !== null && (
        <>
          <circle cx={x} cy={y} r={5} className="fill-sky-400" />
          <circle cx={x} cy={y} r={11} className="fill-none stroke-sky-400/60" strokeWidth={1.5} />
        </>
      )}
    </svg>
  );
}
