import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * A `.ork` archive is refused once it inflates past the caps, and the refusal
 * comes while it is inflating, not after.
 *
 * fflate inflates whatever it is handed before it reports any output, so a cap
 * checked on the output alone runs only after the whole member is in memory,
 * and a member's declared size says nothing about what it inflates to. The caps
 * are made small here so the bombs stay small, and every byte fflate's
 * inflaters deliver is counted. A DEFLATE stream expands at most about 1032:1,
 * so a reader that feeds its input in pieces of a kilobyte or so has delivered
 * at most about a megabyte past the cap when it stops; a reader that hands over
 * the whole member delivers all of it.
 */
const CAP = 1024 * 1024;
/** What one kilobyte-scale piece of input can add past the cap before the count stops it, with room to spare. */
const OVERSHOOT = 2 * 1024 * 1024;

const delivered = vi.hoisted(() => ({ bytes: 0 }));

vi.mock('../../../src/services/files/ork/importLimits', async (orig) => ({
  ...(await orig<typeof import('../../../src/services/files/ork/importLimits')>()),
  MAX_ARCHIVE_ENTRY_BYTES: 1024 * 1024,
  MAX_ARCHIVE_TOTAL_BYTES: 2 * 1024 * 1024,
}));

vi.mock('fflate', async (orig) => {
  const real = await orig<typeof import('fflate')>();
  type Handler = (data: Uint8Array, final: boolean) => void;
  class Gunzip extends real.Gunzip {
    constructor(cb: Handler) {
      super((data, final) => {
        delivered.bytes += data.length;
        cb(data, final);
      });
    }
  }
  class Inflate extends real.Inflate {
    constructor(cb: Handler) {
      super((data, final) => {
        delivered.bytes += data.length;
        cb(data, final);
      });
    }
  }
  return { ...real, Gunzip, Inflate };
});

import { Zip, ZipDeflate, deflateSync, gzipSync, strToU8, zipSync } from 'fflate';
import { unpackOrk } from '../../../src/services/files/ork/importUnpack';

const zeros = (bytes: number) => new Uint8Array(bytes);

/** The error `unpackOrk` throws for `data`, by its key. */
function refusal(data: Uint8Array): string | undefined {
  try {
    unpackOrk(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer);
  } catch (e) {
    return (e as { key?: string }).key ?? String(e);
  }
  return undefined;
}

/** The zip with every declared uncompressed size, local and central, set to `bytes`. */
function declaring(zip: Uint8Array, bytes: number): Uint8Array {
  const out = zip.slice();
  const view = new DataView(out.buffer);
  for (let i = 0; i + 4 <= out.length; i++) {
    const sig = view.getUint32(i, true);
    if (sig === 0x04034b50) view.setUint32(i + 22, bytes, true);
    if (sig === 0x02014b50) view.setUint32(i + 24, bytes, true);
  }
  return out;
}

beforeEach(() => {
  delivered.bytes = 0;
});

describe('.ork archive caps', () => {
  it('stops a gzipped file while it inflates', () => {
    expect(refusal(gzipSync(zeros(16 * CAP)))).toBe('errors.file.archiveTooLarge');
    // Past the cap, so the count saw the output it stopped on.
    expect(delivered.bytes).toBeGreaterThan(CAP);
    expect(delivered.bytes).toBeLessThanOrEqual(CAP + OVERSHOOT);
  });

  it('stops a zip member that declares a few bytes and inflates to many', () => {
    const bomb = declaring(zipSync({ 'rocket.ork': zeros(16 * CAP) }, { level: 9 }), 1000);
    expect(refusal(bomb)).toBe('errors.file.archiveTooLarge');
    expect(delivered.bytes).toBeGreaterThan(CAP);
    expect(delivered.bytes).toBeLessThanOrEqual(CAP + OVERSHOOT);
  });

  /**
   * A stream that takes in input and produces nothing: fflate keeps that input
   * and copies all of it again on every push, so the cost grows with the square
   * of its length and no output cap ever fires. A valid stream never holds back
   * more than a stored block's 64 KiB, so 256 KiB of it is refused.
   */
  it('refuses a gzip header that never ends', () => {
    const header = new Uint8Array([0x1f, 0x8b, 8, 0x08, 0, 0, 0, 0, 0, 3]); // FNAME set
    const name = new Uint8Array(256 * 1024).fill(0x61); // and never terminated
    const file = new Uint8Array(header.length + name.length);
    file.set(header);
    file.set(name, header.length);
    expect(refusal(file)).toBe('errors.file.archiveCorrupt');
  });

  it('refuses a zip member that runs on past the end of its data', () => {
    const data = new Uint8Array([...deflateSync(strToU8('<openrocket/>')), ...zeros(256 * 1024)]);
    const name = strToU8('rocket.ork');
    const local = new Uint8Array(30 + name.length);
    const view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(8, 8, true); // deflate
    view.setUint32(18, data.length, true); // compressed size, the trailing bytes included
    view.setUint32(22, 13, true);
    view.setUint16(26, name.length, true);
    local.set(name, 30);
    const archive = new Uint8Array(local.length + data.length);
    archive.set(local);
    archive.set(data, local.length);
    expect(refusal(archive)).toBe('errors.file.archiveCorrupt');
  });

  /**
   * Each gzip member costs a fresh inflater however little it holds, so a file
   * of many one-byte members takes minutes while no byte cap comes near.
   * OpenRocket writes a gzipped `.ork` as one member.
   */
  it('refuses a gzipped file of many members', () => {
    const member = gzipSync(strToU8('a'));
    const file = new Uint8Array(member.length * 1000);
    for (let i = 0; i < 1000; i++) file.set(member, i * member.length);
    expect(refusal(file)).toBe('errors.file.archiveTooManyEntries');
  });

  it('opens a gzipped file of as many members as the limit allows, as one text', () => {
    const parts = ['<openrocket>', '<rocket/>', '</open', 'rocket>'].map((t) => gzipSync(strToU8(t)));
    const file = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) {
      file.set(p, at);
      at += p.length;
    }
    expect(unpackOrk(file.buffer).xml).toBe('<openrocket><rocket/></openrocket>');
  });

  it('counts a stored member by what it holds', () => {
    const stored = declaring(zipSync({ 'rocket.ork': zeros(CAP + 1) }, { level: 0 }), 10);
    expect(refusal(stored)).toBe('errors.file.archiveTooLarge');
  });

  it('counts every member toward the total', () => {
    // Three members under the 1 MiB member cap, together over the 2 MiB total.

    const third = Math.floor(0.9 * CAP);
    const many = zipSync({ 'rocket.ork': zeros(third), 'a.rse': zeros(third), 'b.rse': zeros(third) });
    expect(refusal(many)).toBe('errors.file.archiveTooLarge');
  });

  /**
   * Desktop writes a `.ork` through Java's ZipOutputStream, which states a
   * deflated member's sizes in a data descriptor after its data (general
   * purpose flag bit 3), not in the local header the reader starts from.
   * fflate's streaming Zip writes members the same way.
   */
  it('opens members whose sizes follow their data, as desktop writes them', () => {
    const xml = '<openrocket><rocket><name>Desktop</name></rocket></openrocket>';
    const parts: Uint8Array[] = [];
    const zip = new Zip((err, data) => {
      if (err) throw err;
      parts.push(data);
    });
    const member = new ZipDeflate('rocket.ork', { level: 6 });
    zip.add(member);
    member.push(strToU8(xml), true);
    zip.end();
    const bytes = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) {
      bytes.set(p, at);
      at += p.length;
    }
    expect(new DataView(bytes.buffer).getUint16(6, true) & 8).toBe(8);
    expect(unpackOrk(bytes.buffer).xml).toBe(xml);
  });

  /**
   * A data descriptor may leave out its signature (APPNOTE 4.3.9.3).
   * `ZipInputStream.readEnd` reads a first word that is not the signature as
   * the CRC, so desktop 24.12 opens such a `.ork`; fflate's streaming reader
   * loses its place at the member's end, and the archive is read through its
   * central directory instead.
   */
  /** The CRC-32 a zip states for a member's uncompressed bytes. */
  const crc32 = (data: Uint8Array): number => {
    let c = ~0;
    for (const byte of data) {
      c ^= byte;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    return ~c >>> 0;
  };
  const unsigned = (members: Record<string, Uint8Array>): Uint8Array => {
    const parts: Uint8Array[] = [];
    const directory: Uint8Array[] = [];
    let offset = 0;
    for (const [name, raw] of Object.entries(members)) {
      const n = strToU8(name);
      const data = deflateSync(raw);
      const crc = crc32(raw);
      const local = new Uint8Array(30 + n.length);
      const lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true);
      lv.setUint16(6, 8, true); // sizes in a data descriptor
      lv.setUint16(8, 8, true); // deflate
      lv.setUint16(26, n.length, true);
      local.set(n, 30);
      const descriptor = new Uint8Array(12); // CRC and sizes, no signature
      const dv = new DataView(descriptor.buffer);
      dv.setUint32(0, crc, true);
      dv.setUint32(4, data.length, true);
      dv.setUint32(8, raw.length, true);
      const central = new Uint8Array(46 + n.length);
      const cv = new DataView(central.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 8, true);
      cv.setUint16(10, 8, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, data.length, true);
      cv.setUint32(24, raw.length, true);
      cv.setUint16(28, n.length, true);
      cv.setUint32(42, offset, true);
      central.set(n, 46);
      parts.push(local, data, descriptor);
      directory.push(central);
      offset += local.length + data.length + descriptor.length;
    }
    const size = directory.reduce((t, c) => t + c.length, 0);
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, directory.length, true);
    ev.setUint16(10, directory.length, true);
    ev.setUint32(12, size, true);
    ev.setUint32(16, offset, true);
    const all = [...parts, ...directory, end];
    const out = new Uint8Array(all.reduce((t, p) => t + p.length, 0));
    let at = 0;
    for (const p of all) {
      out.set(p, at);
      at += p.length;
    }
    return out;
  };

  it('opens members whose data descriptors leave out the signature, as ZipInputStream does', () => {
    const xml = '<openrocket><rocket><name>Streamed</name></rocket></openrocket>';
    const curve = '<engine-database></engine-database>';
    const archive = unpackOrk(
      unsigned({ 'rocket.ork': strToU8(xml), 'thrustcurves/x.rse': strToU8(curve) }).buffer as ArrayBuffer,
    );
    expect(archive.xml).toBe(xml);
    expect(archive.motorFiles).toEqual([curve]);
  });

  it('holds such an archive to the same caps', () => {
    expect(refusal(unsigned({ 'rocket.ork': zeros(16 * CAP) }))).toBe('errors.file.archiveTooLarge');
    expect(delivered.bytes).toBeLessThanOrEqual(CAP + OVERSHOOT);
    // Each member under the member cap, so the streaming read loses its place
    // at the first one's end and the directory read meets the total cap.
    const third = Math.floor(0.9 * CAP);
    expect(refusal(unsigned({ 'rocket.ork': zeros(third), 'a.rse': zeros(third), 'b.rse': zeros(third) }))).toBe(
      'errors.file.archiveTooLarge',
    );
  });

  it('opens an archive inside the caps, every member whole', () => {
    const xml = '<openrocket><rocket/></openrocket>';
    const curve = '<engine-database></engine-database>';
    const archive = unpackOrk(
      zipSync({ 'rocket.ork': strToU8(xml), 'thrustcurves/x.rse': strToU8(curve), 'decals/d.png': zeros(10) })
        .buffer as ArrayBuffer,
    );
    expect(archive.xml).toBe(xml);
    expect(archive.motorFiles).toEqual([curve]);
    expect(archive.dropped).toEqual(['decals/d.png']);
  });
});
