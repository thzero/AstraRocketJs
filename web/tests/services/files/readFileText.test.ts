// cspell:ignore Fusée
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { MAX_IMPORT_FILE_BYTES, decodeFileText, readFileText } from '../../../src/services/files/decodeText';

/** UTF-16LE with its byte order mark, as Windows tools write it. */
const utf16le = (s: string): Blob => {
  const bytes = new Uint8Array(2 + s.length * 2);
  bytes[0] = 0xff;
  bytes[1] = 0xfe;
  for (let i = 0; i < s.length; i++) bytes[2 + i * 2] = s.charCodeAt(i);
  return new Blob([bytes]);
};

describe('readFileText', () => {
  it('refuses a file over the import cap without reading it', async () => {
    let read = false;
    const huge = {
      size: MAX_IMPORT_FILE_BYTES + 1,
      arrayBuffer: async () => {
        read = true;
        return new ArrayBuffer(0);
      },
    } as unknown as Blob;
    await expect(readFileText(huge)).rejects.toThrow(/too large/);
    expect(read).toBe(false);
  });

  it('reads a UTF-16 file as its characters, not with a NUL between each', async () => {
    expect(await readFileText(utf16le('; C6 motor'))).toBe('; C6 motor');
  });

  describe('a declared encoding', () => {
    /** The text as single bytes: each char code is one byte, as Latin-1 writes it. */
    const latin1 = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));

    it('reads an ISO-8859-1 file by its declaration, as an XML parser does', () => {
      const bytes = latin1(`<?xml version="1.0" encoding="ISO-8859-1"?><rocket><name>Fusée µ</name></rocket>`);
      expect(decodeFileText(bytes)).toContain('<name>Fusée µ</name>');
    });

    it('reads windows-1252 by its declaration', () => {
      // 0x80 is the euro sign in windows-1252 and a control in Latin-1.
      const bytes = latin1(`<?xml version='1.0' encoding='windows-1252'?><a>\u0080</a>`);
      expect(decodeFileText(bytes)).toContain('<a>€</a>');
    });

    it('stays UTF-8 for a UTF-8 declaration, an unknown label or none', () => {
      const utf8 = new TextEncoder().encode('<a>é</a>');
      for (const head of [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<?xml version="1.0" encoding="x-nonsense"?>',
        '',
      ]) {
        const bytes = new Uint8Array([...new TextEncoder().encode(head), ...utf8]);
        expect(decodeFileText(bytes)).toBe(`${head}<a>é</a>`);
      }
    });

    it('ignores a UTF-16 label on bytes that are not UTF-16', () => {
      const bytes = new TextEncoder().encode('<?xml version="1.0" encoding="UTF-16"?><a>é</a>');
      expect(decodeFileText(bytes)).toContain('<a>é</a>');
    });
  });

  it('is how every hand import reads a file', () => {
    const src = resolve(__dirname, '../../../src');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) {
          if (entry !== 'vendor') walk(path);
        } else if (
          /\.tsx?$/.test(entry) &&
          /\bfile\.text\(\)/.test(readFileSync(path, 'utf8').replace(/\/\/.*$/gm, ''))
        ) {
          offenders.push(path.slice(src.length + 1));
        }
      }
    };
    walk(src);
    expect(offenders).toEqual([]);
  });
});
