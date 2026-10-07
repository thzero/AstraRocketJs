// The motor catalog's row key, for the build-time scripts.
//
// MUST match `keyOf` in src/components/sim/motorKey.ts, which is the dashboard
// row key AND the selection identity: two motors that produce the same key
// select, check and highlight as one. `tests/services/motors/motorRowKey.test.ts`
// holds the two implementations equal, because this cannot import the TypeScript
// one (a plain .mjs script has no TS loader) and a third hand-written copy is
// how the rule drifts.
//
// There WAS a third copy: the publish workflow spelled the same expression
// inline to warn about collisions, in a summary step that ran AFTER the publish
// and never failed the job. The check lives in `assertSane` now, where it can
// refuse to write the file at all.

/** @param {{manufacturer: string, designation: string, diameter: number, code?: string}} m */
export const motorRowKey = (m) => `${m.manufacturer}|${m.designation}|${m.diameter}|${m.code ?? ''}`;

/**
 * Every key carried by more than one motor, each listed once.
 *
 * Upstream can introduce a colliding pair at any time, and it has: this is a
 * property of the data, not of our code, so it is checked on every sync rather
 * than assumed.
 *
 * @param {ReadonlyArray<{manufacturer: string, designation: string, diameter: number, code?: string}>} motors
 * @returns {string[]}
 */
export function collidingRowKeys(motors) {
  const count = new Map();
  for (const m of motors) {
    const k = motorRowKey(m);
    count.set(k, (count.get(k) ?? 0) + 1);
  }
  return [...count.entries()].filter(([, n]) => n > 1).map(([k]) => k);
}
