// The order of a motor's bundled thrust curves, best first.
//
// The first curve is the one a flight uses by default, and its file sets the
// motor's loaded mass (sync-motors.mjs). So the order must not depend on the
// order thrustcurve.org's API happens to return the files in: certified before
// manufacturer before user data, RASP before RockSim, more samples first, and
// then the file's own id, which never changes, so two files that tie on
// everything else always come out the same way round.

const SRC_RANK = { cert: 0, mfr: 1, user: 2 };

/** `files` ranked best first, as a new array. Each file has `source`, `format`,
 *  `samples` and `simfileId`. */
export function rankCurves(files) {
  return [...files].sort(
    (a, b) =>
      (SRC_RANK[a.source] ?? 9) - (SRC_RANK[b.source] ?? 9) ||
      (a.format === 'RASP' ? 0 : 1) - (b.format === 'RASP' ? 0 : 1) ||
      b.samples.length - a.samples.length ||
      String(a.simfileId ?? '').localeCompare(String(b.simfileId ?? ''), 'en'),
  );
}
