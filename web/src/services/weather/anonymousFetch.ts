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

/** The frame's whole program: fetch what it is asked to, answer with status and text, honor a cancel. */
const FRAME_SCRIPT = `
const running = new Map();
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
    parent.postMessage({ id: m.id, status: res.status, text: await res.text() }, '*');
  } catch (err) {
    parent.postMessage({ id: m.id, error: ctl.signal.aborted ? 'aborted' : 'network' }, '*');
  } finally {
    running.delete(m.id);
  }
});
parent.postMessage({ ready: true }, '*');
`;

let frame: HTMLIFrameElement | null = null;
let ready: Promise<Window> | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (r: AnonymousResponse) => void; reject: (e: Error) => void }>();

/** Why a request did not complete: the network failed, or it was canceled. */
class AnonymousFetchError extends Error {
  readonly kind: 'network' | 'aborted';
  constructor(kind: 'network' | 'aborted') {
    super(kind);
    this.name = 'AnonymousFetchError';
    this.kind = kind;
  }
}

function onMessage(e: MessageEvent): void {
  if (!frame || e.source !== frame.contentWindow) return;
  const m = e.data as { id?: number; status?: number; text?: string; error?: string };
  if (typeof m?.id !== 'number') return;
  const p = pending.get(m.id);
  if (!p) return;
  pending.delete(m.id);
  if (typeof m.status === 'number') p.resolve({ status: m.status, text: m.text ?? '' });
  else p.reject(new AnonymousFetchError(m.error === 'aborted' ? 'aborted' : 'network'));
}

/** The frame, made on first use and kept for the page's life. */
function frameWindow(): Promise<Window> {
  if (ready) return ready;
  ready = new Promise<Window>((resolve) => {
    const f = document.createElement('iframe');
    // Scripts, and nothing else: no same-origin, no top navigation, no forms.
    f.setAttribute('sandbox', 'allow-scripts');
    f.setAttribute('aria-hidden', 'true');
    f.tabIndex = -1;
    f.style.display = 'none';
    f.srcdoc = `<!doctype html><meta charset="utf-8"><script>${FRAME_SCRIPT}</script>`;
    const hello = (e: MessageEvent) => {
      if (e.source !== f.contentWindow || !(e.data as { ready?: boolean })?.ready) return;
      window.removeEventListener('message', hello);
      window.addEventListener('message', onMessage);
      resolve(f.contentWindow!);
    };
    window.addEventListener('message', hello);
    frame = f;
    document.body.appendChild(f);
  });
  return ready;
}

/** GET `url` from the sandboxed frame. Rejects with `AnonymousFetchError`. */
export async function anonymousGet(url: string, signal?: AbortSignal): Promise<AnonymousResponse> {
  if (signal?.aborted) throw new AnonymousFetchError('aborted');
  const win = await frameWindow();
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
