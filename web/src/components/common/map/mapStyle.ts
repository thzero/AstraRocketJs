import type { TileSourceId } from '../../../services/map/slippyMap';

/** 'off' is a real choice: imagery is context, and sometimes it is in the way. */
export type Layer = 'off' | TileSourceId;

/**
 * The layer buttons, with their labels spelled out.
 *
 * Not `t(`map.${id}`)`: a key built from a variable is invisible to the
 * key-coverage test, which then reports these as dead strings.
 */
export const LAYERS = [
  { id: 'off', labelKey: 'map.none' },
  { id: 'satellite', labelKey: 'map.satellite' },
  { id: 'street', labelKey: 'map.street' },
] as const satisfies readonly { id: Layer; labelKey: string }[];

/** The imagery layers alone, for a map that is nothing without them. */
export const SOURCE_LAYERS = [
  { id: 'satellite', labelKey: 'map.satellite' },
  { id: 'street', labelKey: 'map.street' },
] as const satisfies readonly { id: TileSourceId; labelKey: string }[];

/** Ink for a label that has to read over aerial imagery as well as over nothing. */
export const HALO = {
  paintOrder: 'stroke',
  stroke: 'rgba(2,6,23,0.75)',
  strokeWidth: 3,
  strokeLinejoin: 'round',
} as const;

/** The dark liner under every marked line, so a track never sinks into a field. */
export const LINER = 'rgba(2,6,23,0.75)';

/**
 * How far the imagery may be magnified past its own resolution before it stops
 * being worth drawing.
 *
 * The zoom normally lands within a half step of the drawing, so this never
 * fires on a real flight. It fires on a small one: a still-air launch lands a
 * handful of centimeters from the pad, the view sizes itself to that, and the
 * zoom runs into the provider's maximum. Past that the layer is one tile blown
 * up eighty times: a smear at best, and in practice a box that draws nothing
 * at all while the Satellite button sits there looking pressed.
 *
 * Four, not two. A calm-day club flight lands twenty or thirty meters out, and
 * imagery four times coarser than the plot is blocky but still tells you
 * whether that is the mown strip or the beans beside it, which is the whole
 * job. Below about twenty meters across, a screen pixel is finer than anything
 * Esri holds and there is no ground left to show.
 */
export const MAX_MAGNIFICATION = 4;

/**
 * Tile failures in a row, with nothing loaded, that read as no network. One
 * 404 is a hole in the coverage at this zoom; a whole screenful failing is no
 * network.
 */
export const TILE_FAILURES_OFFLINE = 3;
