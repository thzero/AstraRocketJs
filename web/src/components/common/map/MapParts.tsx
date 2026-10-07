import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { TILE_SIZE, TILE_SOURCES, visibleTiles, type TileSourceId } from '../../../services/map/slippyMap';

/** The layer buttons over a map. `className` places the group. */
export function TileLayerButtons<Id extends string>({
  layers,
  value,
  onPick,
  className = 'absolute left-1 top-1',
}: {
  layers: readonly { id: Id; labelKey: string }[];
  value: Id;
  onPick: (id: Id) => void;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <div className={`${className} flex overflow-hidden rounded-md ring-1 ring-black/40`}>
      {layers.map((l) => (
        <button
          key={l.id}
          onClick={() => onPick(l.id)}
          aria-pressed={value === l.id}
          className={`px-2 py-1 text-[11px] font-medium ${
            value === l.id ? 'bg-sky-600 text-white' : 'bg-slate-900/80 text-slate-300 hover:bg-slate-800'
          }`}
        >
          {t(l.labelKey)}
        </button>
      ))}
    </div>
  );
}

/** One map tile. */
export function TileImg({
  source,
  tile,
  onLoad,
  onError,
  className = '',
}: {
  source: TileSourceId;
  tile: ReturnType<typeof visibleTiles>[number];
  onLoad: () => void;
  onError: () => void;
  className?: string;
}) {
  return (
    <img
      src={TILE_SOURCES[source].url(tile.z, tile.x, tile.y)}
      alt=""
      draggable={false}
      // CORS, to match the 3D ground map (FlightGroundMap.tsx), which loads
      // these same tiles as WebGL textures and cannot use an opaque response.
      // Without it the service worker caches this request's opaque copy and
      // then hands it to the texture loader, which fails. Esri answers
      // `Access-Control-Allow-Origin: *`.
      crossOrigin="anonymous"
      // No `referrerPolicy="no-referrer"`. Stripping the Referer hides WHO is
      // asking, which is the one thing every tile provider's usage policy wants
      // to be able to see.
      width={TILE_SIZE}
      height={TILE_SIZE}
      // Sized in CSS, not just by the attributes, and `max-w-none` to beat the
      // `img { max-width: 100% }` every CSS reset ships (Tailwind's preflight
      // here). That cap is relative to the containing block, which in a plan
      // view is narrower than the box whenever the imagery is magnified: the
      // tiles would draw shrunk while still spaced a full tile apart, leaving
      // gaps, and at extreme zoom the map would come up empty.
      className={`absolute max-w-none select-none ${className}`}
      style={{ left: tile.left, top: tile.top, width: TILE_SIZE, height: TILE_SIZE }}
      onLoad={onLoad}
      onError={onError}
    />
  );
}

/** The line in a map's corner: the tiles' attribution, or why there are none. */
export function MapCredit({
  children,
  warn = false,
  className = 'absolute bottom-0 right-0',
}: {
  children: ReactNode;
  warn?: boolean;
  className?: string;
}) {
  return (
    <p
      className={`pointer-events-none ${className} bg-slate-900/70 px-1 text-[9px] leading-tight ${
        warn ? 'text-amber-400' : 'text-slate-400'
      }`}
    >
      {children}
    </p>
  );
}
