import type { ComponentNode } from '../../engine/openRocketEngine';
import { num } from '../../tree/nodeProps';

/**
 * Second doors onto numbers a part already stores.
 *
 * OpenRocket's config dialogs offer some dimensions two ways round, because the
 * two ways are how people actually have the figure: a trapezoid fin's sweep is
 * a length in the file and an angle on a plan, and a streamer is cut to a
 * length and a width but sold and specified by its area and its aspect ratio.
 * A mass component is the same trade in the other direction: you know the lump
 * weighs 40 g, or you know it is lead.
 *
 * None of these is stored. Each is read from the keys that are, and typing one
 * writes those keys back, exactly as the `bore` row writes a wall. That is why
 * they live here rather than in the FIELDS table as keys: a `derived` field
 * names one of these, and the arithmetic is in one tested place instead of
 * inside a React switch.
 *
 * The formulas are the kernel's, not equivalents of it. Where upstream clamps,
 * refuses or substitutes, so does this: those edges are reachable from the
 * keyboard (a zero-height fin, a zero-width streamer) and an honest-looking
 * `Infinity` would flow into the mass, the mesh and the `.ork`, none of which
 * check for one.
 */

/** `TrapezoidFinSet.MAX_SWEEP_ANGLE`: 89 degrees, not 90, so the tangent is finite. */
export const MAX_SWEEP_ANGLE = (89 * Math.PI) / 180;

/** `MassComponent.setDensity` clamps the mass it computes to this. */
const MAX_MASS = 1_000_000;

/** `Streamer.setArea`/`setAspectRatio` floor the ratio here before dividing by it. */
const MIN_ASPECT = 0.01;

/** The aspect ratio a streamer with no width reports: `Streamer.getAspectRatio`. */
const DEGENERATE_ASPECT = 1000;

export type DerivedName = 'sweepAngle' | 'stripArea' | 'stripAspect' | 'massDensity' | 'clusterSeparation';

export type Derived = {
  /** The unit group this row is measured in; `undefined` for a bare ratio. */
  quantity?: 'angle' | 'area' | 'density' | 'length';
  /**
   * The row's bounds, in SI, and read from the node because two of them depend
   * on it. `min` defaults to 0, as every other numeric row in the panel does;
   * the two that open their floor are the signed ones, a forward sweep and a
   * cluster packed inside itself, neither of which could be entered at all
   * against a floor of zero.
   */
  min?: (node: ComponentNode) => number;
  max?: (node: ComponentNode) => number;
  /** The current value, in SI, from the keys the node does store. */
  read: (node: ComponentNode) => number;
  /** The patch of stored keys that a typed value means. Empty to refuse it. */
  write: (node: ComponentNode, v: number) => Partial<ComponentNode>;
};

/** A mass object's packed volume: `MassComponent.getVolume`, a cylinder. */
const packedVolume = (node: ComponentNode): number => Math.PI * num(node, 'radius') ** 2 * num(node, 'length');

export const DERIVED: Record<DerivedName, Derived> = {
  /**
   * `TrapezoidFinSet.getSweepAngle`/`setSweepAngle`. Measured from the fin's
   * own span, so 0 is a straight leading edge and a negative angle is a
   * forward sweep, which is why this is the one signed row in the panel.
   *
   * A fin with no height has no angle to speak of, and upstream answers with a
   * right angle in whichever direction the sweep already points rather than
   * with `atan2(x, 0)`'s NaN. Setting one is then a no-op, since the sweep it
   * computes is `tan(r) * 0`.
   */
  sweepAngle: {
    quantity: 'angle',
    min: () => -MAX_SWEEP_ANGLE,
    max: () => MAX_SWEEP_ANGLE,
    read: (node) => {
      const height = num(node, 'height');
      const sweep = num(node, 'sweep');
      if (height === 0) return sweep === 0 ? 0 : Math.sign(sweep) * (Math.PI / 2);
      return Math.atan2(sweep, height);
    },
    write: (node, v) => {
      const height = num(node, 'height');
      const sweep = Math.tan(Math.max(-MAX_SWEEP_ANGLE, Math.min(MAX_SWEEP_ANGLE, v))) * height;
      return Number.isFinite(sweep) ? { sweep } : {};
    },
  },

  /**
   * `Streamer.getArea`/`setArea`. Typing an area keeps the aspect ratio and
   * resizes both sides to suit, which is the point of the row: a streamer is
   * specified by how much fabric it is and how long and thin, and changing how
   * much fabric should not change how long and thin.
   */
  stripArea: {
    quantity: 'area',
    read: (node) => num(node, 'stripWidth') * num(node, 'stripLength'),
    write: (node, v) => {
      const ratio = Math.max(DERIVED.stripAspect.read(node), MIN_ASPECT);
      const stripWidth = Math.sqrt(Math.max(0, v) / ratio);
      return Number.isFinite(stripWidth) ? { stripWidth, stripLength: ratio * stripWidth } : {};
    },
  },

  /**
   * `Streamer.getAspectRatio`/`setAspectRatio`, length over width. Typing one
   * keeps the area and re-cuts the strip, the mirror of the row above.
   *
   * A strip narrower than 0.1 mm reports 1000 rather than a division by
   * something near zero; it is upstream's own answer and it also gives the
   * field a finite number to show for a streamer that has been zeroed out.
   */
  stripAspect: {
    read: (node) => {
      const w = num(node, 'stripWidth');
      return w > 0.0001 ? num(node, 'stripLength') / w : DEGENERATE_ASPECT;
    },
    write: (node, v) => {
      const ratio = Math.max(v, MIN_ASPECT);
      const stripWidth = Math.sqrt(DERIVED.stripArea.read(node) / ratio);
      return Number.isFinite(stripWidth) ? { stripWidth, stripLength: ratio * stripWidth } : {};
    },
  },

  /**
   * `InnerTube.getClusterScaleAbsolute`/`setClusterScaleAbsolute`: the gap
   * between neighboring tubes as a distance, where the stored `clusterScale` is
   * a multiple of the tube diameter. Zero is tubes touching, negative is tubes
   * cutting into each other, which is legal and is how a tight cluster is drawn.
   *
   * The desktop puts one spinner here and two radio buttons choosing which of
   * the two it edits, remembered as a preference. A one-column panel shows both
   * rows instead: the same two numbers, live, with nothing to remember.
   */
  clusterSeparation: {
    quantity: 'length',
    // A tube can be packed inside its neighbors, so this is the other signed
    // row. Its floor is one whole diameter in, which is where `clusterScale`
    // hits the 0 the kernel clamps it to.
    min: (node) => -num(node, 'outerRadius') * 2,
    read: (node) => (num(node, 'clusterScale', 1) - 1) * num(node, 'outerRadius') * 2,
    write: (node, v) => {
      const d = num(node, 'outerRadius') * 2;
      if (!(d > 0)) return {};
      // `setClusterScale` floors at 0, so a gap more negative than one diameter
      // lands on tubes exactly concentric rather than inside out.
      return { clusterScale: Math.max(0, v / d + 1) };
    },
  },

  /**
   * `MassComponent.getDensity`/`setDensity`: the mass spread through the packed
   * cylinder. Approximate, and labeled so, because the packed size is the room
   * the lump takes up rather than the lump.
   *
   * A part with no packed volume has no density (upstream substitutes 0 for
   * the NaN), and typing one into it is refused rather than writing a mass of 0
   * over whatever is there.
   */
  massDensity: {
    quantity: 'density',
    read: (node) => {
      const d = num(node, 'mass') / packedVolume(node);
      return Number.isFinite(d) ? d : 0;
    },
    write: (node, v) => {
      const mass = v * packedVolume(node);
      if (!Number.isFinite(mass)) return {};
      return { mass: Math.max(0, Math.min(MAX_MASS, mass)) };
    },
  },
};
