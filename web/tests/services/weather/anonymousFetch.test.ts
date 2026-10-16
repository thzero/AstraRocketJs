// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

/*
 * jsdom makes the iframe and its window but never runs a srcdoc script, so the
 * page side is driven by posting messages as the frame would. The frame's own
 * program is read out of the srcdoc and run against a stand-in `parent`.
 */

type Module = typeof import('../../../src/services/weather/anonymousFetch');

/** A fresh copy of the module, with no frame made yet. */
async function load(): Promise<Module> {
  vi.resetModules();
  return import('../../../src/services/weather/anonymousFetch');
}

const iframes = () => [...document.querySelectorAll('iframe')];

/** The one frame on the page, its window, and a spy on what the page posts to it. */
function theFrame(): { el: HTMLIFrameElement; win: Window; posted: Mock } {
  const all = iframes();
  expect(all).toHaveLength(1);
  const el = all[0]!;
  const win = el.contentWindow!;
  const posted = vi.spyOn(win, 'postMessage').mockImplementation(() => {}) as unknown as Mock;
  return { el, win, posted };
}

/** A message arriving at the page from `source`. */
function arrive(source: Window, data: unknown): void {
  window.dispatchEvent(new MessageEvent('message', { source, data }));
}

/** Let queued promise callbacks run. */
const settle = () => new Promise<void>((r) => setTimeout(r, 0));

/** A promise's outcome without awaiting forever: 'pending' when it has not settled. */
async function outcome<T>(p: Promise<T>): Promise<{ value: T } | { error: unknown } | 'pending'> {
  let out: { value: T } | { error: unknown } | 'pending' = 'pending';
  p.then(
    (value) => (out = { value }),
    (error: unknown) => (out = { error }),
  );
  await settle();
  return out;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const URL_OK = 'https://api.open-meteo.com/v1/elevation?latitude=1&longitude=2';

describe('anonymousGet, page side', () => {
  it('answers from the frame once it reports ready', async () => {
    const m = await load();
    const p = m.anonymousGet(URL_OK);
    const { win, posted } = theFrame();
    arrive(win, { ready: true });
    await settle();
    expect(posted).toHaveBeenCalledWith({ id: expect.any(Number), url: URL_OK }, '*');
    const id = (posted.mock.calls[0]![0] as { id: number }).id;
    arrive(win, { id, status: 200, text: '{"elevation":[5]}' });
    await expect(p).resolves.toEqual({ status: 200, text: '{"elevation":[5]}' });
  });

  it('ignores a ready and an answer from any window but the frame', async () => {
    const m = await load();
    const p = m.anonymousGet(URL_OK);
    const { win, posted } = theFrame();
    const other = document.createElement('iframe');
    document.body.appendChild(other);
    arrive(other.contentWindow!, { ready: true });
    arrive(window, { ready: true });
    await settle();
    expect(posted).not.toHaveBeenCalled();

    arrive(win, { ready: true });
    await settle();
    const id = (posted.mock.calls[0]![0] as { id: number }).id;
    arrive(other.contentWindow!, { id, status: 200, text: 'forged' });
    arrive(window, { id, status: 200, text: 'forged' });
    expect(await outcome(p)).toBe('pending');
    arrive(win, { id, status: 200, text: 'real' });
    await expect(p).resolves.toEqual({ status: 200, text: 'real' });
  });

  it('refuses a URL that is not https without making a frame', async () => {
    const m = await load();
    for (const url of ['http://api.open-meteo.com/v1/forecast', 'javascript:alert(1)', 'file:///etc/passwd']) {
      await expect(m.anonymousGet(url)).rejects.toMatchObject({ name: 'AnonymousFetchError', kind: 'network' });
    }
    expect(iframes()).toHaveLength(0);
  });

  it('rejects at once for a signal already aborted', async () => {
    const m = await load();
    const ctl = new AbortController();
    ctl.abort();
    await expect(m.anonymousGet(URL_OK, ctl.signal)).rejects.toMatchObject({ kind: 'aborted' });
  });

  it('on abort after the request went out, tells the frame to cancel and rejects as aborted', async () => {
    const m = await load();
    const ctl = new AbortController();
    const p = m.anonymousGet(URL_OK, ctl.signal);
    const { win, posted } = theFrame();
    arrive(win, { ready: true });
    await settle();
    const id = (posted.mock.calls[0]![0] as { id: number }).id;
    ctl.abort();
    await expect(p).rejects.toMatchObject({ kind: 'aborted' });
    expect(posted).toHaveBeenLastCalledWith({ id, cancel: true }, '*');
    // A late answer for the canceled request is dropped.
    arrive(win, { id, status: 200, text: 'late' });
  });

  it.each([
    ['aborted', 'aborted'],
    ['network', 'network'],
    ['refused', 'network'],
    ['tooLarge', 'tooLarge'],
    ['anything else', 'network'],
  ])('maps the frame error %s to %s', async (error, kind) => {
    const m = await load();
    const p = m.anonymousGet(URL_OK);
    const { win, posted } = theFrame();
    arrive(win, { ready: true });
    await settle();
    const id = (posted.mock.calls[0]![0] as { id: number }).id;
    arrive(win, { id, error });
    await expect(p).rejects.toMatchObject({ name: 'AnonymousFetchError', kind });
  });

  it('refuses an answer longer than the cap even when the frame passed it on', async () => {
    const m = await load();
    const p = m.anonymousGet(URL_OK);
    const { win, posted } = theFrame();
    arrive(win, { ready: true });
    await settle();
    const id = (posted.mock.calls[0]![0] as { id: number }).id;
    arrive(win, { id, status: 200, text: 'x'.repeat(m.MAX_RESPONSE_BYTES + 1) });
    await expect(p).rejects.toMatchObject({ kind: 'tooLarge' });
  });

  it('accepts an answer exactly at the cap', async () => {
    const m = await load();
    const p = m.anonymousGet(URL_OK);
    const { win, posted } = theFrame();
    arrive(win, { ready: true });
    await settle();
    const id = (posted.mock.calls[0]![0] as { id: number }).id;
    arrive(win, { id, status: 200, text: 'x'.repeat(m.MAX_RESPONSE_BYTES) });
    await expect(p).resolves.toMatchObject({ status: 200 });
  });
});

describe('anonymousGet, a frame that never reports ready', () => {
  it('rejects as soon as the signal aborts', async () => {
    const m = await load();
    const ctl = new AbortController();
    const p = m.anonymousGet(URL_OK, ctl.signal);
    expect(await outcome(p)).toBe('pending');
    ctl.abort('timeout');
    await expect(p).rejects.toMatchObject({ kind: 'aborted' });
  });

  it('drops the frame after the startup deadline, and the next request makes a new one', async () => {
    vi.useFakeTimers();
    const m = await load();
    const first = m.anonymousGet(URL_OK);
    const silent = iframes()[0];
    expect(silent).toBeDefined();
    const caught = first.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await caught).toMatchObject({ name: 'AnonymousFetchError', kind: 'network' });
    expect(silent!.isConnected).toBe(false);
    expect(iframes()).toHaveLength(0);

    const second = m.anonymousGet(URL_OK);
    const { el, win, posted } = theFrame();
    expect(el).not.toBe(silent);
    arrive(win, { ready: true });
    await vi.advanceTimersByTimeAsync(0);
    const id = (posted.mock.calls[0]![0] as { id: number }).id;
    arrive(win, { id, status: 200, text: 'ok' });
    await expect(second).resolves.toEqual({ status: 200, text: 'ok' });
  });

  it('keeps a frame that reports ready in time', async () => {
    vi.useFakeTimers();
    const m = await load();
    const p = m.anonymousGet(URL_OK);
    const { el, win, posted } = theFrame();
    arrive(win, { ready: true });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(el.isConnected).toBe(true);
    const id = (posted.mock.calls[0]![0] as { id: number }).id;
    arrive(win, { id, status: 200, text: 'ok' });
    await expect(p).resolves.toEqual({ status: 200, text: 'ok' });
  });
});

describe('Open-Meteo requests through the frame', () => {
  it('a frame that never starts reads as could not reach, not a hang', async () => {
    vi.useFakeTimers();
    vi.resetModules();
    const { searchPlaces, WeatherError } = await import('../../../src/services/weather/openMeteo');
    const caught = searchPlaces('Lucerne', 'en', undefined).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(5_000);
    const err = await caught;
    expect(err).toBeInstanceOf(WeatherError);
    expect(err).toMatchObject({ kind: 'offline' });
  });

  it('an answer over the cap reads as an answer that could not be read', async () => {
    vi.resetModules();
    const { searchPlaces, WeatherError } = await import('../../../src/services/weather/openMeteo');
    const p = searchPlaces('Lucerne', 'en', undefined);
    const { win, posted } = theFrame();
    arrive(win, { ready: true });
    await settle();
    const id = (posted.mock.calls[0]![0] as { id: number }).id;
    arrive(win, { id, error: 'tooLarge' });
    const err = await p.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WeatherError);
    expect(err).toMatchObject({ kind: 'shape', detail: 'too large' });
  });
});

// ------------------------------------------------------------ frame program

interface FrameRun {
  parent: { postMessage: Mock };
  fetch: Mock;
  /** Deliver a message to the frame's listener and wait for its answer. */
  send: (source: unknown, data: unknown) => Promise<void>;
}

/** The program the page puts in the frame, run against a stand-in parent and fetch. */
async function runFrameScript(fetchImpl: (url: string, init: RequestInit) => Promise<Response>): Promise<FrameRun> {
  const m = await load();
  void m.anonymousGet(URL_OK).catch(() => {});
  const srcdoc = iframes()[0]!.srcdoc;
  const script = /<script>([\s\S]*)<\/script>/.exec(srcdoc)?.[1];
  expect(script).toBeDefined();
  const parent = { postMessage: vi.fn() };
  const fetch = vi.fn(fetchImpl);
  let listener: ((e: { source: unknown; data: unknown }) => Promise<void>) | null = null;
  const addEventListener = (type: string, fn: typeof listener) => {
    if (type === 'message') listener = fn;
  };
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- the frame's own program, as the page ships it
  new Function('parent', 'addEventListener', 'fetch', script!)(parent, addEventListener, fetch);
  expect(listener).not.toBeNull();
  return {
    parent,
    fetch,
    send: async (source, data) => {
      await listener!({ source, data });
    },
  };
}

/** A response whose body arrives in `chunks`, with an optional declared length. */
function streamed(chunks: Uint8Array[], contentLength?: number): Response {
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const ch of chunks) c.enqueue(ch);
      c.close();
    },
  });
  const headers = contentLength === undefined ? undefined : { 'content-length': String(contentLength) };
  return new Response(body, { status: 200, headers });
}

describe('the frame program', () => {
  it('reports ready to its parent when it starts', async () => {
    const f = await runFrameScript(() => Promise.reject(new Error('unused')));
    expect(f.parent.postMessage).toHaveBeenCalledWith({ ready: true }, '*');
  });

  it('ignores a message whose source is not its parent', async () => {
    const f = await runFrameScript(() => Promise.resolve(new Response('{}')));
    await f.send({ postMessage: vi.fn() }, { id: 1, url: URL_OK });
    await f.send(null, { id: 2, url: URL_OK });
    expect(f.fetch).not.toHaveBeenCalled();
    expect(f.parent.postMessage).toHaveBeenCalledTimes(1); // the ready alone
  });

  it('refuses a URL that is not https', async () => {
    const f = await runFrameScript(() => Promise.resolve(new Response('{}')));
    await f.send(f.parent, { id: 3, url: 'http://api.open-meteo.com/v1/forecast' });
    expect(f.fetch).not.toHaveBeenCalled();
    expect(f.parent.postMessage).toHaveBeenLastCalledWith({ id: 3, error: 'refused' }, '*');
  });

  it('fetches without credentials, referrer or cache, and answers with status and text', async () => {
    const f = await runFrameScript(() => Promise.resolve(new Response('{"a":1}', { status: 400 })));
    await f.send(f.parent, { id: 4, url: URL_OK });
    expect(f.fetch).toHaveBeenCalledWith(
      URL_OK,
      expect.objectContaining({ credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' }),
    );
    expect(f.parent.postMessage).toHaveBeenLastCalledWith({ id: 4, status: 400, text: '{"a":1}' }, '*');
  });

  it('decodes a body split across chunks as UTF-8', async () => {
    const bytes = new TextEncoder().encode('{"name":"Zürich"}');
    const f = await runFrameScript(() => Promise.resolve(streamed([bytes.slice(0, 11), bytes.slice(11)])));
    await f.send(f.parent, { id: 5, url: URL_OK });
    expect(f.parent.postMessage).toHaveBeenLastCalledWith({ id: 5, status: 200, text: '{"name":"Zürich"}' }, '*');
  });

  it('answers tooLarge for a declared length over the cap, without reading the body', async () => {
    const { MAX_RESPONSE_BYTES } = await load();
    const res = streamed([new Uint8Array(4)], MAX_RESPONSE_BYTES + 1);
    const read = vi.spyOn(res, 'text');
    const f = await runFrameScript(() => Promise.resolve(res));
    await f.send(f.parent, { id: 6, url: URL_OK });
    expect(read).not.toHaveBeenCalled();
    expect(f.parent.postMessage).toHaveBeenLastCalledWith({ id: 6, error: 'tooLarge' }, '*');
  });

  it('stops reading and answers tooLarge once the body passes the cap', async () => {
    const { MAX_RESPONSE_BYTES } = await load();
    const half = new Uint8Array(MAX_RESPONSE_BYTES / 2).fill(0x20);
    const f = await runFrameScript(() => Promise.resolve(streamed([half, half, new Uint8Array(1)])));
    await f.send(f.parent, { id: 7, url: URL_OK });
    expect(f.parent.postMessage).toHaveBeenLastCalledWith({ id: 7, error: 'tooLarge' }, '*');
  });

  it('passes a body exactly at the cap', async () => {
    const { MAX_RESPONSE_BYTES } = await load();
    const half = new Uint8Array(MAX_RESPONSE_BYTES / 2).fill(0x20);
    const f = await runFrameScript(() => Promise.resolve(streamed([half, half])));
    await f.send(f.parent, { id: 8, url: URL_OK });
    const last = f.parent.postMessage.mock.lastCall![0] as { id: number; status: number; text: string };
    expect(last).toMatchObject({ id: 8, status: 200 });
    expect(last.text).toHaveLength(MAX_RESPONSE_BYTES);
  });

  it('answers network when the fetch fails', async () => {
    const f = await runFrameScript(() => Promise.reject(new TypeError('Failed to fetch')));
    await f.send(f.parent, { id: 9, url: URL_OK });
    expect(f.parent.postMessage).toHaveBeenLastCalledWith({ id: 9, error: 'network' }, '*');
  });

  it('aborts the running fetch on cancel and answers aborted', async () => {
    const f = await runFrameScript(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );
    const running = f.send(f.parent, { id: 10, url: URL_OK });
    await f.send(f.parent, { id: 10, cancel: true });
    await running;
    expect(f.parent.postMessage).toHaveBeenLastCalledWith({ id: 10, error: 'aborted' }, '*');
  });
});
