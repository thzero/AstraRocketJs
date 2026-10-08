/**
 * Reading a response body with byte-level progress.
 *
 * `res.json()` / `res.arrayBuffer()` resolve only once the whole transfer is
 * done, which tells the user nothing during the two multi-megabyte downloads
 * this app makes: the WASM engine at boot and the motor catalog. On a slow
 * link that is precisely when "still downloading" needs to be distinguishable
 * from "stuck".
 */

/** Bytes transferred so far, and the total when the host declared one. */
export type TransferProgress = { loaded: number; total: number | null };

/** A response's content-length, or null when it declares none or an unusable one
 *  (absent behind chunked transfer encoding, so the UI must cope either way). */
export function declaredLength(res: Response): number | null {
  const n = Number(res.headers.get('content-length'));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Drain a body stream to a single buffer, reporting progress as chunks arrive.
 * Reports once up front with `loaded: 0`, so a caller can show a bar before the
 * first chunk lands.
 *
 * `maxBytes` is enforced against bytes actually received rather than the
 * declared length, so a host that omits or misstates content-length cannot slip
 * past the cap.
 */
export async function readStreamWithProgress(
  body: ReadableStream<Uint8Array>,
  total: number | null,
  onProgress: (p: TransferProgress) => void,
  maxBytes = Number.POSITIVE_INFINITY,
): Promise<Uint8Array> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  onProgress({ loaded, total });
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    chunks.push(value);
    loaded += value.byteLength;
    if (loaded > maxBytes) {
      // Cancel, do not merely abandon. Dropping the reader leaves the transfer
      // in flight, so the cap would bound the buffer we keep and not the bytes
      // the network moves, and the caller goes on to try its fallback base
      // while the refused response is still downloading. `cancel` can itself
      // reject (a stream already errored by the network), and that must not
      // mask the reason we are here.
      await reader.cancel().catch(() => {});
      throw new Error('response too large');
    }
    onProgress({ loaded, total });
  }
  const buf = new Uint8Array(loaded);
  let at = 0;
  for (const c of chunks) {
    buf.set(c, at);
    at += c.byteLength;
  }
  return buf;
}
