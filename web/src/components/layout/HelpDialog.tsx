import { Fragment, type KeyboardEvent, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { appName, docPageUrl, helpUrlFor } from '../../services/app/appInfo';
import {
  type HelpEntry,
  type HelpPage,
  helpTarget,
  helpTargetFromUrl,
  loadHelpPage,
} from '../../services/app/helpDocs';
import {
  type HelpHit,
  clearMarks,
  helpIndex,
  markMatches,
  searchHelp,
  searchTokens,
  splitHighlight,
} from '../../services/app/helpSearch';
import { Dialog } from '../common/Dialog';

/**
 * Help, read WITHOUT leaving the design you are holding.
 *
 * This is a second RENDERER over the Docusaurus site, never a copy of it. The
 * deploy builds that site into `web/public/docs` before the app build, so the
 * pages shown here are byte for byte the pages published at the docs URL; what
 * this adds is a frame around them. The docs stay one source, and the external
 * link stays in the menu too, because a docs site you can send someone is not
 * replaceable by a dialog.
 *
 * WHY AN IFRAME of the built HTML, rather than rendering the source markdown:
 * the markdown route needs Docusaurus to emit its sources (it does not), a
 * markdown renderer in the bundle, MDX and admonition handling, a generated
 * slug index, and the translated sources as well. That is a second rendering
 * pipeline, which is the drift the "one source" rule exists to prevent. The
 * built HTML is same-origin, so the site's own chrome is stripped by an embed
 * stylesheet that ships WITH the docs (website/src/css/custom.css), and code
 * highlighting, admonitions and images are simply already right.
 *
 * WHY IT WORKS OFFLINE: it loads `docs/<slug>/index.html`, which is the exact
 * key the service worker precaches each page under. Navigating to
 * `docs/<slug>/` is the form that does NOT resolve from the precache (see
 * docPageFileUrl), so every link inside the frame is intercepted below and
 * re-opened as a file instead of being followed.
 */
/**
 * Is the dialog wide enough to keep the contents rail BESIDE the page?
 *
 * 768px, the same `md:` breakpoint the rail's own classes switch on. Below it
 * the rail overlays the text, because a 224px rail inside a phone-width dialog
 * would leave the page about a hundred pixels to render in.
 */
const isWide = () => window.matchMedia('(min-width: 768px)').matches;

/**
 * How far down the frame a heading has to have moved before the rail calls
 * it the one you are reading.
 *
 * Not zero: a heading sitting a few pixels below the top is the one you are
 * about to read, not the one you are in, and at zero the highlight flickered
 * between two rows on any slow scroll across a boundary.
 */
const SPY_OFFSET_PX = 96;

/** A rail row: the page list and the heading list share their look. */
const railRow =
  'block w-full truncate rounded px-2 py-1 text-left text-xs text-slate-300 hover:bg-slate-800 hover:text-slate-100';

/**
 * How long a pause in typing means "search for that".
 *
 * A search is not free the way filtering a list in memory is: the first one
 * fetches every page to build the index, and each one after that scans every
 * section of every page. Neither is worth doing for the prefixes on the way to
 * a word.
 */
const SEARCH_DEBOUNCE_MS = 200;

/**
 * The shortest query worth running.
 *
 * One letter matches most of the guide, so the result would be a list too long
 * to read, built at the cost of the whole index.
 */
const SEARCH_MIN_CHARS = 2;

/** Text with the searched-for words marked, for a result row. */
function Marked({ text, tokens }: { text: string; tokens: string[] }) {
  return (
    <>
      {splitHighlight(text, tokens).map((segment, i) =>
        segment.hit ? (
          <mark key={i} className="rounded bg-amber-300/25 text-amber-100">
            {segment.text}
          </mark>
        ) : (
          <Fragment key={i}>{segment.text}</Fragment>
        ),
      )}
    </>
  );
}

export function HelpDialog({ page, onClose }: { page: string; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const frameRef = useRef<HTMLIFrameElement>(null);

  // `page` is only the ENTRY point: whoever opened Help named a topic.
  // Navigation from INSIDE the frame moves `current` and pushes onto `stack`.
  // A fresh openHelp() from elsewhere in the app remounts this component
  // (HeaderDialogs keys it on the page), so there is no effect resetting them.
  const [current, setCurrent] = useState(page);
  const [stack, setStack] = useState<string[]>([]);

  const target = useMemo(() => helpTarget(current, i18n.language), [current, i18n.language]);

  // Both are TAGGED with the src they describe rather than being reset when the
  // page changes. A stale tag simply stops matching, so the derived status
  // below falls back to 'probing' on its own, and nothing has to set state from
  // inside an effect to clear it.
  //
  // `probe` is the page read out of the SERVED HTML: whether it is there at
  // all, its heading, and the contents rail. `frame` is only the iframe
  // reporting that it has finished loading that same page.
  const [probe, setProbe] = useState<{ src: string; page: HelpPage | null } | null>(null);
  const [frame, setFrame] = useState<string | null>(null);
  // The page list, kept across a page change unlike everything else here: it is
  // identical on every page, so clearing it would blink the rail out and back
  // on every click inside it.
  const [pages, setPages] = useState<HelpEntry[]>([]);
  const [contentsOpen, setContentsOpen] = useState(isWide);
  // The heading the frame is scrolled to, so the rail follows you down a page
  // instead of only saying what is on it. '' above the first heading, which is
  // honest: you are not in a section yet.
  const [activeHash, setActiveHash] = useState('');
  const activeRow = useRef<HTMLButtonElement>(null);

  // Search. `query` is what has been typed; `found` is the answer for a query,
  // TAGGED with it the same way the probe is tagged with its src, so a result
  // list for a query that has since been edited stops matching instead of having
  // to be cleared. `highlight` is the words to mark inside the frame, which is
  // set by OPENING a result rather than by typing: marking the page you happen
  // to be reading as you type would be the dialog rearranging itself under you.
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<{ query: string; hits: HelpHit[] } | null>(null);
  const [highlight, setHighlight] = useState<string[]>([]);
  const trimmed = query.trim();
  const resultsId = useId();

  // Keep the current heading in view in the rail itself. On a long page the row
  // the frame has reached can easily be scrolled out of a 17-page list, and a
  // highlight you cannot see is not one that follows you.
  useEffect(() => {
    activeRow.current?.scrollIntoView({ block: 'nearest' });
  }, [activeHash]);

  // Ask whether the page is there BEFORE mounting the frame. On a deployed
  // build this is a service-worker cache hit, so it costs milliseconds; on a
  // dev build with no `web/public/docs` (it is gitignored and written by the
  // deploy job, or locally by `npm run docs:build`) it is what keeps the app
  // from being loaded inside its own Help dialog, because Vite answers the
  // missing path with the app's shell and a 200.
  useEffect(() => {
    let canceled = false;
    void loadHelpPage(target).then((page) => {
      if (canceled) return;
      setProbe({ src: target.src, page });
      if (page && page.contents.pages.length) setPages(page.contents.pages);
    });
    return () => {
      canceled = true;
    };
  }, [target]);

  /*
   * Search the whole guide, after a pause in typing.
   *
   * `pages` is the dependency that matters: it is the rail's own page list, so
   * search covers exactly what the dialog can open and is only possible once a
   * page has loaded and brought that list with it. On a build with no docs it
   * stays empty, and the search box is not rendered at all.
   */
  useEffect(() => {
    // Nothing is cleared on the way out: `found` carries the query it answers,
    // so an answer for a query that has since been shortened simply stops
    // matching, the same way the probe's src tag works above.
    if (trimmed.length < SEARCH_MIN_CHARS || pages.length === 0) return;
    let canceled = false;
    const timer = window.setTimeout(() => {
      // The index is built on the first search and kept for the session; this
      // resolves immediately on every search after it.
      void helpIndex(pages, i18n.language).then((docs) => {
        if (!canceled) setFound({ query: trimmed, hits: searchHelp(docs, trimmed) });
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      canceled = true;
      window.clearTimeout(timer);
    };
  }, [trimmed, pages, i18n.language]);

  const probed = probe?.src === target.src ? probe : null;
  const ready = frame === target.src;
  const status = probed === null ? 'probing' : !probed.page ? 'missing' : ready ? 'ready' : 'rendering';

  const navigate = useCallback(
    (next: string) => {
      const to = helpTarget(next, i18n.language);
      if (to.slug === target.slug) {
        // Only the anchor moved. Scrolling the frame beats reloading a page it
        // is already showing.
        const doc = frameRef.current?.contentDocument;
        const id = to.hash ? decodeURIComponent(to.hash.slice(1)) : '';
        const el = id ? doc?.getElementById(id) : null;
        if (el) el.scrollIntoView();
        else doc?.defaultView?.scrollTo(0, 0);
        return;
      }
      setStack((s) => [...s, current]);
      setCurrent(next);
    },
    [current, i18n.language, target.slug],
  );

  const goBack = useCallback(() => {
    const prev = stack[stack.length - 1];
    if (prev === undefined) return;
    setCurrent(prev);
    setStack(stack.slice(0, -1));
  }, [stack]);

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
      const marks = [...doc.querySelectorAll<HTMLElement>('.theme-doc-markdown h2[id], .theme-doc-markdown h3[id]')];
      let queued = false;
      const spy = () => {
        if (queued) return;
        queued = true;
        win.requestAnimationFrame(() => {
          queued = false;
          let active = '';
          for (const mark of marks) {
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
    }

    // Nothing is READ out of the frame. The heading and the rail come from the
    // served HTML instead (loadHelpPage), because what this document holds
    // depends on whether hydration has run yet, which a warm cache decides. All
    // this reports is that the page is on screen and can be revealed.
    setFrame(target.src);
  }, [onFrameClick, target.src]);

  /** Open a page from the rail, and on a phone get the rail out of the way. */
  const pick = useCallback(
    (next: string) => {
      navigate(next);
      if (!isWide()) setContentsOpen(false);
    },
    [navigate],
  );

  /** Open a result: the page it is on, with the words that found it marked. */
  const openHit = useCallback(
    (hit: HelpHit) => {
      setHighlight(searchTokens(trimmed));
      pick(hit.page);
    },
    [pick, trimmed],
  );

  const clearSearch = useCallback(() => {
    setQuery('');
    setHighlight([]);
  }, []);

  /**
   * Mark the words inside the frame, and go to the first one.
   *
   * Not part of the load handler, because opening a second result on the SAME
   * page does not reload the frame: `navigate` scrolls it instead, so this is
   * keyed on the anchor as well as on the page. Marking is undone before each
   * re-run, which leaves the document as it was served.
   */
  useEffect(() => {
    const doc = frameRef.current?.contentDocument;
    const root = doc?.querySelector('article');
    if (!ready || !doc || !root) return;
    const marks = markMatches(root, highlight);
    const win = doc.defaultView;
    if (marks.length && win) {
      // The first match at or after the section the result named. The anchor
      // alone lands on the HEADING, which on a page like the glossary is a
      // letter with a hundred entries under it.
      const anchor = target.hash ? doc.getElementById(decodeURIComponent(target.hash.slice(1))) : null;
      const from = anchor ? anchor.getBoundingClientRect().top + win.scrollY : 0;
      const at = marks.find((mark) => mark.getBoundingClientRect().top + win.scrollY >= from) ?? marks[0]!;
      at.scrollIntoView({ block: 'center' });
    }
    return () => clearMarks(root);
  }, [ready, highlight, target.hash, target.src]);

  // The same page on the published site: what you send someone, and the way out
  // of the dialog for anything it renders badly. Empty when the build has no
  // docs URL at all (see docPageUrl).
  const siteHref = docPageUrl(helpUrlFor(i18n.language), target.slug);
  const heading = probed?.page?.title || t('help.title');
  // Headings belong to the page they were read from; the page list does not.
  const headings = probed?.page?.contents.headings ?? [];

  // An answer counts only while it still describes what is in the box; between
  // an edit and the next answer the rail says it is working, rather than
  // showing results for a query that is no longer there.
  const results = found?.query === trimmed ? found.hits : null;
  const searching = results === null && trimmed.length >= SEARCH_MIN_CHARS;
  const hitTokens = useMemo(() => searchTokens(trimmed), [trimmed]);

  const onSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape' && query !== '') {
      // Clear the search instead of closing the dialog. Escape closes every
      // modal in the app (useFocusTrap's window listener), and stopping it here
      // is the narrow exception: the reason you are in a search box is that you
      // have not found the thing yet, so shutting the guide is the wrong answer.
      e.stopPropagation();
      clearSearch();
      return;
    }
    if (e.key !== 'Enter') return;
    const top = results?.[0];
    if (top) openHit(top);
  };

  const pageRows = pages.map((entry, i) =>
    entry.page === null ? (
      <p
        key={`group-${i}`}
        className="mt-3 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500 first:mt-0"
      >
        {entry.label}
      </p>
    ) : (
      <Fragment key={entry.page}>
        <button
          onClick={() => pick(entry.page!)}
          aria-current={entry.page === target.slug ? 'page' : undefined}
          className={`${railRow} ${entry.page === target.slug ? 'bg-slate-800 font-semibold text-sky-300' : ''}`}
        >
          {entry.label}
        </button>
        {/* The page you are ON opens into its own headings, so the rail answers
            both "what else is there" and "where in this page". Picking one goes
            through the same same-slug-scroll path a heading link inside the
            frame takes. */}
        {entry.page === target.slug &&
          headings.map((h) => (
            <button
              key={h.hash}
              ref={h.hash === activeHash ? activeRow : undefined}
              onClick={() => pick(`${target.slug}${h.hash}`)}
              aria-current={h.hash === activeHash ? 'location' : undefined}
              className={`${railRow} ${h.level > 1 ? 'pl-8' : 'pl-5'} ${
                h.hash === activeHash ? 'bg-slate-800 text-sky-300' : 'text-slate-400'
              }`}
            >
              {h.label}
            </button>
          ))}
      </Fragment>
    ),
  );

  return (
    <Dialog
      id="help"
      // The PAGE's title, not the word Help: the dialog is a reader and which
      // page you are on is the thing worth saying. It is also the accessible
      // name, so a screen reader announces the same.
      title={heading}
      // The dialog stays "Help" to assistive tech while the heading above moves
      // with the page: this is the one dialog you navigate WITHIN, and a name
      // that changed under you as you followed a link would be worse than one
      // naming the frame.
      name={t('help.title')}
      // Only once a real page title is showing. Before one loads the heading IS
      // "Help", and an eyebrow saying so again just prints the word twice.
      eyebrow={probed?.page?.title ? t('help.title') : undefined}
      onClose={onClose}
      // Reachable from a dialog's own help link, so it has to sit above one.
      layer="over"
      size="4xl"
      // An iframe cannot usefully be scrolled by its container: it takes the
      // height and scrolls its own document.
      layout="fill"
      leading={
        <>
          {/* Rendered only once a page has loaded and brought its contents with
              it: with nothing to list, this would be a control that looks
              clickable and does nothing. */}
          {pages.length > 0 && (
            <button
              onClick={() => setContentsOpen((o) => !o)}
              aria-expanded={contentsOpen}
              aria-label={t('help.contents')}
              title={t('help.contents')}
              className="shrink-0 rounded-lg bg-slate-800 px-2 py-1 text-sm text-slate-300 ring-1 ring-white/10 hover:bg-slate-700"
            >
              ☰
            </button>
          )}
          <button
            onClick={goBack}
            disabled={stack.length === 0}
            aria-label={t('help.back')}
            title={t('help.back')}
            className="shrink-0 rounded-lg bg-slate-800 px-2 py-1 text-sm text-slate-300 ring-1 ring-white/10 hover:bg-slate-700 disabled:cursor-not-allowed disabled:text-slate-600 disabled:hover:bg-slate-800"
          >
            &lsaquo;
          </button>
        </>
      }
      actions={
        siteHref && (
          <a
            href={siteHref}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t('help.openOnSite')}
            title={t('help.openOnSite')}
            className="shrink-0 rounded-lg bg-slate-800 px-2 py-1 text-xs text-slate-300 ring-1 ring-white/10 hover:bg-slate-700"
          >
            {/* The label costs about 130px, and at phone width the header
                already carries four controls; below `sm` the glyph stands in
                for it, with the same accessible name either way. */}
            <span className="hidden sm:inline">{t('help.openOnSite')}</span>
            <span className="sm:hidden" aria-hidden>
              ↗
            </span>
          </a>
        )
      }
    >
      <div className="relative flex min-h-0 flex-1">
        {/* The contents rail. In the flex row from `md` up; below it, an
              overlay over the page, because at phone width there is no room
              for both and the phone is where finding a topic matters most.
              (The docs site's own sidebar is display:none below 997px, which is
              the reason the dialog draws its own instead of revealing that one.) */}
        {pages.length > 0 && contentsOpen && (
          <nav
            aria-label={t('help.contents')}
            className="absolute inset-y-0 left-0 z-10 w-56 shrink-0 overflow-y-auto border-r border-white/10 bg-slate-900 p-2 md:static md:z-auto"
          >
            {/* Search the whole guide, not this page: the index is every page
                the rail lists. It sits in the rail because that is where the
                question "where is this?" is already answered, and because the
                dialog header carries four controls at phone width already. */}
            <div className="mb-2 flex items-center gap-1">
              <input
                // Not type="search": the browsers that draw their own clear
                // glyph for it draw a second one beside the button below.
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onSearchKey}
                placeholder={t('help.search')}
                aria-label={t('help.search')}
                enterKeyHint="search"
                className="min-w-0 flex-1 rounded bg-slate-800 px-2 py-1 text-xs text-slate-200 ring-1 ring-white/10 placeholder:text-slate-500 focus:outline-none focus:ring-sky-500"
              />
              {query !== '' && (
                <button
                  onClick={clearSearch}
                  aria-label={t('help.searchClear')}
                  title={t('help.searchClear')}
                  className="shrink-0 rounded px-1.5 py-1 text-xs text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                >
                  ✕
                </button>
              )}
            </div>

            {results !== null ? (
              results.length === 0 ? (
                <p className="px-2 py-3 text-xs text-slate-400">{t('help.searchNone', { query: trimmed })}</p>
              ) : (
                // Grouped, and named by its own count line: the rail holds two
                // lists that look alike, and this is what says which one is on
                // screen to a screen reader and to a test.
                <div role="group" aria-labelledby={resultsId}>
                  <p
                    id={resultsId}
                    className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500"
                  >
                    {t('help.searchMatches', { n: results.length })}
                  </p>
                  {results.map((hit) => (
                    <button
                      key={hit.page}
                      onClick={() => openHit(hit)}
                      className="mb-1 block w-full rounded px-2 py-1 text-left hover:bg-slate-800"
                    >
                      {/* The section, then the page it is in: a result is a
                          place in the guide, and the section is the part of that
                          you were looking for. A page's lead text has no heading
                          of its own, so the page name stands in. */}
                      <span className="block truncate text-xs font-semibold text-slate-200">
                        <Marked text={hit.heading || hit.label} tokens={hitTokens} />
                      </span>
                      {hit.heading !== '' && (
                        <span className="block truncate text-[10px] text-slate-500">{hit.label}</span>
                      )}
                      <span className="mt-0.5 block text-[10px] leading-snug text-slate-400">
                        <Marked text={hit.snippet} tokens={hitTokens} />
                      </span>
                    </button>
                  ))}
                </div>
              )
            ) : searching ? (
              <p className="px-2 py-3 text-xs text-slate-500">{t('help.searchBusy')}</p>
            ) : (
              pageRows
            )}
          </nav>
        )}

        <div className="relative min-h-0 flex-1">
          {status === 'missing' ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
              <p className="text-sm text-slate-300">{t('help.missing', { name: appName() })}</p>
              {siteHref && (
                <a
                  href={siteHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500"
                >
                  {t('help.openOnSite')}
                </a>
              )}
            </div>
          ) : (
            <>
              {status !== 'ready' && (
                <p className="absolute inset-0 grid place-items-center text-sm text-slate-500">{t('help.loading')}</p>
              )}
              {status !== 'probing' && (
                <iframe
                  ref={frameRef}
                  src={target.src}
                  title={t('help.title')}
                  onLoad={onFrameLoad}
                  // Hidden until the theme and the embed attribute are on,
                  // otherwise a light-mode machine shows a white flash of the
                  // full site chrome before the first paint of the stripped one.
                  className={`h-full w-full border-0 ${status === 'ready' ? '' : 'opacity-0'}`}
                />
              )}
            </>
          )}
        </div>
      </div>
    </Dialog>
  );
}
