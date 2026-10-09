import { KERNEL_DEFAULTS } from '../../tree/kernelDefaults';

/**
 * Fallback values the file services share.
 *
 * The `.ork` reader (what a missing tag becomes), the `.ork` writer (what an absent
 * node key is written as) and `dxfExport` (what an absent key is cut as), along with
 * the other readers, writers and views that need a fallback, read the same field from
 * here rather than each holding its own literal. Separate copies drift, and a part
 * that loses a tag on the way in then comes out a different size on the way out with
 * nothing reporting it.
 *
 * Where the kernel has a default for the field (`kernelDefaults.ts`, verified
 * against the real engine) it is the authority and is re-exported here rather
 * than copied. The rest are values the kernel never reads (a rail button's
 * flange, a chute's packed radius), taken from the desktop's own constructors
 * and cited at each entry, so a file the desktop wrote without the tag reads
 * as the desktop would have built it.
 *
 * Scope: only fields those consumers share. It is not a catalog of every
 * component default; `treeEdit.defaultNode` decides what the editor creates
 * and is a different question.
 */
export const COMPONENT_DEFAULTS = {
  nosecone: {
    length: KERNEL_DEFAULTS.nosecone.length,
    thickness: KERNEL_DEFAULTS.nosecone.thickness,
    aftRadius: KERNEL_DEFAULTS.nosecone.aftRadius,
  },
  transition: {
    // The kernel's length (ComponentFactory.java), so a transition that lost
    // its tag is not flown at one length and drawn at another.
    length: KERNEL_DEFAULTS.transition.length,
    thickness: KERNEL_DEFAULTS.transition.thickness,
  },
  bodytube: {
    // The kernel is the authority for the wall (verified by
    // kernelDefaults.kernel.test.ts).
    thickness: KERNEL_DEFAULTS.bodytube.thickness,
  },
  innertube: {
    thickness: KERNEL_DEFAULTS.innertube.thickness,
  },
  tubecoupler: {
    length: KERNEL_DEFAULTS.tubecoupler.length,
    thickness: KERNEL_DEFAULTS.tubecoupler.thickness,
  },
  engineblock: {
    length: KERNEL_DEFAULTS.engineblock.length,
    // The kernel's wall, which is also what the DXF cuts at, so a block that
    // lost its tag is not drawn and cut at two different bores.
    thickness: KERNEL_DEFAULTS.engineblock.thickness,
  },
  centeringring: {
    length: KERNEL_DEFAULTS.centeringring.length,
  },
  bulkhead: {
    length: KERNEL_DEFAULTS.bulkhead.length,
  },
  finset: {
    finCount: KERNEL_DEFAULTS.trapezoidfinset.finCount,
    // The kernel's default for every planar fin type (ComponentFactory).
    thickness: KERNEL_DEFAULTS.trapezoidfinset.thickness,
  },
  railbutton: {
    outerDiameter: KERNEL_DEFAULTS.railbutton.outerDiameter,
    // RailButton() (rocketcomponent/RailButton.java:60-66): total height
    // 0.0097, inner diameter 0.008, flange 0.002, base 0.002, screw 0.
    innerDiameter: 0.008,
    height: 0.0097,
    baseHeight: 0.002,
    flangeHeight: 0.002,
    screwHeight: 0,
    // The desktop's default rail-button material (RailButton.java:67).
    materialName: 'Delrin',
    materialDensity: 1420,
    materialGroup: 'Plastics',
  },
  masscomponent: {
    radius: KERNEL_DEFAULTS.masscomponent.radius,
  },
  // A recovery device's packed size. The length is the kernel's; the radius
  // is MassObject()'s 0.0125 (rocketcomponent/MassObject.java:37), which the
  // kernel never reads but the desktop draws.
  recovery: {
    packedLength: KERNEL_DEFAULTS.parachute.length,
    packedRadius: 0.0125,
  },
} as const;
