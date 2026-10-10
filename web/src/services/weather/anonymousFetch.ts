/**
 * A GET that names no site: no `Origin` but `null`, no `Referer`, no cookies.
 *
 * A page cannot take `Origin` off its own cross-site requests; the browser adds
 * it to every request whose answer the page reads. A sandboxed frame without
 * `allow-same-origin` has an opaque origin instead, so a request it makes
 * carries `Origin: null`, and `referrerPolicy: 'no-referrer'` drops `Referer`.
 * The weather requests go through one such frame, so Open-Meteo sees the
 * user's IP address and nothing that names this app or the site serving it.
 *
 * This needs the service to answer `Access-Control-Allow-Origin: *`, which
 * Open-Meteo does on every endpoint used here.
 *
 * The frame runs only the small script below. It holds nothing of the app's,
 * cannot reach the page (no same-origin), and answers only messages from the
 * page that made it.
 */

export interface AnonymousResponse {
  status: number;
  /** The body as text; parsing is the caller's. */
  text: string;
}

/**
 * The most body bytes one answer may carry. The largest answer the app asks
 * for is a forecast at two elevations: 111 hourly series (time, 9 surface and
 * sky variables, 6 winds above ground, 5 variables at each of 19 pressure
 * levels) of 72 hours each, about 140 KB of JSON. Elevation batches of 100
 * points and 10 place matches are a few KB. 2 MiB leaves more than ten times
 * the largest for longer numbers and added fields, and keeps a runaway or
 * hostile answer from filling memory.
 */
export const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

/**
 * How long the frame has to report that its script runs. It does so within
 * milliseconds of being added; a frame still silent after this never will
 * (its script was blocked), and is thrown away so the next request makes a
 * new one. Shorter than the weather requests' own deadline, so a frame that
 * never starts fails the request before the caller gives up on it.
 */
const FRAME_START_TIMEOUT_MS = 5_000;

/**
 * The frame's whole program: fetch what it is asked to, answer with status and
 * text, honor a cancel, and stop reading at `MAX_RESPONSE_BYTES`.
 */
const FRAME_SCRIPT = `
const MAX = ${MAX_RESPONSE_BYTES};
const running = new Map();
async function readCapped(res, ctl) {
  if (Number(res.headers.get('content-length')) > MAX) { ctl.abort(); return null; }
  if (!res.body) return '';
  const reader = res.body.getReader();
  const parts = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > MAX) { reader.cancel().catch(() => {}); ctl.abort(); return null; }
    parts.push(value);
  }
  const all = new Uint8Array(n);
  let at = 0;
  for (const p of parts) { all.set(p, at); at += p.byteLength; }
  return new TextDecoder().decode(all);
}
addEventListener('message', async (e) => {
  if (e.source !== parent) return;
  const m = e.data;
  if (!m || typeof m.id !== 'number') return;
  if (m.cancel) { running.get(m.id)?.abort(); return; }
  if (typeof m.url !== 'string' || !m.url.startsWith('https://')) {
    parent.postMessage({ id: m.id, error: 'refused' }, '*');
    return;
  }
  const ctl = new AbortController();
  running.set(m.id, ctl);
  try {
    const res = await fetch(m.url, { credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', signal: ctl.signal });
    const text = await readCapped(res, ctl);
    if (text === null) parent.postMessage({ id: m.id, error: 'tooLarge' }, '*');
    else parent.postMessage({ id: m.id, status: res.status, text }, '*');
  } catch (err) {
    parent.postMessage({ id: m.id, error: ctl.signal.aborted ? 'aborted' : 'network' }, '*');
  } finally {
    running.delete(m.id);
  }
});
parent.postMessage({ ready: true }, '*');
`;

/** Why a request did not complete: the network failed, it was canceled, or the answer was over `MAX_RESPONSE_BYTES`. */
export class AnonymousFetchError extends Error {
  readonly kind: 'network' | 'aborted' | 'tooLarge';
  constructor(kind: 'network' | 'aborted' | 'tooLarge') {
    super(kind);
    this.name = 'AnonymousFetchError';
    this.kind = kind;
  }
}

/** The frame in use, or the one starting; null until first use and after a frame that never started. */
let frame: { el: HTMLIFrameElement; ready: Promise<Window> } | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (r: AnonymousResponse) => void; reject: (e: Error) => void }>();

function onMessage(e: MessageEvent): void {
  if (!frame || e.source !== frame.el.contentWindow) return;
  const m = e.data as { id?: number; status?: number; text?: unknown; error?: string };
  if (typeof m?.id !== 'number') return;
  const p = pending.get(m.id);
  if (!p) return;
  pending.delete(m.id);
  if (typeof m.status === 'number') {
    const text = typeof m.text === 'string' ? m.text : '';
    // A string's length never exceeds its UTF-8 byte count, so this holds the
    // frame's byte cap even for a frame that did not apply it.
    if (text.length > MAX_RESPONSE_BYTES) p.reject(new AnonymousFetchError('tooLarge'));
    else p.resolve({ status: m.status, text });
  } else {
    p.reject(
      new AnonymousFetchError(m.error === 'aborted' ? 'aborted' : m.error === 'tooLarge' ? 'tooLarge' : 'network'),
    );
  }
}

/**
 * The frame's window once its script reports ready. The frame is made on first
 * use and kept for the page's life, unless it stays silent past
 * `FRAME_START_TIMEOUT_MS`: then it is removed and forgotten, the wait rejects,
 * and the next call starts a new one.
 */
function frameWindow(): Promise<Window> {
  if (frame) return frame.ready;
  const el = document.createElement('iframe');
  // Scripts, and nothing else: no same-origin, no top navigation, no forms.
  el.setAttribute('sandbox', 'allow-scripts');
  el.setAttribute('aria-hidden', 'true');
  el.tabIndex = -1;
  el.style.display = 'none';
  el.srcdoc = `<!doctype html><meta charset="utf-8"><script>${FRAME_SCRIPT}</script>`;
  const ready = new Promise<Window>((resolve, reject) => {
    const hello = (e: MessageEvent) => {
      if (e.source !== el.contentWindow || !(e.data as { ready?: boolean })?.ready) return;
      clearTimeout(timer);
      window.removeEventListener('message', hello);
      window.addEventListener('message', onMessage);
      resolve(el.contentWindow!);
    };
    const timer = setTimeout(() => {
      window.removeEventListener('message', hello);
      el.remove();
      if (frame?.el === el) frame = null;
      reject(new AnonymousFetchError('network'));
    }, FRAME_START_TIMEOUT_MS);
    window.addEventListener('message', hello);
  });
  // Every waiter may have given up by the time a silent frame is dropped.
  ready.catch(() => {});
  frame = { el, ready };
  document.body.appendChild(el);
  return ready;
}

/** `ready`, or a rejection as soon as `signal` aborts, whichever comes first. */
function untilReady(ready: Promise<Window>, signal: AbortSignal | undefined): Promise<Window> {
  if (!signal) return ready;
  return new Promise<Window>((resolve, reject) => {
    const onAbort = () => reject(new AnonymousFetchError('aborted'));
    signal.addEventListener('abort', onAbort, { once: true });
    ready.then(
      (w) => {
        signal.removeEventListener('abort', onAbort);
        resolve(w);
      },
      (e: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(e instanceof Error ? e : new AnonymousFetchError('network'));
      },
    );
  });
}

/** GET `url` from the sandboxed frame. Rejects with `AnonymousFetchError`. */
export async function anonymousGet(url: string, signal?: AbortSignal): Promise<AnonymousResponse> {
  if (signal?.aborted) throw new AnonymousFetchError('aborted');
  // The frame refuses these too; refusing here keeps them off the frame entirely.
  if (!url.startsWith('https://')) throw new AnonymousFetchError('network');
  const win = await untilReady(frameWindow(), signal);
  if (signal?.aborted) throw new AnonymousFetchError('aborted');
  const id = nextId++;
  return new Promise<AnonymousResponse>((resolve, reject) => {
    const onAbort = () => {
      // The frame stops the request; the caller is answered now.
      win.postMessage({ id, cancel: true }, '*');
      pending.delete(id);
      reject(new AnonymousFetchError('aborted'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    pending.set(id, {
      resolve: (r) => {
        signal?.removeEventListener('abort', onAbort);
        resolve(r);
      },
      reject: (e) => {
        signal?.removeEventListener('abort', onAbort);
        reject(e);
      },
    });
    // '*' because the frame's origin is opaque and has no name to target.
    win.postMessage({ id, url }, '*');
  });
}
