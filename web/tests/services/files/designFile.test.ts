// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { parseDesignFile, sniffDesignFormat } from '../../../src/services/files/designFile';

/**
 * The format dispatch, which is the one place a `.rkt` and a `.ork` meet.
 *
 * It reads bytes, not file names, so that a design renamed on its way through
 * somebody's email still opens and so the loader keeps one path for both
 * formats. The cases that matter are the ambiguous ones: a `.ork` that mentions
 * RockSim in its text (materials named "RockSim …" are common in files that
 * came from there originally) must not be mistaken for one.
 */

const RKT = `<?xml version="1.0"?>
<RockSimDocument><FileVersion>4</FileVersion><DesignInformation><RocketDesign>
  <Name>Sniffed</Name><StageCount>1</StageCount>
  <Stage3Parts><BodyTube><Name>Tube</Name><Len>200</Len><OD>24.8</OD><ID>24</ID></BodyTube></Stage3Parts>
</RocketDesign></DesignInformation></RockSimDocument>`;

const ORK = `<?xml version='1.0' encoding='utf-8'?>
<openrocket version="1.10" creator="test">
  <rocket><name>Sniffed ork</name><subcomponents><stage><name>Sustainer</name><subcomponents>
    <bodytube><name>Tube</name><length>0.2</length><radius>0.0124</radius><thickness>0.0004</thickness></bodytube>
  </subcomponents></stage></subcomponents></rocket>
</openrocket>`;

const bytes = (s: string): ArrayBuffer => {
  const u = new TextEncoder().encode(s);
  return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
};

describe('sniffDesignFormat', () => {
  it('reads a RockSim document from its root element', () => {
    expect(sniffDesignFormat(RKT)).toBe('rkt');
    expect(sniffDesignFormat(bytes(RKT))).toBe('rkt');
  });

  it('reads an OpenRocket document from its root element', () => {
    expect(sniffDesignFormat(ORK)).toBe('ork');
    expect(sniffDesignFormat(bytes(ORK))).toBe('ork');
  });

  it('treats any zip as a .ork, because RockSim does not archive its files', () => {
    const zip = zipSync({ 'rocket.ork': strToU8(ORK) });
    expect(sniffDesignFormat(zip.buffer.slice(0) as ArrayBuffer)).toBe('ork');
  });

  it('is not fooled by the word RockSim inside a .ork', () => {
    // Material names carried over from RockSim are common in real files; the
    // sniff looks for the tag, so a mention in the text must not win.
    const ork = ORK.replace('<name>Tube</name>', '<name>Tube</name><material>RockSim Kraft phenolic</material>');
    expect(sniffDesignFormat(ork)).toBe('ork');
  });

  /**
   * A Windows tool writes UTF-16 readily, and the file is perfectly valid XML.
   * Read as UTF-8 it is the right characters with a NUL between each one, so it
   * would match neither root element and be turned away as not a design file at
   * all, though it opens fine everywhere else.
   */
  describe('a file written in UTF-16', () => {
    /** The string as UTF-16 bytes, with or without a byte order mark. */
    const utf16 = (text: string, { be = false, bom = true } = {}): ArrayBuffer => {
      const u = new Uint8Array((text.length + (bom ? 1 : 0)) * 2);
      const view = new DataView(u.buffer);
      let i = 0;
      if (bom) view.setUint16(i++ * 2, 0xfeff, !be);
      for (const ch of text) view.setUint16(i++ * 2, ch.charCodeAt(0), !be);
      return u.buffer;
    };

    it('reads a little-endian RockSim document', () => {
      expect(sniffDesignFormat(utf16(RKT))).toBe('rkt');
      expect(parseDesignFile(utf16(RKT)).name).toBe('Sniffed');
    });

    it('reads a big-endian OpenRocket document', () => {
      expect(sniffDesignFormat(utf16(ORK, { be: true }))).toBe('ork');
      expect(parseDesignFile(utf16(ORK, { be: true })).name).toBe('Sniffed ork');
    });

    it('reads one with no byte order mark, from the shape of its first tag', () => {
      // `<` is 3C 00 one way round and 00 3C the other, and no UTF-8 text has a
      // NUL in its first two bytes.
      expect(sniffDesignFormat(utf16(ORK, { bom: false }))).toBe('ork');
      expect(sniffDesignFormat(utf16(RKT, { be: true, bom: false }))).toBe('rkt');
    });

    it('still reads plain UTF-8, mark or no mark', () => {
      const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(ORK)]);
      expect(sniffDesignFormat(withBom.buffer.slice(0) as ArrayBuffer)).toBe('ork');
      expect(sniffDesignFormat(bytes(ORK))).toBe('ork');
    });
  });

  it('says nothing for a file that is neither', () => {
    expect(sniffDesignFormat('<html><body>nope</body></html>')).toBeNull();
    expect(sniffDesignFormat('')).toBeNull();
  });
});

describe('parseDesignFile', () => {
  it('routes each format to its own reader', () => {
    expect(parseDesignFile(RKT).name).toBe('Sniffed');
    expect(parseDesignFile(ORK).name).toBe('Sniffed ork');
  });

  it('gives both readers the same result shape', () => {
    // `loadOrk` works off this shape for either format, so a `.rkt` has to
    // arrive with the config table present and empty rather than missing.
    const r = parseDesignFile(RKT);
    expect(r.configs).toEqual([]);
    expect(r.chosenConfigId).toBeNull();
    expect(r.motors).toEqual({});
  });

  it('names both formats when handed something else', () => {
    // Rather than "missing <rocket>", which is a confusing thing to be told
    // after picking a RockSim file.
    expect(() => parseDesignFile('<html/>')).toThrow(/OpenRocket \(\.ork\) or RockSim \(\.rkt\)/);
  });
});
