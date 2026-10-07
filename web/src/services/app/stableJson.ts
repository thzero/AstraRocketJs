/**
 * JSON with object keys sorted, so equal values give equal strings whatever
 * order their keys were written in. `sanitizeSims` rebuilds a launch block as
 * `{ ...defaults, ...stored }` on every load, which reorders it, so a plain
 * `JSON.stringify` comparison calls a reloaded value different. Array order is
 * kept: it is meaningful (wind levels). Keys named in `skip` are left out at
 * every depth.
 */
export function stableJson(value: unknown, skip?: ReadonlySet<string>): string {
  return JSON.stringify(value, (key, v: unknown) => {
    if (skip?.has(key)) return undefined;
    if (v === null || typeof v !== 'object' || Array.isArray(v)) return v;
    const o = v as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(o)
        .sort()
        .map((k) => [k, o[k]]),
    );
  });
}
