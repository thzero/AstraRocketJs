/**
 * RFC-4122 v4 UUID. Uses `crypto.randomUUID()` where available and falls back
 * to a `Math.random()` template for older environments. Generic — used for
 * `.ork` component `<id>`s, simulation ids, and anywhere a globally-unique id is
 * needed. (Distinct from orkTree's `freshId()`, which mints short sequential
 * editor node ids like `c1`, not UUIDs.)
 */
export function uuid(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));
}
