import { MAX_ARCHIVE_ENTRY_BYTES } from './ork/importLimits';

/**
 * The largest imported file the app decodes, the same ceiling a zipped `.ork`
 * member is held to. DOMParser and the line splitters run on the main thread,
 * so a multi-hundred-MB design or motor file would freeze the tab.
 */
export const MAX_IMPORT_FILE_BYTES = MAX_ARCHIVE_ENTRY_BYTES;

/** Throws when an imported file is over {@link MAX_IMPORT_FILE_BYTES}. */
export function assertImportSize(size: number): void {
  if (size > MAX_IMPORT_FILE_BYTES) {
    throw new Error(`File is too large to open (over ${MAX_IMPORT_FILE_BYTES / (1024 * 1024)} MiB).`);
  }
}

/**
 * An imported file's bytes as text, in whatever encoding it was written in.
 *
 * Every design format the app reads is XML, and `new TextDecoder()` alone reads
 * all of them as UTF-8. A UTF-16 file then comes out as the right characters
 * with a NUL between each one, which is not XML and not RockSim and not
 * OpenRocket, so the file would be refused as "not a rocket design file".
 * Windows tools write UTF-16 readily, and the file is valid.
 *
 * A UTF-8 byte order mark needs nothing here: `TextDecoder` removes one unless
 * it is told not to.
 */
function encodingOf(bytes: Uint8Array): string {
  if (bytes.length >= 2) {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le';
    if (bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be';
    // No mark. An XML file still begins with '<', which is 3C 00 one way round
    // and 00 3C the other, and no UTF-8 text has a NUL in its first two bytes.
    if (bytes[0] === 0x3c && bytes[1] === 0x00) return 'utf-16le';
    if (bytes[0] === 0x00 && bytes[1] === 0x3c) return 'utf-16be';
  }
  return 'utf-8';
}

/** Decode an imported file, honoring a UTF-16 mark or shape. */
export function decodeFileText(bytes: Uint8Array): string {
  assertImportSize(bytes.byteLength);
  return new TextDecoder(encodingOf(bytes)).decode(bytes);
}

/**
 * A picked file as text, through {@link decodeFileText}. `File.text()` reads
 * UTF-8 only, so a UTF-16 motor, wind or template file imported by hand would
 * be refused while the same bytes inside an `.ork` open; every hand import
 * reads through this instead.
 */
export async function readFileText(file: Blob): Promise<string> {
  assertImportSize(file.size);
  return decodeFileText(new Uint8Array(await file.arrayBuffer()));
}
