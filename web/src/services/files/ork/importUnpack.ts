import { Gunzip, Inflate, Unzip, UnzipPassThrough, strFromU8, type UnzipDecoder } from 'fflate';
import { decodeFileText } from '../decodeText';
import { parseXmlText } from '../xmlUtil';
import {
  MAX_ARCHIVE_ENTRIES,
  MAX_ARCHIVE_ENTRY_BYTES,
  MAX_ARCHIVE_TOTAL_BYTES,
  MAX_GZIP_MEMBERS,
} from './importLimits';
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
 * Compressed bytes handed to an inflater at a time.
 *
 * fflate inflates everything it is given before it reports any output, so the
 * input is fed in slices and each slice's output is counted before the next.
 * DEFLATE expands at most about 1032:1, so one slice yields at most about
 * 1 MiB: the cap stops the work within that much of its limit, whatever the
 * file declares about its own size.
 */
const INFLATE_SLICE = 1024;

/** Push `bytes` to `push` in INFLATE_SLICE pieces, `final` on the last. */
function feed(push: (chunk: Uint8Array, final: boolean) => void, bytes: Uint8Array): void {
  if (bytes.length === 0) {
    push(bytes, true);
    return;
  }
  for (let at = 0; at < bytes.length; at += INFLATE_SLICE) {
    const end = Math.min(at + INFLATE_SLICE, bytes.length);
    push(bytes.subarray(at, end), end === bytes.length);
  }
}

/** The chunks laid end to end. */
function joined(chunks: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/**
 * Input an inflater may take in without producing output before the stream is
 * refused.
 *
 * A valid DEFLATE stream never holds back more than a stored block (65,535
 * bytes) and its framing. A gzip header may legally be longer, but the writers
 * that make `.ork` files keep it to a few bytes and a file name, and a longer
 * one is refused here. fflate keeps the input it has not turned into output
 * and copies all of it again on every push, so a stream that never produces
 * output (a header that never ends, bytes after the end of the data) would
 * cost time that grows with the square of its length. Refusing it here bounds
 * that.
 */
const MAX_INPUT_WITHOUT_OUTPUT = 128 * 1024;

/**
 * Pushes slices to `push` and refuses the stream once it has taken in more
 * than MAX_INPUT_WITHOUT_OUTPUT since its last output; call `produced` on
 * every non-empty output.
 */
function stallGuard(push: (chunk: Uint8Array, final: boolean) => void) {
  let sinceOutput = 0;
  return {
    produced: () => {
      sinceOutput = 0;
    },
    push: (chunk: Uint8Array, final: boolean) => {
      sinceOutput += chunk.length;
      if (sinceOutput > MAX_INPUT_WITHOUT_OUTPUT) throw new KeyedError('errors.file.archiveCorrupt');
      push(chunk, final);
    },
  };
}

/** A gzip stream, inflated with the same cap a zip member gets. */
function gunzipCapped(bytes: Uint8Array): Uint8Array {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const stream = new Gunzip((chunk) => {
    if (chunk.length) guard.produced();
    total += chunk.length;
    if (total > MAX_ARCHIVE_ENTRY_BYTES) throw new KeyedError('errors.file.archiveTooLarge');
    chunks.push(chunk);
  });
  let members = 1;
  stream.onmember = () => {
    if (++members > MAX_GZIP_MEMBERS) throw new KeyedError('errors.file.archiveTooManyEntries');
  };
  const guard = stallGuard((chunk, final) => stream.push(chunk, final));
  feed(guard.push, bytes);
  return joined(chunks);
}

/**
 * A deflated zip member's inflater, refused once it stops producing output.
 * `Unzip` hands it the member in the slices `unzipCapped` feeds the archive in,
 * so the caller's count sees its output as it grows.
 */
class GuardedInflate implements UnzipDecoder {
  static compression = 8;
  ondata: UnzipDecoder['ondata'] = () => {};
  private readonly inflate = new Inflate((data, final) => {
    if (data.length) this.guard.produced();
    this.ondata(null, data, final);
  });
  private readonly guard = stallGuard((chunk, final) => this.inflate.push(chunk, final));
  push(chunk: Uint8Array, final: boolean): void {
    this.guard.push(chunk, final);
  }
}

/**
 * Every member of a zip, inflated with a cap on each member and on the whole.
 *
 * The count is of the bytes each member actually inflates to, not the sizes the
 * archive declares: a member can declare a few bytes and inflate to gigabytes.
 * The members are read in the order the archive stores them, from their local
 * headers. A member whose data descriptor leaves out its signature (APPNOTE
 * 4.3.9.3 allows it, and `ZipInputStream` reads it) throws fflate's streaming
 * reader off at the member's end, so an archive the stream cannot read is read
 * again through its central directory ({@link unzipFromDirectory}), with the
 * same caps. Anything neither reader can make sense of (a member cut off
 * partway through its data, a method it does not know) is refused with a
 * keyed message. An archive cut off inside a member's local header, or right
 * at its end before any data, ends before that member, and the members before
 * it are read, as `ZipInputStream` reads them when the cut falls in the
 * header's fixed part.
 */
function unzipCapped(bytes: Uint8Array): Map<string, Uint8Array> {
  try {
    return unzipStreaming(bytes);
  } catch (e) {
    if (e instanceof KeyedError && e.key !== 'errors.file.archiveCorrupt') throw e;
  }
  try {
    return unzipFromDirectory(bytes);
  } catch (e) {
    if (e instanceof KeyedError) throw e;
    throw new KeyedError('errors.file.archiveCorrupt');
  }
}

/** Counts every member's inflated bytes against the per-member and whole-archive caps. */
function memberCounter() {
  let entryCount = 0;
  let total = 0;
  return {
    entry: () => {
      if (++entryCount > MAX_ARCHIVE_ENTRIES) throw new KeyedError('errors.file.archiveTooManyEntries');
      let size = 0;
      return (data: Uint8Array) => {
        size += data.length;
        total += data.length;
        if (size > MAX_ARCHIVE_ENTRY_BYTES || total > MAX_ARCHIVE_TOTAL_BYTES) {
          throw new KeyedError('errors.file.archiveTooLarge');
        }
      };
    },
  };
}

/** The members read from their local headers, in the order the archive stores them. */
function unzipStreaming(bytes: Uint8Array): Map<string, Uint8Array> {
  const members = new Map<string, Uint8Array>();
  const counter = memberCounter();
  const unzip = new Unzip((file) => {
    const count = counter.entry();
    const chunks: Uint8Array[] = [];
    file.ondata = (err, data, final) => {
      if (err) throw err;
      count(data);
      chunks.push(data);
      if (final) members.set(file.name, joined(chunks));
    };
    file.start();
  });
  unzip.register(UnzipPassThrough);
  unzip.register(GuardedInflate);
  try {
    feed((chunk, final) => unzip.push(chunk, final), bytes);
  } catch (e) {
    if (e instanceof KeyedError) throw e;
    throw new KeyedError('errors.file.archiveCorrupt');
  }
  return members;
}

/** The end-of-central-directory record's signature, and its fixed size. */
const EOCD_SIG = 0x06054b50;
const EOCD_SIZE = 22;
/** The longest archive comment, which is all that may follow the record. */
const MAX_COMMENT = 0xffff;

/**
 * The members read through the central directory, which states each one's
 * compressed size, so a member's end does not depend on its data descriptor.
 * Stored and deflated members only, each inflated in slices under the same
 * caps as the streaming read.
 */
function unzipFromDirectory(bytes: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const corrupt = () => new KeyedError('errors.file.archiveCorrupt');
  let eocd = -1;
  for (let at = bytes.length - EOCD_SIZE; at >= Math.max(0, bytes.length - EOCD_SIZE - MAX_COMMENT); at--) {
    if (view.getUint32(at, true) === EOCD_SIG) {
      eocd = at;
      break;
    }
  }
  if (eocd < 0) throw corrupt();
  const count = view.getUint16(eocd + 10, true);
  if (count > MAX_ARCHIVE_ENTRIES) throw new KeyedError('errors.file.archiveTooManyEntries');
  const members = new Map<string, Uint8Array>();
  const counter = memberCounter();
  let at = view.getUint32(eocd + 16, true);
  for (let i = 0; i < count; i++) {
    if (at + 46 > bytes.length || view.getUint32(at, true) !== 0x02014b50) throw corrupt();
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const csize = view.getUint32(at + 20, true);
    const nameLen = view.getUint16(at + 28, true);
    const next = at + 46 + nameLen + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    if (next > bytes.length || local + 30 > bytes.length || view.getUint32(local, true) !== 0x04034b50) {
      throw corrupt();
    }
    const name = strFromU8(bytes.subarray(at + 46, at + 46 + nameLen), (flags & 0x800) === 0);
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    if (start + csize > bytes.length) throw corrupt();
    const data = bytes.subarray(start, start + csize);
    const tally = counter.entry();
    const chunks: Uint8Array[] = [];
    if (method === 0) {
      tally(data);
      chunks.push(data);
    } else if (method === 8) {
      let ended = false;
      const inflate = new GuardedInflate();
      inflate.ondata = (err, out, final) => {
        if (err) throw err;
        tally(out);
        chunks.push(out);
        if (final) ended = true;
      };
      feed((chunk, final) => inflate.push(chunk, final), data);
      if (!ended) throw corrupt();
    } else throw corrupt();
    members.set(name, joined(chunks));
    at = next;
  }
  return members;
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
    let inner: Uint8Array;
    try {
      inner = gunzipCapped(bytes);
    } catch (e) {
      if (e instanceof KeyedError) throw e;
      throw new KeyedError('errors.file.archiveCorrupt');
    }
    return unpackOrk(inner.buffer.slice(inner.byteOffset, inner.byteOffset + inner.byteLength) as ArrayBuffer, true);
  }
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    // A crafted archive (a member that inflates far past what it declares, or
    // thousands of members) would otherwise freeze or exhaust the tab.
    const entries = unzipCapped(bytes);
    const names = [...entries.keys()];
    const entryName = names.find((n) => n.endsWith('.ork')) ?? names[0];
    if (!entryName) throw new KeyedError('errors.file.archiveEmpty');
    const motorFiles: string[] = [];
    const dropped: string[] = [];
    for (const name of names) {
      if (name === entryName) continue;
      // Any `.rse` in the archive, not just `thrustcurves/` ones: the folder is
      // the desktop's convention, not something the loader depends on.
      if (name.toLowerCase().endsWith('.rse')) motorFiles.push(decodeFileText(entries.get(name)!));
      // A thumbnail is regenerated on demand by whatever opens the file next, so
      // losing it is not a loss worth reporting.
      else if (name !== 'preview.png') dropped.push(name);
    }
    return { xml: decodeFileText(entries.get(entryName)!), motorFiles, dropped };
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
