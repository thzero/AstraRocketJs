import type { ComponentType } from '../engine/openRocketEngine';

/**
 * Default render colour per component type — distinct hues so the parts read
 * apart in the 3D model (and the flight-path recovery device). A component's own
 * `color` prop (set via the property panel) overrides this. Motors aren't tree
 * nodes, so their exhaust-case colour is a standalone constant.
 */
export const PART_COLORS: Partial<Record<ComponentType, string>> = {
  nosecone: '#b9c2cc',
  transition: '#b9c2cc',
  bodytube: '#e2ded6',
  fairing: '#9a978f',
  trapezoidfinset: '#c98a5a',
  ellipticalfinset: '#c98a5a',
  freeformfinset: '#c98a5a',
  tubefinset: '#c98a5a',
  innertube: '#5f6a72',
  tubecoupler: '#6b6862',
  centeringring: '#8a8680',
  bulkhead: '#8a8680',
  engineblock: '#c65420',
  launchlug: '#9a978f',
  railbutton: '#9a978f',
  masscomponent: '#7c8b9a',
  parachute: '#ff6b3d',
  streamer: '#f59e0b',
  shockcord: '#b0a58f',
};

export const DEFAULT_PART_COLOR = '#cfcabf';
export const MOTOR_COLOR = '#c65420';

/** The default colour for a component type (before any per-part override). */
export const partColor = (type: ComponentType): string => PART_COLORS[type] ?? DEFAULT_PART_COLOR;
