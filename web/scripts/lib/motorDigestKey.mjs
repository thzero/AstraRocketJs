// The key under which a catalog motor and a desktop OpenRocket motor are the
// same motor (sync-motor-digests.mjs).
//
// Manufacturer and designation are compared the way a human reads them. The
// diameter is compared to a tenth of a millimeter, which is what a catalog row
// keeps (lib/motorRow.mjs): desktop holds Apogee's 10.5 mm motors at 0.0105 m,
// and a key on whole millimeters would put them beside 11 mm motors.

/** Manufacturer and designation compared the way a human reads them. */
const norm = (s) => (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** @param {number} diameterMm the motor's diameter in millimeters, from either database */
export const digestKey = (mfr, designation, diameterMm) =>
  `${norm(mfr)}|${norm(designation)}|${Math.round(diameterMm * 10)}`;
