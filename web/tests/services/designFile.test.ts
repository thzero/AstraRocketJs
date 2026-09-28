// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { parseDesignFile, sniffDesignFormat } from '../../src/services/designFile';

/**
 * The format dispatch, which is the one place a `.rkt` and a `.ork` meet.
 *
 * It reads BYTES, not file names, so that a design renamed on its way through
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
    // sniff looks for the TAG, so a mention in the text must not win.
    const ork = ORK.replace('<name>Tube</name>', '<name>Tube</name><material>RockSim Kraft phenolic</material>');
    expect(sniffDesignFormat(ork)).toBe('ork');
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
