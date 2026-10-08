import { WAYPOINT_KINDS, type FlightPathExportOptions, type WaypointKind } from './flightPathExport';

/**
 * One-click export shapes, after the three export buttons GPS DC offers. Each
 * spans all three sections of the dialog - which waypoints, whether the lines
 * are drawn, and how the result is placed - because those are the three things
 * that have to agree for a file to answer one question well.
 *
 * They set the controls and nothing else. Nothing is inferred at render time, so
 * the dialog always shows what the file will contain.
 *
 * Each states its selection IN FULL, waypoints included, never a subset. A
 * preset that sets only some of the controls is a one-way door: Landing plots
 * narrows the waypoints to the landing, and if Drift cast then leaves the
 * waypoints alone there is no way back to the other two presets as they are
 * described. Stating all of it keeps every preset reachable from every other.
 */
// `waypoints` is required rather than optional, so the rule that a preset
// states its whole selection is enforced by the compiler and not by memory.
export const EXPORT_PRESETS: {
  id: string;
  options: Partial<FlightPathExportOptions> & { waypoints: Set<WaypointKind> };
}[] = [
  {
    // What the rocket drifts OVER: everything flat on the terrain, and the 3D
    // line dropped because clamped it would only trace the ground track again.
    id: 'driftCast',
    options: {
      waypoints: new Set<WaypointKind>(WAYPOINT_KINDS),
      altitudeReference: 'clamped',
      waypointAltitudeReference: 'clamped',
      includeFlightPath: false,
      includeGroundTrack: true,
      drawShadow: false,
    },
  },
  {
    // How high it went: suspended in the air where it belongs.
    //
    // No shadow. A plumb line under ONE pin reads as a position; a curtain
    // under the whole length of an arcing flight path is a solid wall that
    // buries the flight it is meant to explain. The checkbox stays, for the
    // case it is good at.
    //
    // This preset must state exactly what `defaultExportOptions` gives a fresh
    // dialog, or the panel opens in a shape no button claims. It is the
    // default state AND a selected one.
    id: 'flightPath',
    options: {
      waypoints: new Set<WaypointKind>(WAYPOINT_KINDS),
      altitudeReference: 'automatic',
      waypointAltitudeReference: 'automatic',
      includeFlightPath: true,
      includeGroundTrack: true,
      drawShadow: false,
    },
  },
  {
    // Where it comes down, and nothing else.
    id: 'landing',
    options: {
      waypoints: new Set<WaypointKind>(['landing']),
      altitudeReference: 'clamped',
      waypointAltitudeReference: 'clamped',
      includeFlightPath: false,
      includeGroundTrack: false,
      drawShadow: false,
    },
  },
];

/**
 * The preset whose stated options the dialog currently matches, or null.
 *
 * The highlight has to be able to show NOTHING. A preset only sets the
 * controls, so the moment one of them is adjusted by hand the state is no
 * preset's, and a button still claiming it would be lying about what the file
 * will contain. Clearing it - and reselecting when the controls match again -
 * is what keeps the highlight honest.
 *
 * Compared over whatever each preset STATES, read off the object rather than
 * listed here, so a preset that grows a key joins the comparison with it.
 */
export function matchingPreset(opts: FlightPathExportOptions): string | null {
  const same = (a: unknown, b: unknown): boolean => {
    if (a instanceof Set) {
      const other = b as Set<unknown>;
      return other instanceof Set && other.size === a.size && [...a].every((v) => other.has(v));
    }
    return a === b;
  };
  const current = opts as unknown as Record<string, unknown>;
  const match = EXPORT_PRESETS.find((preset) =>
    Object.entries(preset.options).every(([key, value]) => same(value, current[key])),
  );
  return match?.id ?? null;
}
