import { describe, it, expect, vi } from 'vitest';
import { readStreamWithProgress } from '../../../src/services/app/fetchProgress';

/**
 * The size cap on a streamed response.
 *
 * `maxBytes` is checked against bytes ACTUALLY RECEIVED, so a host that omits
 * or misstates content-length cannot slip past it. The subtlety the cap exists
 * for is what happens on the way out: abandoning the reader leaves the transfer
 * in flight, which would make the cap bound the buffer we keep rather than the
 * bytes the network moves, while the caller goes on to try its fallback base.
 */

/** A stream of `count` chunks of `size` bytes, recording whether it was canceled. */
const chunked = (count: number, size: number) => {
  const state = { canceled: 0, pulled: 0 };
  const stream = new ReadableStream<Uint8Array>({
    pull(c) {
      if (state.pulled >= count) {
        c.close();
        return;
      }
      state.pulled += 1;
      c.enqueue(new Uint8Array(size));
    },
    cancel() {
      state.canceled += 1;
    },
  });
  return { stream, state };
};

describe('readStreamWithProgress', () => {
  it('reads a stream through and reports progress', async () => {
    const { stream } = chunked(4, 10);
    const seen: number[] = [];
    const out = await readStreamWithProgress(stream, 40, (p) => seen.push(p.loaded));
    expect(out.byteLength).toBe(40);
    expect(seen.at(-1)).toBe(40);
  });

  it('refuses a response past the cap', async () => {
    const { stream } = chunked(10, 100);
    await expect(readStreamWithProgress(stream, null, () => {}, 250)).rejects.toThrow(/too large/i);
  });

  it('CANCELS the stream when it refuses, rather than abandoning it', async () => {
    const { stream, state } = chunked(1000, 100);
    await expect(readStreamWithProgress(stream, null, () => {}, 250)).rejects.toThrow(/too large/i);
    // The point of the finding: without the cancel the transfer stays live and
    // the cap bounds only the buffer, not the download.
    expect(state.canceled).toBe(1);
    // And it stopped pulling rather than draining the whole thing.
    expect(state.pulled).toBeLessThan(10);
  });

  it('surfaces the size error even when canceling itself fails', async () => {
    // `cancel` can reject on a stream the network already errored. That must
    // not replace the reason we are here.
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        c.enqueue(new Uint8Array(100));
      },
      cancel() {
        throw new Error('cancel exploded');
      },
    });
    await expect(readStreamWithProgress(stream, null, () => {}, 50)).rejects.toThrow(/too large/i);
  });

  it('does not cancel a stream that finished within the cap', async () => {
    const { stream, state } = chunked(2, 10);
    await readStreamWithProgress(stream, 20, () => {}, 1000);
    expect(state.canceled).toBe(0);
  });

  it('reports progress before the first chunk, so a slow start shows something', async () => {
    const { stream } = chunked(1, 5);
    const onProgress = vi.fn();
    await readStreamWithProgress(stream, 5, onProgress);
    expect(onProgress.mock.calls[0]?.[0]).toMatchObject({ loaded: 0, total: 5 });
  });
});
