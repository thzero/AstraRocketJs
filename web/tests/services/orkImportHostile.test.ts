// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { importOrk } from '../../src/services/orkFile';

/**
 * The untrusted-input parser, exercised with untrusted input.
 *
 * `orkImport` is ~1000 lines and the only thing in the app that parses a file
 * a stranger can hand you. It was covered only indirectly, by round-trip and
 * shape tests through `orkFile`, so the guards that exist specifically for
 * hostile input - the zip-bomb caps and the nesting-depth limit - had nothing
 * exercising them at all. A cap nobody has watched trip is a cap nobody knows
 * still works.
 */

/** A .ork is a zip whose `rocket.ork` entry is the XML. */
const ork = (xml: string): ArrayBuffer => {
  const zipped = zipSync({ 'rocket.ork': strToU8(xml) });
  return zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer;
};

/**
 * The same archive, with its central-directory entry claiming to inflate to
 * `bytes`. That field (offset 24 of the `PK` record) is what fflate
 * reports as `originalSize` and what the zip-bomb guard checks.
 */
const declaringSize = (zip: ArrayBuffer, bytes: number): ArrayBuffer => {
  const out = new Uint8Array(zip.slice(0));
  for (let i = 0; i + 28 <= out.length; i++) {
    if (out[i] === 0x50 && out[i + 1] === 0x4b && out[i + 2] === 0x01 && out[i + 3] === 0x02) {
      new DataView(out.buffer).setUint32(i + 24, bytes, true);
      return out.buffer;
    }
  }
  throw new Error('no central directory entry in the test archive');
};

const wrap = (inner: string) =>
  `<?xml version="1.0"?><openrocket version="1.8"><rocket><name>T</name><subcomponents><stage><name>S</name><subcomponents>${inner}</subcomponents></stage></subcomponents></rocket></openrocket>`;

describe('a well-formed .ork still imports', () => {
  it('reads a minimal rocket', () => {
    const res = importOrk(
      ork(wrap('<bodytube><name>Body</name><length>0.3</length><radius>0.012</radius></bodytube>')),
    );
    expect(res.tree.components.length).toBeGreaterThan(0);
  });
});

describe('malformed input fails cleanly rather than crashing', () => {
  it('rejects something that is not a zip at all', () => {
    expect(() => importOrk(strToU8('not a zip').buffer as ArrayBuffer)).toThrow();
  });

  it('rejects a zip with no rocket document', () => {
    const zipped = zipSync({ 'readme.txt': strToU8('hello') });
    const buf = zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer;
    expect(() => importOrk(buf as ArrayBuffer)).toThrow();
  });

  it('rejects XML that is not a rocket', () => {
    expect(() => importOrk(ork('<?xml version="1.0"?><spreadsheet/>'))).toThrow();
  });

  it('rejects truncated XML', () => {
    expect(() => importOrk(ork('<?xml version="1.0"?><openrocket><rocket><name>T'))).toThrow();
  });
});

describe('the hostile-input caps actually fire', () => {
  /**
   * Deep `<subcomponents>` nesting is the stack-overflow vector: the parser
   * recurses per level, so without a depth cap a crafted file exhausts the JS
   * stack with an opaque RangeError. MAX_NESTING_DEPTH is 100; nothing had
   * ever tripped it.
   */
  it('refuses nesting past MAX_NESTING_DEPTH with a clear error', () => {
    const depth = 150; // over the cap of 100, but cheap for the XML parser
    const open = '<subcomponents><bodytube><name>b</name><length>0.1</length><radius>0.01</radius>'.repeat(depth);
    const close = '</bodytube></subcomponents>'.repeat(depth);
    const xml = `<?xml version="1.0"?><openrocket version="1.8"><rocket><name>T</name><subcomponents><stage><name>S</name>${open}${close}</stage></subcomponents></rocket></openrocket>`;
    expect(() => importOrk(ork(xml))).toThrow(/nest|deep/i);
  });

  it('still accepts nesting a real design could plausibly use', () => {
    const depth = 8;
    const open = '<subcomponents><bodytube><name>b</name><length>0.1</length><radius>0.01</radius>'.repeat(depth);
    const close = '</bodytube></subcomponents>'.repeat(depth);
    const xml = `<?xml version="1.0"?><openrocket version="1.8"><rocket><name>T</name><subcomponents><stage><name>S</name>${open}${close}</stage></subcomponents></rocket></openrocket>`;
    expect(() => importOrk(ork(xml))).not.toThrow();
  });

  /**
   * The zip-bomb cap. fflate has no built-in limit, so `orkImport` filters on
   * the central directory's declared size before inflating. A lying declared
   * size truncates to a clean parse error rather than exhausting memory.
   */
  it('refuses an entry that declares more than the cap', () => {
    // Over MAX_ARCHIVE_ENTRY_BYTES (64 MiB). The guard reads the size the
    // central directory DECLARES, before inflating anything, so the test
    // forges that field on a tiny archive rather than deflating 65 MiB of
    // filler: the old version did the latter and took eight seconds on the CI
    // runner, past vitest's five-second ceiling. An earlier 60 MiB was UNDER
    // the cap, and a bare `.toThrow()` was satisfied by the parse failing on
    // the filler, not by the guard. Naming the message is what makes this a
    // test of the cap; forging the size is what makes it a test of THIS zip
    // bomb, the one that lies about how big it will inflate to.
    const small = ork('<openrocket><rocket/></openrocket>');
    expect(() => importOrk(declaringSize(small, 65 * 1024 * 1024))).toThrow(
      '.ork archive is too large (possible zip bomb)',
    );
  });

  /**
   * The declared-configuration cap. `captureDeployments` and `configScoped`
   * each re-scan a component's children once PER CONFIG, so the import is
   * O(configs x components) on the main thread. A ~500 KB file declaring tens
   * of thousands of configurations against a few thousand components freezes
   * the tab - no crash, no error, just a dead UI. This is the cap added last
   * and the one nothing had watched trip.
   */
  it('caps declared motor configurations at MAX_MOTOR_CONFIGS', () => {
    const configs = Array.from(
      { length: 400 }, // over the cap of 256
      (_, i) => `<motorconfiguration configid="c${i}"><name>C${i}</name></motorconfiguration>`,
    ).join('');
    const xml =
      `<?xml version="1.0"?><openrocket version="1.8"><rocket><name>T</name>${configs}` +
      `<subcomponents><stage><name>S</name><subcomponents>` +
      `<bodytube><name>Body</name><length>0.3</length><radius>0.012</radius></bodytube>` +
      `</subcomponents></stage></subcomponents></rocket></openrocket>`;
    const res = importOrk(ork(xml));
    expect(res.configs).toHaveLength(256);
    // Capped from the FRONT, in file order, so the chosen config is a real one.
    expect(res.configs[0]!.id).toBe('c0');
    expect(res.configs.at(-1)!.id).toBe('c255');
    expect(res.configs.some((c) => c.id === res.chosenConfigId)).toBe(true);
  });

  it('keeps every configuration of a file that stays under the cap', () => {
    const configs = Array.from(
      { length: 12 }, // what a real multi-motor design looks like
      (_, i) => `<motorconfiguration configid="c${i}"><name>C${i}</name></motorconfiguration>`,
    ).join('');
    const xml =
      `<?xml version="1.0"?><openrocket version="1.8"><rocket><name>T</name>${configs}` +
      `<subcomponents><stage><name>S</name><subcomponents>` +
      `<bodytube><name>Body</name><length>0.3</length><radius>0.012</radius></bodytube>` +
      `</subcomponents></stage></subcomponents></rocket></openrocket>`;
    expect(importOrk(ork(xml)).configs).toHaveLength(12);
  });

  it('refuses a zip with more entries than the cap allows', () => {
    const entries: Record<string, Uint8Array> = {};
    for (let i = 0; i < 300; i++) entries[`f${i}.txt`] = strToU8('x'); // cap is 256
    const zipped = zipSync(entries);
    const buf = zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer;
    // The archive holds no rocket document, so a bare `.toThrow()` passed with
    // the cap removed too ("Empty .ork archive"). It has to be the cap's error.
    expect(() => importOrk(buf as ArrayBuffer)).toThrow('.ork archive has too many entries');
  });
});

/**
 * File-sourced COUNTS are bounded to what the domain can mean. Every consumer
 * loops on these (a mesh per fin, a shape per instance, a vertex per point,
 * a line's mass per line), so an unbounded count out of a crafted file is a
 * frozen tab rather than a large rocket. Nothing clamped them on the way in.
 */
describe('file-sourced counts are clamped to domain ceilings', () => {
  const inTube = (inner: string) =>
    wrap(
      `<bodytube><name>Body</name><length>0.3</length><radius>0.012</radius><subcomponents>${inner}</subcomponents></bodytube>`,
    );
  const first = (xml: string, type: string) => {
    const walk = (ns: { type: string; children?: unknown[] }[]): Record<string, unknown> | undefined => {
      for (const n of ns) {
        if (n.type === type) return n as Record<string, unknown>;
        const hit = walk((n.children ?? []) as { type: string; children?: unknown[] }[]);
        if (hit) return hit;
      }
      return undefined;
    };
    return walk(importOrk(ork(xml)).tree.components as never)!;
  };

  it('caps a fin count at 64 and floors it at 1', () => {
    const fins = (n: string) =>
      `<trapezoidfinset><name>F</name><fincount>${n}</fincount><rootchord>0.05</rootchord><height>0.03</height></trapezoidfinset>`;
    expect(first(inTube(fins('100000')), 'trapezoidfinset').finCount).toBe(64);
    expect(first(inTube(fins('0')), 'trapezoidfinset').finCount).toBe(1);
    expect(first(inTube(fins('-7')), 'trapezoidfinset').finCount).toBe(1);
    expect(first(inTube(fins('Infinity')), 'trapezoidfinset').finCount).toBe(3); // non-finite: the default
    expect(first(inTube(fins('4')), 'trapezoidfinset').finCount).toBe(4);
    const tubes = `<tubefinset><name>T</name><fincount>9999</fincount><length>0.1</length></tubefinset>`;
    expect(first(inTube(tubes), 'tubefinset').finCount).toBe(64);
  });

  it('caps an instance count at 1000 on rings, lugs and assemblies', () => {
    const ring = `<centeringring><name>R</name><instancecount>1000000</instancecount><length>0.002</length></centeringring>`;
    expect(first(inTube(ring), 'centeringring').instanceCount).toBe(1000);
    const lug = `<launchlug><name>L</name><instancecount>5000</instancecount><length>0.03</length></launchlug>`;
    expect(first(inTube(lug), 'launchlug').instanceCount).toBe(1000);
    const pod =
      `<podset><name>P</name><instancecount>1e12</instancecount><subcomponents>` +
      `<bodytube><length>0.1</length><radius>0.005</radius></bodytube></subcomponents></podset>`;
    expect(first(inTube(pod), 'podset').instanceCount).toBe(1000);
  });

  /**
   * Twice the cap, which is about a megabyte of XML, and the 5 s default does
   * not fit it on a loaded machine.
   *
   * The time is jsdom's DOMParser, not the cap: measured idle, the import runs
   * 133 / 279 / 430 / 698 / 1508 ms at 5k / 10k / 20k / 40k / 80k points -
   * linear, so the sibling walk in `ork/importReaders.ts` is stopping at
   * MAX_FIN_POINTS exactly as its comment claims. 430 ms idle has still been
   * seen past 5 s with the rest of the suite running beside it.
   *
   * Scoped to this ONE case rather than the file or the config: the other
   * fourteen here are milliseconds and have no business taking seconds.
   */
  it('caps a freeform outline at 10000 points', () => {
    const n = 20_000;
    const pts = Array.from({ length: n }, (_, i) => `<point x="${(i / n) * 0.06}" y="${i % 2 ? 0.03 : 0.0}"/>`).join(
      '',
    );
    const fin = `<freeformfinset><name>F</name><fincount>3</fincount><finpoints>${pts}</finpoints></freeformfinset>`;
    expect((first(inTube(fin), 'freeformfinset').points as unknown[]).length).toBe(10_000);
  }, 30_000);

  it('caps a parachute line count at 100', () => {
    const chute = `<parachute><name>C</name><diameter>0.3</diameter><linecount>100000</linecount></parachute>`;
    expect(first(inTube(chute), 'parachute').lineCount).toBe(100);
    const none = `<parachute><name>C</name><diameter>0.3</diameter><linecount>0</linecount></parachute>`;
    expect(first(inTube(none), 'parachute').lineCount).toBe(1);
  });
});
