// @vitest-environment jsdom
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { importOrk } from './orkFile';
import { findCatalogMotor, type CatalogMotor } from './motorDb';
import { __setEngineForTests, OpenRocketDesign } from '../engine/openRocketEngine';

/**
 * Every bundled example, flown through the REAL kernel.
 *
 * These files are not ours: they come from OpenRocket via
 * `scripts/sync-examples.mjs`, which also STRIPS each one's stored flight data
 * (96% of the bytes). Two things could go wrong silently and both would ship a
 * broken front door — the strip could damage a design, and an upstream bump
 * could bring in an example using something the importer does not handle. A
 * user's first click would be the thing that found out.
 *
 * So the whole set is imported and built here, and the motors are resolved
 * against the committed catalog: an example that imports but cannot fly is a
 * worse example than no example.
 *
 * The real engine makes this one of the slower files in the suite (~2 s for all
 * seventeen), which is the cost of checking the real thing rather than a stub.
 */
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

// vitest runs with `web/` as its root, so the repo paths hang off cwd —
// `import.meta.url` is not a file: URL under the jsdom environment.
const PUBLIC = resolve(process.cwd(), 'public');
const EXAMPLES = join(PUBLIC, 'examples');

interface Entry {
  id: string;
  file: string;
  name: string;
  description: string | null;
  bytes: number;
}

const index: { source: { repo: string; ref: string }; examples: Entry[] } = JSON.parse(
  readFileSync(join(EXAMPLES, 'examples.generated.json'), 'utf8'),
);
const catalog: CatalogMotor[] = JSON.parse(readFileSync(join(PUBLIC, 'data/motors.generated.json'), 'utf8'));

/** The file's bytes as a fresh ArrayBuffer (not a view into node's pooled Buffer). */
function read(file: string): ArrayBuffer {
  const b = readFileSync(join(EXAMPLES, file));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

beforeAll(async () => {
  __setEngineForTests(await import('../engine/vendor/openrocket-engine.mjs'));
});

describe('the bundled examples index', () => {
  it('is pinned to the same upstream the engine was extracted from', () => {
    // An example from a different commit could demonstrate something this
    // kernel does not have. extract/UPSTREAM is the one source of that ref.
    const upstream = readFileSync(resolve(process.cwd(), '../engine-java/extract/UPSTREAM'), 'utf8');
    expect(index.source.ref).toBe(upstream.match(/^ref\s*=\s*(\S+)/m)?.[1]);
  });

  it('lists every file it ships, and ships every file it lists', () => {
    expect(index.examples.length).toBeGreaterThan(0);
    for (const e of index.examples) expect(existsSync(join(EXAMPLES, e.file)), e.file).toBe(true);
  });

  it('gives each one a name and an id that match its file', () => {
    for (const e of index.examples) {
      expect(e.name.trim(), e.id).not.toBe('');
      expect(e.file).toBe(`${e.id}.ork`);
    }
  });

  it('keeps the whole set small enough to precache', () => {
    // These are precached (vite.config.ts globPatterns includes `ork`), so the
    // set's size is paid by every install. It is ~340 kB stripped; this is the
    // tripwire for an upstream bump that quietly brings back the flight data or
    // adds a photo-heavy design.
    const total = index.examples.reduce((n, e) => n + e.bytes, 0);
    expect(total).toBeLessThan(1_500_000);
  });
});

describe.each(index.examples.map((e) => [e.name, e] as const))('example: %s', (_name, e) => {
  it('imports, builds and has a flyable motor', () => {
    const res = importOrk(read(e.file));

    // Nothing in the file was beyond the importer.
    expect([...(res.ignored ?? [])]).toEqual([]);
    expect(res.tree.components.length).toBeGreaterThan(0);

    const info = OpenRocketDesign.buildTree(res.tree).staticInfo();
    for (const [key, v] of Object.entries({
      length: info.length,
      mass: info.mass,
      cg: info.cg,
      cp: info.cp,
    })) {
      expect(Number.isFinite(v), `${key} = ${v}`).toBe(true);
      expect(v, key).toBeGreaterThan(0);
    }

    // An example whose motor is not in the catalog imports fine and then
    // refuses to run, which is the worst of both: it looks complete and is not.
    const motors = Object.values(res.motors ?? {});
    expect(motors.length, 'no motor in the file').toBeGreaterThan(0);
    for (const m of motors) {
      const hit = findCatalogMotor(catalog, m.designation, m.manufacturer);
      expect(hit, `${m.designation} (${m.manufacturer ?? '?'})`).toBeTruthy();
      expect(hit?.noCurve ?? false, `${m.designation} has no thrust curve`).toBe(false);
    }
  });
});
