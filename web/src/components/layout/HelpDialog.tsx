import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { appName, docPageUrl, helpUrlFor } from '../../services/appInfo';
import {
  type HelpContents,
  helpPageExists,
  helpTarget,
  helpTargetFromUrl,
  readContents,
} from '../../services/helpDocs';
import { useFocusTrap } from '../common/useFocusTrap';

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

/** A rail row: the page list and the heading list share their look. */
const railRow =
  'block w-full truncate rounded px-2 py-1 text-left text-xs text-slate-300 hover:bg-slate-800 hover:text-slate-100';

export function HelpDialog({ page, onClose }: { page: string; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const panelRef = useFocusTrap<HTMLDivElement>(true, { onEscape: onClose });
  const frameRef = useRef<HTMLIFrameElement>(null);

  // `page` is only the ENTRY point: whoever opened Help named a topic.
  // Navigation from INSIDE the frame moves `current` and pushes onto `stack`.
  // A fresh openHelp() from elsewhere in the app remounts this component
  // (HeaderDialogs keys it on the page), so there is no effect resetting them.
  const [current, setCurrent] = useState(page);
  const [stack, setStack] = useState<string[]>([]);

  const target = useMemo(() => helpTarget(current, i18n.language), [current, i18n.language]);

  // Both of these are TAGGED with the src they describe rather than being reset
  // when the page changes. A stale tag simply stops matching, so the derived
  // status below falls back to 'probing' on its own, and nothing has to set
  // state from inside an effect to clear it.
  const [probe, setProbe] = useState<{ src: string; ok: boolean } | null>(null);
  // Heading read off the loaded page, so the dialog says which doc this is
  // rather than repeating "Help" over a page about fins.
  const [frame, setFrame] = useState<{ src: string; title: string } | null>(null);
  // The contents rail. STICKY across a page change, unlike the two above: the
  // page list is identical on every page, so clearing it would make the rail
  // blink out and back on every click inside it. Only the headings belong to
  // one page, which is what the src tag is for.
  const [contents, setContents] = useState<{ src: string; value: HelpContents } | null>(null);
  const [contentsOpen, setContentsOpen] = useState(isWide);

  // Ask whether the page is there BEFORE mounting the frame. On a deployed
  // build this is a service-worker cache hit, so it costs milliseconds; on a
  // dev build with no `web/public/docs` (it is gitignored and written by the
  // deploy job, or locally by `npm run docs:build`) it is what keeps the app
  // from being loaded inside its own Help dialog, because Vite answers the
  // missing path with the app's shell and a 200.
  useEffect(() => {
    let canceled = false;
    void helpPageExists(target).then((ok) => {
      if (!canceled) setProbe({ src: target.src, ok });
    });
    return () => {
      canceled = true;
    };
  }, [target]);

  const probed = probe?.src === target.src ? probe : null;
  const loaded = frame?.src === target.src ? frame : null;
  const status = probed === null ? 'probing' : !probed.ok ? 'missing' : loaded ? 'ready' : 'rendering';

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
    // The page's own <h1>, NOT document.title. The title is managed by
    // react-helmet, and on a warm load its hydration can run before this
    // handler does, during which the title is briefly the bare site name: the
    // dialog then headed a page about safety with "AstraRocketJs". The heading
    // in the article is static content and reads the same either side of
    // hydration.
    const h1 = doc.querySelector('article h1')?.textContent?.trim();
    setFrame({ src: target.src, title: h1 ?? '' });
    setContents({ src: target.src, value: readContents(doc) });
  }, [onFrameClick, target.src]);

  /** Open a page from the rail, and on a phone get the rail out of the way. */
  const pick = useCallback(
    (next: string) => {
      navigate(next);
      if (!isWide()) setContentsOpen(false);
    },
    [navigate],
  );

  // The same page on the published site: what you send someone, and the way out
  // of the dialog for anything it renders badly. Empty when the build has no
  // docs URL at all (see docPageUrl).
  const siteHref = docPageUrl(helpUrlFor(i18n.language), target.slug);
  const heading = loaded?.title || t('help.title');
  // Headings belong to the page they were read from; the page list does not.
  const headings = contents?.src === target.src ? contents.value.headings : [];

  return (
    <div className="dialog-overlay fixed inset-0 z-[60] grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div
        ref={panelRef}
        className="dialog-panel flex h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-slate-900 ring-1 ring-white/10"
        role="dialog"
        aria-modal="true"
        aria-label={t('help.title')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
          {/* Rendered only once a page has loaded and brought its contents with
              it: with nothing to list, this would be a control that looks
              clickable and does nothing. */}
          {contents && (
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
          <h2 className="min-w-0 flex-1 truncate text-lg font-semibold text-slate-100">{heading}</h2>
          {siteHref && (
            <a
              href={siteHref}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 rounded-lg bg-slate-800 px-2 py-1 text-xs text-slate-300 ring-1 ring-white/10 hover:bg-slate-700"
            >
              {t('help.openOnSite')}
            </a>
          )}
          <button
            onClick={onClose}
            aria-label={t('help.close')}
            className="shrink-0 rounded-lg bg-slate-800 px-2 py-1 text-sm text-slate-300 ring-1 ring-white/10 hover:bg-slate-700"
          >
            ✕
          </button>
        </div>

        <div className="relative flex min-h-0 flex-1">
          {/* The contents rail. In the flex row from `md` up; below it, an
              overlay over the page, because at phone width there is no room
              for both and the phone is where finding a topic matters most.
              (The docs site's own sidebar is display:none below 997px, which is
              the reason the dialog draws its own instead of revealing that one.) */}
          {contents && contentsOpen && (
            <nav
              aria-label={t('help.contents')}
              className="absolute inset-y-0 left-0 z-10 w-56 shrink-0 overflow-y-auto border-r border-white/10 bg-slate-900 p-2 md:static md:z-auto"
            >
              {contents.value.pages.map((entry, i) =>
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
                    {/* The page you are ON opens into its own headings, so the
                        rail answers both "what else is there" and "where in
                        this page". Picking one goes through the same
                        same-slug-scroll path a heading link inside the frame
                        takes. */}
                    {entry.page === target.slug &&
                      headings.map((h) => (
                        <button
                          key={h.hash}
                          onClick={() => pick(`${target.slug}${h.hash}`)}
                          className={`${railRow} ${h.level > 1 ? 'pl-8' : 'pl-5'} text-slate-400`}
                        >
                          {h.label}
                        </button>
                      ))}
                  </Fragment>
                ),
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
      </div>
    </div>
  );
}
