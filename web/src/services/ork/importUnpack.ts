import { unzipSync, strFromU8 } from 'fflate';
import { MAX_ARCHIVE_ENTRIES, MAX_ARCHIVE_ENTRY_BYTES, MAX_ARCHIVE_TOTAL_BYTES } from './importLimits';

/**
 * Getting from the bytes of a `.ork` to a parsed document: a zip holding the
 * XML, or bare XML, either as a string or a buffer.
 */

/** The XML text inside a `.ork`: the archive's `.ork` member, or the bare file. */
export function unpackOrkXml(data: ArrayBuffer | string): string {
  if (typeof data === 'string') return data;
  const bytes = new Uint8Array(data);
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    // Zip-bomb guard: a `.ork` is a zip, and fflate's unzipSync has no built-in
    // cap — a crafted archive (huge declared size, or millions of entries)
    // would OOM the tab. The `filter` runs per member BEFORE it inflates,
    // carrying the declared uncompressed `originalSize`, so we reject there.
    let entryCount = 0;
    let totalSize = 0;
    const entries = unzipSync(bytes, {
      filter: (file) => {
        if (++entryCount > MAX_ARCHIVE_ENTRIES) throw new Error('.ork archive has too many entries');
        totalSize += file.originalSize;
        if (file.originalSize > MAX_ARCHIVE_ENTRY_BYTES || totalSize > MAX_ARCHIVE_TOTAL_BYTES) {
          throw new Error('.ork archive is too large (possible zip bomb)');
        }
        return true;
      },
    });
    const entryName = Object.keys(entries).find((n) => n.endsWith('.ork')) ?? Object.keys(entries)[0];
    if (!entryName) throw new Error('Empty .ork archive');
    return strFromU8(entries[entryName]!);
  }
  return strFromU8(bytes);
}

/** The parsed document, or an error naming what is wrong with the text. */
export function parseOrkXml(xml: string): Document {
  // OpenRocket writes a single-quoted XML declaration; some parsers reject it.
  if (xml.charCodeAt(0) === 0xfeff) xml = xml.slice(1); // strip optional BOM
  xml = xml.replace(/^\s*<\?xml[^?]*\?>/, '');
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  if (doc.querySelector('parsererror')) {
    throw new Error('Not a valid .ork file (XML parse error)');
  }
  return doc;
}
