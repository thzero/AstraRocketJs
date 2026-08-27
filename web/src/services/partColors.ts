import type { ComponentType } from '../engine/openRocketEngine';

/**
 * Render colours for the 3D model, grouped so the Settings panel exposes a handful
 * of meaningful swatches (nose, body, fins, …) rather than one per component type.
 * A component's own `color` prop still overrides its group colour.
 */
export type PartKey =
  | 'nose' | 'body' | 'fins' | 'inner' | 'rings' | 'lugs'
  | 'motor' | 'parachute' | 'streamer' | 'mass';

export const PART_KEYS: PartKey[] = ['nose', 'body', 'fins', 'inner', 'rings', 'lugs', 'motor', 'parachute', 'streamer', 'mass'];

export const DEFAULT_PART_COLORS: Record<PartKey, string> = {
  nose: '#b9c2cc',
  body: '#e2ded6',
  fins: '#c98a5a',
  inner: '#5f6a72',
  rings: '#8a8680',
  lugs: '#9a978f',
  motor: '#c65420',
  parachute: '#ff6b3d',
  streamer: '#f59e0b',
  mass: '#7c8b9a',
};

const TYPE_TO_KEY: Partial<Record<ComponentType, PartKey>> = {
  nosecone: 'nose', transition: 'nose',
  bodytube: 'body', fairing: 'body',
  trapezoidfinset: 'fins', ellipticalfinset: 'fins', freeformfinset: 'fins', tubefinset: 'fins',
  innertube: 'inner', tubecoupler: 'inner',
  centeringring: 'rings', bulkhead: 'rings', engineblock: 'rings',
  launchlug: 'lugs', railbutton: 'lugs',
  parachute: 'parachute', streamer: 'streamer', shockcord: 'streamer',
  masscomponent: 'mass',
};

export const UNKNOWN_PART_COLOR = '#cfcabf';

export type PartPalette = Record<PartKey, string>;

/** A full palette from the built-in defaults plus any user overrides (from Settings). */
export const mergePalette = (overrides?: Partial<Record<PartKey, string>>): PartPalette =>
  ({ ...DEFAULT_PART_COLORS, ...overrides });

/** The colour for a component type, given a resolved palette. */
export const colorForType = (type: ComponentType, palette: PartPalette = DEFAULT_PART_COLORS): string => {
  const k = TYPE_TO_KEY[type];
  return k ? palette[k] : UNKNOWN_PART_COLOR;
};
