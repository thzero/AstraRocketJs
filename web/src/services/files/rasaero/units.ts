import { plainDecimal } from '../numberText';

/**
 * RASAero's units and number formatting. Geometry in INCHES (× 39.37 from
 * meters), diameters not radii; angles degrees; altitudes feet; weights
 * pounds; speeds mph; pressure in-Hg.
 */

export const IN = 39.37; // inches per meter (desktop OPENROCKET_TO_RASAERO_LENGTH)
export const FT = 3.28084;
export const LB = 2.20462262;
export const MPH = 2.23694; // mph per m/s
export const INHG = 33.8639; // hPa per in-Hg

/** Four decimals, trailing zeros trimmed, never "-0"; a non-finite value is 0. */
export const fmt = (v: number): string => plainDecimal(v, 4, '0');

/** The line sink and the running absolute location (nose tip origin, meters). */
export interface Cdx1Writer {
  lines: string[];
  locM: number;
  emit: (s: string) => void;
}

export function createCdx1Writer(): Cdx1Writer {
  const lines: string[] = [];
  return { lines, locM: 0, emit: (s) => lines.push(s) };
}
