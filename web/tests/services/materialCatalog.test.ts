import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readData, DATA_DIR } from '../testing/dataDir';
import { isMaterialCatalog, type MaterialRow } from '../../src/services/materialTypes';

/**
 * The SHIPPED material catalog, read off disk.
 *
 * `public/data/materials.generated.json` is what the app fetches, and this
 * reads that file rather than anything that imports it: the catalog is no
 * longer bundled, so a test that went through the loader would be testing a
 * fetch stub. Its two inputs are upstream's `Databases.java` (rows marked
 * `upstream`) and the hand-maintained `scripts/data/materials.app.json`
 * (everything else); `scripts/sync-materials.mjs` merges them.
 *
 * What these cannot check is whether a density is RIGHT: each of ours is a
 * number read off a manufacturer document, cited beside it in the app file and
 * in `website/docs/designing-a-rocket.md`. A wrong one is silent — the rocket
 * just weighs the wrong amount — so the citation is the check.
 */
const CATALOG = readData<MaterialRow[]>('materials.generated.json');
const APP = (
  JSON.parse(readFileSync(join(DATA_DIR, '..', '..', 'scripts', 'data', 'materials.app.json'), 'utf8')) as {
    materials: (MaterialRow & { source?: string; note?: string; corrects?: string })[];
  }
).materials;

const of = (kind: string) => CATALOG.filter((m) => m.kind === kind);
const UPSTREAM = of('upstream');
const ADHESIVES = of('adhesive');
const CORRECTED = of('corrected');

describe('the catalog the app fetches', () => {
  it('passes the shape guard the fetch applies to it', () => {
    // The same predicate `fetchCatalog` uses, so a bad row committed here fails
    // in the fast suite rather than emptying the picker in a browser.
    expect(isMaterialCatalog(CATALOG)).toBe(true);
  });

  it('is exactly its two inputs, and nothing else', () => {
    expect(UPSTREAM.length + ADHESIVES.length + CORRECTED.length).toBe(CATALOG.length);
    expect(ADHESIVES.length + CORRECTED.length).toBe(APP.length);
  });

  it('has no duplicate name within a material type', () => {
    // A duplicate would shadow: which density a design got would depend on
    // which row the picker found first.
    const keys = CATALOG.map((m) => `${m.type}\u0000${m.name}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('ships no maintainer-only field', () => {
    // `source`, `note` and `corrects` are why an entry in the app file is
    // trustworthy, and they are for whoever edits that file. The browser has no
    // use for them.
    for (const m of CATALOG) expect(Object.keys(m).sort()).toEqual(['density', 'group', 'kind', 'name', 'type']);
  });
});

/**
 * The adhesives are the ONE part of the table that is not upstream
 * OpenRocket's, added because upstream has no adhesive at all and a fin fillet
 * is made of nothing else.
 */
describe('adhesive materials', () => {
  it('is every adhesive in the table', () => {
    expect(CATALOG.filter((m) => m.group === 'Adhesives')).toEqual(ADHESIVES);
  });

  it('is all bulk, since a fillet has volume', () => {
    // A surface or line material would be a kg/m^2 or kg/m number rendered as
    // a density, off by orders of magnitude with nothing to show it.
    for (const m of ADHESIVES) expect(m.type).toBe('bulk');
  });

  it('gives every entry a plausible cured density', () => {
    // Loose on purpose: this is a sanity range, not a spec. Unfilled epoxy sits
    // near 1100, steel-filled J-B Weld near 1840, and nothing an adhesive is
    // made of is lighter than water or heavier than aluminum.
    for (const m of ADHESIVES) {
      expect(m.density, m.name).toBeGreaterThan(900);
      expect(m.density, m.name).toBeLessThan(2500);
    }
  });
});

/**
 * A tripwire, not the check.
 *
 * The real one is `engine-java/extract/extract.mjs --check`, which reads
 * upstream's `Databases.java` out of the pinned source and compares it to this
 * catalog entry by entry. It cannot run from here: the extraction replaces
 * `Databases.java` with a shim, so no committed file in this repo carries
 * upstream's list to compare against.
 *
 * These counts stand in for it in the fast suite. They caught nothing on the
 * way in — the drift they describe was found by running that comparison by
 * hand — but a deletion is the easy way to break this file, and a deletion
 * moves a count.
 */
describe('upstream material counts', () => {
  const countOf = (type: string) => UPSTREAM.filter((m) => m.type === type).length;

  it('carries all 42 of upstream line materials', () => {
    // It carried 20 for a while: every Kevlar 12-strand above 5/16 in, all five
    // nylon flat webbings, both rubber bands, all seven braided elastics and
    // the Paraline were missing, which is most of what a shock cord or a set of
    // shroud lines is made of.
    expect(countOf('line')).toBe(42);
  });

  it('carries all 32 bulk and 8 surface materials', () => {
    expect(countOf('bulk')).toBe(32);
    expect(countOf('surface')).toBe(8);
  });
});

/**
 * Upstream's flat elastic cords read 0.0018, 0.0043 and 0.008 for 2, 6 and
 * 12 mm, then 0.0012 for 19 mm and 0.0016 for 25 mm — the two widest lighter
 * than the 6 mm, by a factor of ten. It is a dropped digit, and it makes a 3 m
 * shock cord of 3/4 in flat elastic read 3.6 g instead of about 37.
 *
 * The wrong entries stay: a design that names one has to keep reading back the
 * density it was saved with. The corrected ones sit beside them.
 */
describe('corrected materials', () => {
  it("keeps upstream's wrong elastic cords, wrong", () => {
    expect(CATALOG.find((m) => m.name === 'Elastic cord (flat 19 mm, 3/4 in)')?.density).toBe(0.0012);
  });

  it('offers a corrected one that is heavier than the narrower cord', () => {
    const twelve = CATALOG.find((m) => m.name === 'Elastic cord (flat 12 mm, 1/2 in)')!;
    for (const m of CORRECTED) expect(m.density).toBeGreaterThan(twelve.density);
  });

  it('is line material', () => {
    for (const m of CORRECTED) expect(m.type).toBe('line');
  });
});

/**
 * The hand-maintained input. Nothing regenerates over it, so what keeps it
 * honest is that an entry has to say where its number came from.
 */
describe('the app material file', () => {
  it('cites a source and a note for every entry', () => {
    // A density with no document behind it is a guess that weighs someone's
    // rocket, and nothing downstream can tell the difference.
    for (const r of APP) {
      expect(r.source, `${r.name} has no source`).toBeTruthy();
      expect(r.note, `${r.name} has no note`).toBeTruthy();
    }
  });

  it('names the upstream entry each correction replaces, and that entry exists', () => {
    for (const r of APP.filter((x) => x.kind === 'corrected')) {
      expect(r.corrects, `${r.name} does not say what it corrects`).toBeTruthy();
      expect(UPSTREAM.some((m) => m.name === r.corrects)).toBe(true);
    }
  });

  it('uses only kinds the sync script knows', () => {
    for (const r of APP) expect(['adhesive', 'corrected']).toContain(r.kind);
  });

  it('reaches the catalog entry for entry', () => {
    // The merge is what makes the file worth editing; a sync script that
    // dropped it would leave the fillet picker with nothing in it.
    for (const r of APP) {
      expect(CATALOG, r.name).toContainEqual({
        name: r.name,
        type: r.type,
        density: r.density,
        group: r.group,
        kind: r.kind,
      });
    }
  });
});
