import type { ComponentType } from '../engine/openRocketEngine';

/**
 * English fallback names for every component type.
 *
 * This is not the display name: the localized one is the `part.<type>` key in
 * `i18n/locales/*.json`, and `tests/i18n/keys.test.ts` pins that every type here
 * has one. A consumer that shows a component's name should call
 * `t('part.' + node.type)` and keep this table only for a context with no
 * translator in reach (an unnamed node in a plain-text export, a log line).
 * The 2D canvas (`components/canvas/schematicShapes.tsx`) reads it as the last
 * fallback for hover titles, after the node's own name and `cfg.partName`.
 *
 * Containment rules live in `services/design/treeEdit` and the per-type
 * property fields in `components/design/PropertyPanel`, not here.
 */
export const DISPLAY_NAME: Record<ComponentType, string> = {
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
  // Not reachable from the editor (no defaultNode case). Present only in a
  // design loaded from a .ork this app wrote. See openRocketEngine.ts.
  fairing: 'Camera shroud / fairing',
  podset: 'Pod set',
  parallelstage: 'Booster (parallel stage)',
};
