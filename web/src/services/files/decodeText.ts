/**
 * An imported file's bytes as text, in whatever encoding it was written in.
 *
 * Every design format the app reads is XML, and `new TextDecoder()` alone reads
 * all of them as UTF-8. A UTF-16 file then comes out as the right characters
 * with a NUL between each one, which is not XML and not RockSim and not
 * OpenRocket, so the file was refused as "not a rocket design file" rather than
 * opened. Windows tools write UTF-16 readily, and the file is perfectly valid.
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
  return new TextDecoder(encodingOf(bytes)).decode(bytes);
}

/**
 * A picked file as text, through {@link decodeFileText}. `File.text()` reads
 * UTF-8 only, so a UTF-16 motor, wind or template file imported by hand was
 * refused while the same bytes inside an `.ork` opened; every hand import reads
 * through this instead.
 */
export async function readFileText(file: Blob): Promise<string> {
  return decodeFileText(new Uint8Array(await file.arrayBuffer()));
}
