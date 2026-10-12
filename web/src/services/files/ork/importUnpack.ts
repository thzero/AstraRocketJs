import { Gunzip, unzipSync } from 'fflate';
import { decodeFileText } from '../decodeText';
import { parseXmlText } from '../xmlUtil';
import { MAX_ARCHIVE_ENTRIES, MAX_ARCHIVE_ENTRY_BYTES, MAX_ARCHIVE_TOTAL_BYTES } from './importLimits';
import { KeyedError } from '../../../i18n/keyedError';

/**
 * Getting from the bytes of a `.ork` to a parsed document: a zip holding the
 * XML, or bare XML, either as a string or a buffer.
 */

/**
 * What a `.ork` archive holds besides its XML.
 *
 * A `.ork` written by the desktop is a zip of up to four kinds of member: the
 * `rocket.ork` XML, the thrust curve of every motor the design uses, the image
 * behind every decal, and a `preview.png` thumbnail. The curves are read, not just
 * the XML: OpenRocket embeds them precisely so the file opens on an install that
 * does not have them, and without them a design using anything outside our catalog
 * opens with an empty mount and a blocked run.
 */
export type OrkArchive = {
  /** The `rocket.ork` member, or the whole file when it is bare XML. */
  xml: string;
  /** Embedded RockSim thrust curves (`thrustcurves/<digest>.rse`), as text. */
  motorFiles: string[];
  /** Members we kept nothing from, by name, so the import can say so. */
  dropped: string[];
};

/** Whether the bytes start with the gzip signature (`1F 8B`). */
export const isGzip = (bytes: Uint8Array): boolean => bytes[0] === 0x1f && bytes[1] === 0x8b;

/**
 * A gzip stream, inflated with the same cap a zip member gets.
 *
 * Streamed, so the count stops the inflation as soon as it passes the cap:
 * `gunzipSync` has no limit, and a few kilobytes of gzip can declare gigabytes.
 */
function gunzipCapped(bytes: Uint8Array): Uint8Array {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const stream = new Gunzip((chunk) => {
    total += chunk.length;
    if (total > MAX_ARCHIVE_ENTRY_BYTES) throw new KeyedError('errors.file.archiveTooLarge');
    chunks.push(chunk);
  });
  stream.push(bytes, true);
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/**
 * Everything usable in a `.ork`, whether it is a zip, bare XML, or gzipped
 * XML. Older OpenRocket builds saved the gzipped form, and desktop
 * (`GeneralRocketLoader.loadStep1`) checks the gzip signature first and
 * reads what it inflates to; one layer of it, never a gzip inside a gzip.
 */
export function unpackOrk(data: ArrayBuffer | string, gunzipped = false): OrkArchive {
  if (typeof data === 'string') return { xml: data, motorFiles: [], dropped: [] };
  const bytes = new Uint8Array(data);
  if (!gunzipped && isGzip(bytes)) {
    const inner = gunzipCapped(bytes);
    return unpackOrk(inner.buffer.slice(inner.byteOffset, inner.byteOffset + inner.byteLength) as ArrayBuffer, true);
  }
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    // Zip-bomb guard: a `.ork` is a zip, and fflate's unzipSync has no built-in
    // cap: a crafted archive (huge declared size, or millions of entries)
    // would OOM the tab. The `filter` runs per member before it is read, so we
    // reject there. A member costs the larger of its two sizes: a deflated one
    // inflates to its declared `originalSize`, and a stored one (method 0) is
    // copied out at its compressed `size`, whatever `originalSize` claims, and
    // several entries can point at the same stored bytes.
    let entryCount = 0;
    let totalSize = 0;
    const entries = unzipSync(bytes, {
      filter: (file) => {
        if (++entryCount > MAX_ARCHIVE_ENTRIES) throw new KeyedError('errors.file.archiveTooManyEntries');
        const cost = Math.max(file.size, file.originalSize);
        totalSize += cost;
        if (cost > MAX_ARCHIVE_ENTRY_BYTES || totalSize > MAX_ARCHIVE_TOTAL_BYTES) {
          throw new KeyedError('errors.file.archiveTooLarge');
        }
        return true;
      },
    });
    const names = Object.keys(entries);
    const entryName = names.find((n) => n.endsWith('.ork')) ?? names[0];
    if (!entryName) throw new KeyedError('errors.file.archiveEmpty');
    const motorFiles: string[] = [];
    const dropped: string[] = [];
    for (const name of names) {
      if (name === entryName) continue;
      // Any `.rse` in the archive, not just `thrustcurves/` ones: the folder is
      // the desktop's convention, not something the loader depends on.
      if (name.toLowerCase().endsWith('.rse')) motorFiles.push(decodeFileText(entries[name]!));
      // A thumbnail is regenerated on demand by whatever opens the file next, so
      // losing it is not a loss worth reporting.
      else if (name !== 'preview.png') dropped.push(name);
    }
    return { xml: decodeFileText(entries[entryName]!), motorFiles, dropped };
  }
  return { xml: decodeFileText(bytes), motorFiles: [], dropped: [] };
}

/** The parsed document, or an error naming what is wrong with the text. */
export function parseOrkXml(xml: string, format: '.ork' | '.rkt' = '.ork'): Document {
  // OpenRocket writes a single-quoted XML declaration; some parsers reject it.
  if (xml.charCodeAt(0) === 0xfeff) xml = xml.slice(1); // strip optional BOM
  xml = xml.replace(/^\s*<\?xml[^?]*\?>/, '');
  return parseXmlText(xml, format);
}
