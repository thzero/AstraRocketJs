/**
 * One way to hand the user a file.
 *
 * One implementation, so the blob revoke timing cannot drift between exports, and
 * because the `<a download>` anchor is unreliable in one place: iOS/iPadOS running
 * the app as an installed PWA, where a blob download silently does nothing and the
 * file never appears. The app is installable, so that is a real configuration.
 *
 * So: the browser's own save dialog where it has one and the user has not turned
 * it off (Settings, General), so they choose the name and the folder; else the
 * anchor download, straight to the downloads folder; and the share sheet only
 * where the anchor cannot be trusted, which on iOS offers "Save to Files".
 */

import { loadSettings } from '../storage/settings';

/** iOS or iPadOS. iPadOS 13+ reports as a Mac, hence the touch check. */
function isApplePhoneOrTablet(): boolean {
  if (typeof navigator === 'undefined') return false;
  if (/iP(hone|ad|od)/.test(navigator.userAgent)) return true;
  return navigator.platform === 'MacIntel' && (navigator.maxTouchPoints ?? 0) > 1;
}

/** Running as an installed app rather than a browser tab. */
function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const iosStandalone = (navigator as unknown as { standalone?: boolean }).standalone === true;
  return iosStandalone || window.matchMedia?.('(display-mode: standalone)').matches === true;
}

/** True only where `<a download>` is known not to work. */
function needsShareSheet(): boolean {
  return isApplePhoneOrTablet() && isStandalone();
}

function anchorDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Deferred: revoking synchronously can cancel the download before the browser
  // has finished reading the blob.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** The File System Access save dialog, where the browser has one. */
type SavePicker = (options: {
  suggestedName: string;
  types?: { description?: string; accept: Record<string, string[]> }[];
}) => Promise<{ createWritable: () => Promise<{ write: (data: Blob) => Promise<void>; close: () => Promise<void> }> }>;

function savePicker(): SavePicker | null {
  if (typeof window === 'undefined') return null;
  const picker = (window as unknown as { showSaveFilePicker?: SavePicker }).showSaveFilePicker;
  return typeof picker === 'function' ? picker : null;
}

/** Whether this browser can ask where to save: Chrome and Edge, not Firefox or Safari. */
export function canAskWhereToSave(): boolean {
  return savePicker() !== null;
}

/**
 * Save through the browser's dialog. True when the file was written or the user
 * canceled; false when the dialog could not be used and the caller should fall
 * back. A save that starts too long after the click that asked for it is
 * refused by the browser (it needs that click), which is the usual false.
 */
async function pickAndSave(picker: SavePicker, blob: Blob, filename: string): Promise<boolean> {
  const ext = /\.([A-Za-z0-9]+)$/.exec(filename)?.[1];
  // The dialog wants a bare MIME type: `text/csv;charset=utf-8` is refused.
  const mime = (blob.type || 'application/octet-stream').split(';')[0]!.trim();
  try {
    const handle = await picker({
      suggestedName: filename,
      ...(ext ? { types: [{ description: ext.toUpperCase(), accept: { [mime]: [`.${ext}`] } }] } : {}),
    });
    const out = await handle.createWritable();
    await out.write(blob);
    await out.close();
    return true;
  } catch (e) {
    // The user closed the dialog: they chose not to save, so nothing follows.
    if (e instanceof DOMException && e.name === 'AbortError') return true;
    return false;
  }
}

/**
 * Save `blob` as `filename`. Resolves once handed off; never rejects: a user
 * canceling the share sheet is not an error, and a failed share falls back to
 * the anchor rather than leaving them with nothing.
 */
export async function saveBlob(blob: Blob, filename: string): Promise<void> {
  if (needsShareSheet()) {
    try {
      const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file] });
        return;
      }
    } catch (e) {
      // Canceling raises AbortError: the user chose not to save, so stop here
      // rather than surprising them with a second attempt.
      if (e instanceof DOMException && e.name === 'AbortError') return;
      // Anything else (share unsupported for files, transient failure): fall through.
    }
  }
  const picker = loadSettings().askWhereToSave ? savePicker() : null;
  if (picker && (await pickAndSave(picker, blob, filename))) return;
  anchorDownload(blob, filename);
}

const BOM = String.fromCharCode(0xfeff);

/**
 * The text a file of type `mime` is saved with. A CSV starts with a UTF-8
 * byte-order mark, because Excel on Windows opens a CSV without one in the
 * ANSI code page and garbles every degree sign, superscript and accented name.
 * The mark is added here, at the download, so every CSV builder's string (and
 * anything that reads one back) stays free of it; the wind-profile reader
 * strips one when a file brings it.
 */
function textForSave(text: string, mime: string): string {
  const isCsv = mime.trim().toLowerCase().startsWith('text/csv');
  return isCsv && !text.startsWith(BOM) ? BOM + text : text;
}

/** Save text as a file. */
export async function saveText(text: string, filename: string, mime = 'text/plain;charset=utf-8'): Promise<void> {
  await saveBlob(new Blob([textForSave(text, mime)], { type: mime }), filename);
}

/**
 * Hand the user a file and don't wait for it. One of the entry points; every
 * export ends in `saveBlob`.
 *
 * Filename first, matching `safeFilename` beside it. A `string` payload
 * type-checks in either position, so one shared argument order is what keeps a
 * caller from downloading a file named after its own contents.
 */
export function download(filename: string, data: BlobPart, mime = 'text/plain;charset=utf-8'): void {
  const part = typeof data === 'string' ? textForSave(data, mime) : data;
  void saveBlob(part instanceof Blob ? part : new Blob([part], { type: mime }), filename);
}

/**
 * Strip characters a filesystem will not take, keeping a usable fallback.
 *
 * Letters and digits of any script survive, so a Cyrillic or Japanese design
 * name still names its file. Everything else but `.`, `_` and `-` becomes `_`:
 * whitespace, path separators, the characters Windows reserves (`<>:"/\|?*`)
 * and controls. Leading dots go, so a name never makes a hidden file or a `..`
 * segment.
 *
 * Requires a letter or digit to survive: a name made only of separators
 * ("///") collapses to "_", which is truthy but a useless filename.
 */
export function safeFilename(name: string, fallback = 'rocket'): string {
  const cleaned = (name ?? '')
    .trim()
    .replace(/[^\p{L}\p{M}\p{N}._-]+/gu, '_')
    .replace(/^\.+/, '');
  return /[\p{L}\p{N}]/u.test(cleaned) ? cleaned : fallback;
}

/**
 * A download's name, built from the parts that identify it.
 *
 * Every export in the app names its file the same way, because a downloads
 * folder is a flat list shared with everything else the browser saves there:
 * "aero-table.csv" and "flight-events.csv" say nothing about which rocket, and
 * a second design overwrites the first. The parts, in reading order:
 *
 *   about the rocket    rocket + what it is             Bertha-design.ork
 *                                                       Bertha-aero-table.csv
 *   about a simulation  rocket + sim + what it is       Bertha-C6_flight-flight-events.csv
 *   a printable part    rocket + component              Bertha-Nose_cone.stl
 *
 * A design document is not an exception to the first line: `.ork`, `.rkt` and
 * `.CDX1` are "-design", the way the report is "-report". A name says which
 * rocket and which document, and a bare `Bertha.ork` only says which rocket.
 * Round-tripping is stable because the rocket's name comes from inside the
 * file rather than from the filename, so re-saving an opened
 * `Bertha-design.ork` gives that same name back rather than stacking suffixes.
 *
 * Empty and blank parts drop out rather than leaving a double separator, so a
 * design that has never been named still gets a usable filename, and a caller
 * can pass an optional part without guarding it.
 */
export function exportFilename(
  parts: readonly (string | null | undefined)[],
  ext: string,
  fallback = 'rocket',
): string {
  const kept = parts.map((p) => safeFilename(p ?? '', '')).filter(Boolean);
  return `${kept.length ? kept.join('-') : fallback}.${ext}`;
}
