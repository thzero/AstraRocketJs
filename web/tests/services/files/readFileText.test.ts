import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { MAX_IMPORT_FILE_BYTES, readFileText } from '../../../src/services/files/decodeText';

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
