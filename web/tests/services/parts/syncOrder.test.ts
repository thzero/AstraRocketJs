import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * `sync:all` runs the catalog steps in an order where each reads what the
 * steps before it wrote: without a jar, sync-components takes a part's
 * built-in material from the material catalog, so sync:materials runs first. DEVELOPER.md lists the
 * steps in the order sync:all runs them.
 */
describe('sync:all order', () => {
  const web = fileURLToPath(new URL('../../..', import.meta.url));
  const pkg = JSON.parse(readFileSync(`${web}package.json`, 'utf8')) as { scripts: Record<string, string> };
  const steps = [...pkg.scripts['sync:all']!.matchAll(/npm run (sync:[\w-]+)/g)].map((m) => m[1]);

  it('builds materials before components', () => {
    expect(steps.indexOf('sync:materials')).toBeGreaterThanOrEqual(0);
    expect(steps.indexOf('sync:materials')).toBeLessThan(steps.indexOf('sync:components'));
  });

  it('is the order DEVELOPER.md lists', () => {
    const doc = readFileSync(`${web}../docs/DEVELOPER.md`, 'utf8');
    const listed = [...doc.matchAll(/^npm run (sync:[\w-]+)/gm)].map((m) => m[1]).filter((s) => steps.includes(s));
    expect(listed).toEqual(steps);
  });
});
