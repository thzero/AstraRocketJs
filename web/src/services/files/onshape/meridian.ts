import type { ComponentNode } from '../../../engine/openRocketEngine';
import { num, numOpt } from '../../../tree/nodeProps';
import { nodeShape, outerProfile, profileEnds } from '../../../tree/shapeProfile';
import { partLength } from '../../../tree/position';
import { kernelDefault } from '../../../tree/kernelDefaults';

/**
 * The meridian sections of a nose cone or transition, in the form the
 * OpenRocket-Onshape feature revolves (`sketchProfile` and `sketchShoulder` in
 * its component_sketches.fs).
 *
 * Every point is `[radius, y]` with the part's aft end at `y = 0` and its fore
 * end at `y = length`, ordered fore to aft. Shoulders are separate polygons the
 * feature revolves and unions on: a fore shoulder spans `y` from `length` to
 * `length + shoulder length`, an aft one from `-shoulder length` to 0.
 *
 * The wall is the one the kernel weighs, not the one it fits rings against.
 * `SymmetricComponent.calculateProperties` cuts each of its `DIVISIONS` slices
 * to a radial depth of `thickness * hyp / l`, the depth that leaves a wall
 * `thickness` thick perpendicular to the slice's own slope, so the part built
 * from these sections has the volume, and with the part's density the mass,
 * that the simulation flies. `Transition.getInnerRadius` (`r - thickness`) is the
 * fit rule and would build a heavier part on any sloped wall.
 */

/** `SymmetricComponent.DIVISIONS`: the slices the kernel integrates a body over. */
const DIVISIONS = 128;

/** `Transition.MINFEATURE`: the shortest shoulder the kernel gives any volume. */
const MIN_FEATURE = 0.001;

/** Radii closer than this are one point. */
const EPS = 1e-9;

export type Pt = [number, number];

export interface Section {
  /** Outer surface, fore to aft. */
  profile: Pt[];
  /** Bore, fore to aft. Two points on the axis when `innerIsAxis`. */
  innerProfile: Pt[];
  /** The section is solid: its bore is the axis. */
  innerIsAxis: boolean;
}

export interface Shoulder {
  radius: number;
  length: number;
  thickness: number;
  capped: boolean;
}

export interface SymmetricSections {
  body: Section;
  /** One polygon per shoulder; null on an end with none. */
  shoulders: { fore: Section | null; aft: Section | null };
}

/** Append `p` unless it repeats the previous point. */
function push(points: Pt[], p: Pt): void {
  const last = points[points.length - 1];
  if (last && Math.abs(last[0] - p[0]) < EPS && Math.abs(last[1] - p[1]) < EPS) return;
  points.push(p);
}

/** The section's bore is the axis everywhere: two axis points, fore and aft. */
function axisBore(fore: number, aft: number): Pt[] {
  return [
    [0, fore],
    [0, aft],
  ];
}

/**
 * The shoulders of a nose cone or transition, fore and aft, as the kernel
 * holds them. A nose cone keeps one shoulder, at its base: aft, or fore once it
 * is flipped into a tail cone (`NoseCone.getShoulderRadius` and its siblings
 * read the fore fields when flipped).
 */
export function shouldersOf(node: ComponentNode): { fore: Shoulder; aft: Shoulder } {
  const read = (prefix: string): Shoulder => ({
    radius: num(node, `${prefix}Radius`, 0),
    length: num(node, `${prefix}Length`, 0),
    thickness: num(node, `${prefix}Thickness`, 0),
    capped: node[`${prefix}Capped`] === true,
  });
  const none: Shoulder = { radius: 0, length: 0, thickness: 0, capped: false };
  if (node.type === 'nosecone') {
    const base = read('shoulder');
    return node['flipped'] === true ? { fore: base, aft: none } : { fore: none, aft: base };
  }
  return { fore: read('foreShoulder'), aft: read('aftShoulder') };
}

/** The outer radius at each of the kernel's slice boundaries, fore to aft. */
function stations(node: ComponentNode, length: number): number[] {
  const { fore, aft } = profileEnds(node);
  const clipped = typeof node['clipped'] === 'boolean' ? node['clipped'] : undefined;
  return outerProfile(
    nodeShape(node),
    numOpt(node, 'shapeParameter'),
    length,
    fore,
    aft,
    DIVISIONS,
    undefined,
    clipped,
  ).map(([, r]) => r);
}

/**
 * The bore at each slice boundary. A boundary sits between two slices, each
 * cut to its own depth; the point takes the mean of the two, and an end takes
 * its one slice's.
 */
function boreRadii(radii: number[], length: number, wall: number): number[] {
  const l = length / DIVISIONS;
  const depth = radii.slice(1).map((r, n) => (wall * Math.hypot(r - radii[n]!, l)) / l);
  return radii.map((r, i) => {
    const before = depth[i - 1];
    const after = depth[i];
    const d = before === undefined ? after! : after === undefined ? before : (before + after) / 2;
    return Math.max(r - d, 0);
  });
}

/** The body's own section, with no shoulders. */
function bodySection(node: ComponentNode, length: number, radii: number[]): Section {
  const y = (i: number) => length * (1 - i / DIVISIONS);
  const profile: Pt[] = [];
  radii.forEach((r, i) => push(profile, [r, y(i)]));
  if (node['filled'] === true) return { profile, innerProfile: axisBore(length, 0), innerIsAxis: true };
  const wall = num(node, 'thickness', kernelDefault(node.type, 'thickness') ?? 0);
  const bore = boreRadii(radii, length, wall);
  if (bore.every((r) => r < EPS)) return { profile, innerProfile: axisBore(length, 0), innerIsAxis: true };
  const innerProfile: Pt[] = [];
  bore.forEach((r, i) => push(innerProfile, [r, y(i)]));
  return { profile, innerProfile, innerIsAxis: false };
}

/**
 * One shoulder's polygon. The outline steps from the shoulder's radius to the
 * body's at the end plane, and the bore from the shoulder's to the body's, so
 * the shoulder's join face is the body's end annulus and the union has a face
 * to merge on. A cap is a disc of the shoulder's own wall at its free end, as
 * the kernel weighs it (`Transition.calculateProperties`).
 *
 * Null when the kernel gives the shoulder no volume: shorter than
 * `MINFEATURE`, no radius, or no wall (`r - thickness` leaves a bore as wide as
 * the shoulder, a ring of nothing).
 */
function shoulderSection(
  s: Shoulder,
  which: 'fore' | 'aft',
  length: number,
  endR: number,
  bodyBore: number,
): Section | null {
  if (!(s.length > MIN_FEATURE) || !(s.radius > 0) || !(s.thickness > 0)) return null;
  const bore = Math.max(s.radius - s.thickness, 0);
  const solid = bore < EPS;
  const joinBore = solid ? 0 : bodyBore;
  const cap = s.capped && !solid ? Math.min(s.thickness, s.length) : 0;
  const profile: Pt[] = [];
  const innerProfile: Pt[] = [];
  if (which === 'fore') {
    const free = length + s.length;
    push(profile, [s.radius, free]);
    push(profile, [s.radius, length]);
    push(profile, [endR, length]);
    if (cap > 0) {
      push(innerProfile, [0, free]);
      push(innerProfile, [0, free - cap]);
      push(innerProfile, [bore, free - cap]);
    } else {
      push(innerProfile, [bore, free]);
    }
    push(innerProfile, [bore, length]);
    push(innerProfile, [joinBore, length]);
  } else {
    const free = -s.length;
    push(profile, [endR, 0]);
    push(profile, [s.radius, 0]);
    push(profile, [s.radius, free]);
    push(innerProfile, [joinBore, 0]);
    push(innerProfile, [bore, 0]);
    if (cap > 0) {
      push(innerProfile, [bore, free + cap]);
      push(innerProfile, [0, free + cap]);
      push(innerProfile, [0, free]);
    } else {
      push(innerProfile, [bore, free]);
    }
  }
  return { profile, innerProfile, innerIsAxis: innerProfile.every(([r]) => r < EPS) };
}

/** A nose cone's or transition's body section and its shoulder polygons. */
export function symmetricSections(node: ComponentNode): SymmetricSections {
  const length = Math.max(partLength(node), 0);
  const radii = stations(node, length);
  const body = bodySection(node, length, radii);
  const { fore, aft } = shouldersOf(node);
  const boreAt = (end: 'fore' | 'aft'): number => {
    const pts = body.innerProfile;
    return (end === 'fore' ? pts[0] : pts[pts.length - 1])?.[0] ?? 0;
  };
  return {
    body,
    shoulders: {
      fore: shoulderSection(fore, 'fore', length, radii[0] ?? 0, boreAt('fore')),
      aft: shoulderSection(aft, 'aft', length, radii[radii.length - 1] ?? 0, boreAt('aft')),
    },
  };
}
