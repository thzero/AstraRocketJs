import { KERNEL_DEFAULTS } from '../tree/kernelDefaults';

/**
 * Fallback values the FILE services share.
 *
 * `orkImport` (what a missing `.ork` tag becomes), `orkExport` (what an absent
 * node key is written as) and `dxfExport` (what an absent key is cut as) each
 * carried their own literal for the same field, and the copies had drifted:
 * the engine block wall was 0.001 in the .ork reader and writer but 0.00095 in
 * the DXF, and a bulkhead read as 0.003 long and wrote back as 0.002. A part
 * that lost a tag on the way in came out a different size on the way out, and
 * nothing reported it.
 *
 * Where the kernel has a default for the field (`kernelDefaults.ts`, verified
 * against the real engine) it is the authority and is re-exported here rather
 * than copied. The rest are values the kernel never reads (a rail button's
 * flange, a chute's packed radius), taken from the desktop's own constructors
 * and cited at each entry, so a file the desktop wrote without the tag reads
 * as the desktop would have built it.
 *
 * Scope: only fields that were duplicated across those three files. It is not
 * a catalog of every component default; `treeEdit.defaultNode` decides what
 * the editor creates and is a different question.
 */
export const COMPONENT_DEFAULTS = {
  nosecone: {
    length: KERNEL_DEFAULTS.nosecone.length,
    thickness: KERNEL_DEFAULTS.nosecone.thickness,
    aftRadius: KERNEL_DEFAULTS.nosecone.aftRadius,
  },
  transition: {
    // The .ork reader and writer used 0.04 while the kernel builds 0.05
    // (ComponentFactory.java); a transition that lost its tag was flown one
    // length and drawn another.
    length: KERNEL_DEFAULTS.transition.length,
    thickness: KERNEL_DEFAULTS.transition.thickness,
  },
  bodytube: {
    // Same drift: 0.0005 in the .ork services, 0.001 in the DXF, 0.0003 in
    // the kernel. The kernel is the authority (verified by
    // kernelDefaults.kernel.test.ts).
    thickness: KERNEL_DEFAULTS.bodytube.thickness,
  },
  innertube: {
    thickness: KERNEL_DEFAULTS.innertube.thickness,
  },
  tubecoupler: {
    thickness: KERNEL_DEFAULTS.tubecoupler.thickness,
  },
  engineblock: {
    length: KERNEL_DEFAULTS.engineblock.length,
    // The kernel's wall, not the 0.001 the .ork services used to invent: the
    // DXF already cut at this value, so a block that lost its tag was drawn
    // and cut at two different bores.
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
    // Not a kernel default (the factory requires a fin thickness); the .ork
    // services and the DXF cut had all settled on 3 mm.
    thickness: 0.003,
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
