/**
 * One way to hand the user a file.
 *
 * Every export used to build its own `<a download>` click, with the revoke
 * timing drifting between them. Worse, that anchor is unreliable in exactly one
 * place: iOS/iPadOS running the app as an INSTALLED PWA, where a blob download
 * silently does nothing and the file simply never appears. Since the app is now
 * installable, that is a real configuration, not a curiosity.
 *
 * So: anchor download everywhere (it is what people expect — straight to the
 * downloads folder, no extra tap), and the share sheet only where the anchor
 * cannot be trusted, which on iOS offers "Save to Files".
 */

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

/**
 * Save `blob` as `filename`. Resolves once handed off; never rejects — a user
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
      // Canceling raises AbortError — the user chose not to save, so stop here
      // rather than surprising them with a second attempt.
      if (e instanceof DOMException && e.name === 'AbortError') return;
      // Anything else (share unsupported for files, transient failure): fall through.
    }
  }
  anchorDownload(blob, filename);
}

/** Save text as a file. */
export async function saveText(text: string, filename: string, mime = 'text/plain;charset=utf-8'): Promise<void> {
  await saveBlob(new Blob([text], { type: mime }), filename);
}

/**
 * Hand the user a file and don't wait for it — the one entry point every
 * export button uses.
 *
 * There were three of these, one per module (`downloadText(filename, text,
 * mime)`, `downloadBlob(blob, filename)`, `downloadFile(data, filename,
 * mime)`), all one-liners over `saveBlob` and all disagreeing about argument
 * order. Two of the three put the filename where the other put the data, which
 * a `string` payload type-checks straight through: an import of the wrong one
 * silently downloads a file NAMED after its own contents.
 *
 * Filename first, everywhere, matching `safeFilename` beside it.
 */
export function download(filename: string, data: BlobPart, mime = 'text/plain;charset=utf-8'): void {
  void saveBlob(data instanceof Blob ? data : new Blob([data], { type: mime }), filename);
}

/**
 * Strip characters a filesystem will not take, keeping a usable fallback.
 *
 * Requires something alphanumeric to survive: a name made only of separators
 * ("///") collapses to "_", which is truthy but a useless filename.
 */
export function safeFilename(name: string, fallback = 'rocket'): string {
  const cleaned = (name ?? '').trim().replace(/[^a-z0-9._-]+/gi, '_');
  return /[a-z0-9]/i.test(cleaned) ? cleaned : fallback;
}

/**
 * A download's name, built from the parts that identify it.
 *
 * Every export in the app names its file the same way, because a downloads
 * folder is a flat list shared with everything else the browser saves there:
 * "aero-table.csv" and "flight-events.csv" say nothing about WHICH rocket, and
 * a second design overwrites the first. The parts, in reading order:
 *
 *   about the rocket    rocket + what it is             Bertha-design.ork
 *                                                       Bertha-aero-table.csv
 *   about a simulation  rocket + sim + what it is       Bertha-C6 flight-flight-events.csv
 *   a printable part    rocket + component              Bertha-Nose cone.stl
 *
 * A design document is not an exception to the first line: `.ork`, `.rkt` and
 * `.CDX1` are "-design", the way the report is "-report". A name says which
 * rocket AND which document, and a bare `Bertha.ork` only says which rocket.
 * Round-tripping is stable because the rocket's name comes from INSIDE the
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
