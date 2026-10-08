import { type RefObject, useCallback, useRef, useState } from 'react';
import { type HelpTarget, helpTarget, helpTargetFromUrl } from '../../services/app/helpDocs';

/**
 * How far down the frame a heading has to have moved before the rail calls
 * it the one you are reading.
 *
 * Not zero: a heading sitting a few pixels below the top is the one you are
 * about to read, not the one you are in, and at zero the highlight flickered
 * between two rows on any slow scroll across a boundary.
 */
const SPY_OFFSET_PX = 96;

/**
 * The Help dialog's iframe: what happens on each load, the links clicked inside
 * it, and the heading it is scrolled to.
 *
 * `ready` is only the iframe reporting that it has finished loading `target`.
 * Like the page probe (useHelpPage) it is TAGGED with the src it describes, so
 * a page change makes it stop matching instead of having to be cleared.
 *
 * `navigate` is the one way to move: an anchor on the page already showing
 * scrolls the frame, anything else goes through `open` onto the back stack.
 */
/** How long an anchor is held against the page settling under it. */
const ANCHOR_HOLD_MS = 10_000;

/**
 * Jump to an anchor, and keep it there while the page settles: one applied as a
 * page loads, and one picked from the rail on the page already showing, which
 * can still be settling when the pick lands.
 *
 * The docs site can hydrate AFTER the load event when the machine is busy, and
 * hydrating re-renders the page: its content is replaced by a placeholder, the
 * scroll falls back to the top, and the content arrives a beat later. A single
 * jump at load is undone, so the jump is made again whenever the page's content
 * changes, until the reader scrolls, clicks or types in the frame (the page is
 * theirs from then on) or the hold runs out.
 *
 * Content changes, not size: in the embedded layout <html> and <body> are both
 * fixed to the viewport and the page scrolls past them, so neither resizes as
 * the content comes and goes. And scrolls: the docs site can move the page by
 * itself once it has rendered, which changes no content. A reader's own scroll
 * comes with a wheel, pointer, key or touch, which has already ended the hold.
 *
 * Returns the release, so a newer jump can end this one: two holds would each
 * keep putting the page back on their own anchor.
 */
function holdAnchor(doc: Document, win: Window, id: string): () => void {
  // Looked up by id each time: hydration can replace the element.
  const go = () => {
    const el = id ? doc.getElementById(id) : null;
    if (el) el.scrollIntoView();
    else win.scrollTo(0, 0);
  };
  go();
  // One jump per frame however many nodes a re-render touches.
  let queued = false;
  const settle = () => {
    if (queued) return;
    queued = true;
    win.requestAnimationFrame(() => {
      queued = false;
      go();
    });
  };
  // The frame's own constructor: an observer from this window would watch a
  // document in another realm.
  const Observer = (win as Window & typeof globalThis).MutationObserver;
  const content = new Observer(settle);
  content.observe(doc.body ?? doc.documentElement, { childList: true, subtree: true });
  win.addEventListener('scroll', settle, { passive: true });
  const inputs = ['wheel', 'pointerdown', 'keydown', 'touchstart'] as const;
  const release = () => {
    content.disconnect();
    win.removeEventListener('scroll', settle);
    for (const kind of inputs) win.removeEventListener(kind, release, true);
    win.clearTimeout(timer);
  };
  for (const kind of inputs) win.addEventListener(kind, release, { capture: true, passive: true });
  const timer = win.setTimeout(release, ANCHOR_HOLD_MS);
  return release;
}

export function useHelpFrame(
  target: HelpTarget,
  language: string,
  open: (next: string) => void,
): {
  frameRef: RefObject<HTMLIFrameElement | null>;
  ready: boolean;
  activeHash: string;
  navigate: (next: string) => void;
  onFrameLoad: () => void;
} {
  const frameRef = useRef<HTMLIFrameElement>(null);
  /**
   * An anchor on the current page asked for before the frame has loaded it.
   *
   * The rail's headings come from the fetched page HTML, so they can be clicked
   * while the frame is still loading; scrolling a document that is not there yet
   * does nothing, and the frame then opens at the top. Held here and applied on
   * load instead. '' means the top of the page.
   */
  const pendingAnchor = useRef<string | null>(null);
  // The anchor hold in force, ended by the next jump (see holdAnchor).
  const releaseHold = useRef<(() => void) | null>(null);
  const hold = useCallback((doc: Document, win: Window, id: string) => {
    releaseHold.current?.();
    releaseHold.current = holdAnchor(doc, win, id);
  }, []);
  const [frame, setFrame] = useState<string | null>(null);
  // The heading the frame is scrolled to, so the rail follows you down a page
  // instead of only saying what is on it. '' above the first heading, which is
  // honest: you are not in a section yet.
  const [activeHash, setActiveHash] = useState('');

  const ready = frame === target.src;
  // The page the frame has actually finished loading, set the moment it does.
  // `ready` is React state and reaches a callback only after the next render,
  // so a click landing in that gap read the frame as still loading, parked its
  // anchor for a load that had already happened, and never scrolled.
  const loaded = useRef<string | null>(null);

  const navigate = useCallback(
    (next: string) => {
      const to = helpTarget(next, language);
      if (to.slug === target.slug) {
        // Only the anchor moved. Scrolling the frame beats reloading a page it
        // is already showing.
        const doc = frameRef.current?.contentDocument;
        const id = to.hash ? decodeURIComponent(to.hash.slice(1)) : '';
        if (loaded.current !== target.src) {
          pendingAnchor.current = id;
          return;
        }
        // Held, not jumped once: the page can still be settling, and a
        // re-render then drops the scroll back to the top.
        const win = doc?.defaultView;
        if (doc && win) hold(doc, win, id);
        return;
      }
      pendingAnchor.current = null; // another page carries its own anchor
      open(next);
    },
    [open, language, target.slug, target.src, hold],
  );

  /**
   * Links inside the rendered docs, intercepted in the CAPTURE phase so this
   * gets them before the docs site's own router does.
   *
   * An in-frame link is an ordinary absolute URL into /docs/, and leaving it
   * alone would either navigate the frame to the directory form (the one that
   * does not resolve offline) or, for an outbound link, replace the docs with
   * GitHub inside a box labeled Help.
   */
  const onFrameClick = useCallback(
    (e: MouseEvent) => {
      // Leave modified clicks alone: "open in a new tab" should still work.
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const anchor = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!anchor) return;
      // A bare "#id" is the page's own heading link; let it scroll itself.
      if ((anchor.getAttribute('href') ?? '').startsWith('#')) return;
      const next = helpTargetFromUrl(anchor.href);
      // Both, and in the capture phase above: Docusaurus is a React router
      // inside there, and its own click handler sits on the page root. Left to
      // bubble, that handler ran FIRST and did a client-side route change, so
      // the dialog's title and back stack were describing a page the frame had
      // already left.
      e.preventDefault();
      e.stopPropagation();
      if (next === null) {
        window.open(anchor.href, '_blank', 'noopener,noreferrer');
        return;
      }
      navigate(next);
    },
    [navigate],
  );

  /**
   * Runs on every frame load, which is every page change.
   *
   * The listener is attached to the frame's DOCUMENT, and a navigation replaces
   * that document, so the old listener goes with it; there is nothing to
   * detach.
   */
  const onFrameLoad = useCallback(() => {
    const doc = frameRef.current?.contentDocument;
    if (!doc) return;
    const html = doc.documentElement;
    html.setAttribute('data-astra-embed', '');
    // The app has no light mode. Docusaurus picks its theme from the system
    // preference before this runs (respectPrefersColorScheme), and on hydration
    // its color-mode provider READS these two attributes back rather than
    // re-deriving them, so setting both holds the page at dark for good.
    html.setAttribute('data-theme', 'dark');
    html.setAttribute('data-theme-choice', 'dark');
    doc.addEventListener('click', onFrameClick, true);

    /*
     * Scroll-spy.
     *
     * Same-origin, so the frame's own scrolling is readable from here; there is
     * no message passing and nothing injected into the docs. The last heading
     * to have passed the offset is the section you are in, which is the plain
     * reading of "where am I", and it is recomputed from live geometry rather
     * than tracked, so it stays right through an image loading late or a
     * details block opening.
     *
     * The listener is on the frame's window and a navigation replaces its
     * document, so it goes with the page it was set up for.
     */
    const win = doc.defaultView;
    if (win) {
      // Queried on every pass, not once at load: hydration can replace the
      // headings, and a detached one reports a zero rect, which reads as
      // scrolled past and puts the rail on the wrong section.
      const headings = () =>
        doc.querySelectorAll<HTMLElement>('.theme-doc-markdown h2[id], .theme-doc-markdown h3[id]');
      let queued = false;
      const spy = () => {
        if (queued) return;
        queued = true;
        win.requestAnimationFrame(() => {
          queued = false;
          let active = '';
          for (const mark of headings()) {
            if (mark.getBoundingClientRect().top > SPY_OFFSET_PX) break;
            active = `#${mark.id}`;
          }
          setActiveHash(active);
        });
      };
      win.addEventListener('scroll', spy, { passive: true });
      // Once now, so a page opened ON an anchor is highlighted before it is
      // touched.
      spy();
      const wanted = pendingAnchor.current;
      pendingAnchor.current = null;
      if (wanted !== null) hold(doc, win, wanted);
    }

    // Nothing is READ out of the frame. The heading and the rail come from the
    // served HTML instead (loadHelpPage), because what this document holds
    // depends on whether hydration has run yet, which a warm cache decides. All
    // this reports is that the page is on screen and can be revealed.
    loaded.current = target.src;
    setFrame(target.src);
  }, [onFrameClick, target.src, hold]);

  return { frameRef, ready, activeHash, navigate, onFrameLoad };
}
