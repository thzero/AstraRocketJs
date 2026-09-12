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
 * cancelling the share sheet is not an error, and a failed share falls back to
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
      // Cancelling raises AbortError — the user chose not to save, so stop here
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
 * Strip characters a filesystem will not take, keeping a usable fallback.
 *
 * Requires something alphanumeric to survive: a name made only of separators
 * ("///") collapses to "_", which is truthy but a useless filename.
 */
export function safeFilename(name: string, fallback = 'rocket'): string {
  const cleaned = (name ?? '').trim().replace(/[^a-z0-9._-]+/gi, '_');
  return /[a-z0-9]/i.test(cleaned) ? cleaned : fallback;
}
