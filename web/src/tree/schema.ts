import type { ComponentType } from '../engine/openRocketEngine';

/**
 * English FALLBACK names for every component type.
 *
 * This is NOT the display name: the localized one is the `part.<type>` key in
 * `i18n/locales/*.json`, and `i18n/keys.test.ts` pins that every type here has
 * one. A consumer that shows a component's name should call
 * `t('part.' + node.type)` and keep this table only for a context with no
 * translator in reach (an unnamed node in a plain-text export, a log line).
 * The 2D canvas (`components/canvas/schematicShapes.tsx`) still reads it for
 * hover titles and should move to `t('part.' + type)`.
 *
 * This module once also held containment rules, default nodes, and the
 * per-type property-field tables, but those were superseded by the live
 * definitions in `services/treeEdit` (containment / allowed children) and
 * `components/design/PropertyPanel` (field tables) and became dead exports.
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
  // RASAero-origin and unreachable from the editor (no ALLOWED_CHILDREN
  // entry, no defaultNode case, no property panel). Present only in a
  // design loaded from a .ork this app wrote. See openRocketEngine.ts.
  fairing: 'Camera shroud / fairing',
  podset: 'Pod set',
  parallelstage: 'Booster (parallel stage)',
};
