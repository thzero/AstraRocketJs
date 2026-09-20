// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { importOrk } from './orkFile';

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
    // 60 MB of XML: comfortably over any sane .ork and over the cap.
    const huge = '<!--' + 'x'.repeat(60 * 1024 * 1024) + '-->';
    expect(() => importOrk(ork(huge + '<openrocket><rocket/></openrocket>'))).toThrow();
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
    expect(() => importOrk(buf as ArrayBuffer)).toThrow();
  });
});
