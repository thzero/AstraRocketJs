/**
 * Build-time feature flags for capabilities that are gated OFF until they're
 * finished. These are DEV switches, not user settings — flip one to `true`
 * locally to work on / test the feature, and delete the flag (and the gate that
 * reads it) once the feature ships. Being plain `const`s, an unset flag also
 * tree-shakes the gated-out branch away in production builds. See TODO.md.
 */
export const FEATURES = {
  /** Load `.ork` designs with multiple axial stages (booster + sustainer). */
  multiStage: false,
  /** Load `.ork` designs containing external pods (`<podset>`). */
  pods: false,
} as const;
