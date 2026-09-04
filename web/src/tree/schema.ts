import type { ComponentType } from '../engine/openRocketEngine';

/**
 * Editor display names for every component type.
 *
 * This module once also held containment rules, default nodes, and the
 * per-type property-field tables, but those were superseded by the live
 * definitions in `services/treeEdit` (containment / allowed children) and
 * `components/design/PropertyPanel` (field tables) and became dead exports —
 * `DISPLAY_NAME` (used by the canvas) is all that remains in use.
 */
export const DISPLAY_NAME: Record<ComponentType, string> = {
  // Engine-supported since Release B; editor UI arrives with Release C.
  stage: 'Stage',
  nosecone: 'Nose cone',
  transition: 'Transition',
  bodytube: 'Body tube',
  trapezoidfinset: 'Trapezoidal fins',
  ellipticalfinset: 'Elliptical fins',
  freeformfinset: 'Freeform fins',
  tubefinset: 'Tube fins',
  innertube: 'Inner tube',
  tubecoupler: 'Tube coupler',
  centeringring: 'Centering ring',
  bulkhead: 'Bulkhead',
  engineblock: 'Engine block',
  launchlug: 'Launch lug',
  railbutton: 'Rail button',
  parachute: 'Parachute',
  streamer: 'Streamer',
  shockcord: 'Shock cord',
  masscomponent: 'Mass component',
  fairing: 'Camera shroud / fairing',
  podset: 'Pod set',
  parallelstage: 'Booster (parallel stage)',
};
