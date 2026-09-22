import { DOC_LOCALES, docPageFileUrl, localDocsUrlFor } from './appInfo';

/**
 * Addressing and availability for the in-app Help dialog.
 *
 * The dialog is a second RENDERER over the Docusaurus site, not a second copy
 * of it: the deploy builds the site into `web/public/docs` and Vite ships it
 * inside the app, so these helpers only ever resolve a page to a URL on the
 * app's own origin. Nothing here knows anything about the content.
 *
 * Everything is addressed by "page", which is a docs slug with an optional
 * anchor: `''` (the docs index), `'safety'`, `'designing-a-rocket#fins'`. That
 * is the same slug vocabulary `docPageUrl` already uses for the external links,
 * so a UI control can name its topic once and get either.
 */

/**
 * The element Docusaurus mounts every page into.
 *
 * Used as proof that what came back really is a docs page. A dev server with no
 * docs in public/ answers an unknown path with the APP's index.html and a 200,
 * so `response.ok` on its own would put the app inside its own Help dialog.
 */
const DOCUSAURUS_MARKER = 'id="__docusaurus"';

export interface HelpTarget {
  /** Docs slug plus optional `#anchor`. */
  page: string;
  /** Slug alone, which is what addresses a file. */
  slug: string;
  /** `#anchor` or ''. */
  hash: string;
  /** The precached file URL for the slug. */
  fileUrl: string;
  /** What to point the iframe at: {@link fileUrl} plus the anchor. */
  src: string;
}

/** `'a/b#c'` into its slug and its anchor. */
function splitPage(page: string): { slug: string; hash: string } {
  const at = page.indexOf('#');
  return at < 0 ? { slug: page, hash: '' } : { slug: page.slice(0, at), hash: page.slice(at) };
}

/** Where a page lives for a UI language, without asking whether it is there. */
export function helpTarget(page: string, language: string): HelpTarget {
  const { slug, hash } = splitPage(page);
  const fileUrl = docPageFileUrl(localDocsUrlFor(language), slug);
  return { page, slug, hash, fileUrl, src: `${fileUrl}${hash}` };
}

/** A page that is in this build, read before the frame is pointed at it. */
export interface HelpPage {
  /** The article's own heading, which titles the dialog. */
  title: string;
  /** The page list and this page's headings, for the contents rail. */
  contents: HelpContents;
}

/**
 * Fetch a page and read what the dialog needs out of it, or null when it is not
 * in this build.
 *
 * Null covers the two ways it can be absent, which the dialog answers the same
 * way (offer the docs site):
 *
 *  - a DEV build. `web/public/docs` is gitignored and only written by the
 *    deploy job, so `npm run dev` has no docs unless `npm run docs:build` has
 *    been run. The marker check is what catches this, since Vite answers the
 *    missing path with the app's own shell rather than a 404.
 *  - offline with nothing cached, which throws rather than returning a status.
 *
 * On a deployed build this is a service-worker cache hit, because `fileUrl` is
 * the key the page is precached under (see {@link docPageFileUrl}), which is
 * what makes it affordable on every open.
 *
 * THE BUILT HTML, NOT THE LIVE FRAME, and that is the point of doing it here.
 * Docusaurus decides what to render from the window size, and the frame inside
 * the dialog is narrower than its 997px desktop breakpoint on every screen: on
 * hydration it takes the sidebar and the table of contents back OUT of the
 * document. Reading the live frame therefore worked or not depending on whether
 * hydration beat the load event, which a warm cache decides. The served HTML
 * has both, always, and it is already in hand.
 */
export async function loadHelpPage(target: HelpTarget): Promise<HelpPage | null> {
  let html: string;
  try {
    const res = await fetch(target.fileUrl);
    if (!res.ok) return null;
    html = await res.text();
  } catch {
    return null;
  }
  if (!html.includes(DOCUSAURUS_MARKER)) return null;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return {
    title: doc.querySelector('article h1')?.textContent?.trim() ?? '',
    contents: readContents(doc),
  };
}

/**
 * The page a link inside the rendered docs points at, or null when it leaves
 * the docs entirely (GitHub, the OpenRocket manual, the app itself).
 *
 * The dialog needs this because an in-iframe link is an ordinary absolute URL
 * into `/docs/`: followed as-is it would navigate the iframe to the DIRECTORY
 * form, which is the one that does not resolve offline. Turning it back into a
 * page lets the dialog re-open it as a file, so reading onward through the
 * guide keeps working with no signal.
 *
 * The locale segment is stripped rather than preserved, which is why this takes
 * no language: the dialog re-adds the one matching the app's current UI
 * language, so a Spanish reader who follows a link that happens to point at the
 * English tree stays in Spanish.
 */
export function helpTargetFromUrl(href: string): string | null {
  let url: URL;
  try {
    url = new URL(href, window.location.href);
  } catch {
    return null;
  }
  if (url.origin !== window.location.origin) return null;

  // English is served at the docs root, so this is the root for every locale.
  const root = localDocsUrlFor('en');
  if (!url.pathname.startsWith(root)) return null;

  let rest = url.pathname.slice(root.length);
  const locale = rest.split('/')[0] ?? '';
  if (DOC_LOCALES.has(locale)) rest = rest.slice(locale.length + 1);

  const slug = rest.replace(/index\.html$/, '').replace(/^\/+|\/+$/g, '');
  return `${slug}${url.hash}`;
}

/** One row of the Help dialog's contents rail. */
export interface HelpEntry {
  /** The page to open, or null for a category label that is not itself a page. */
  page: string | null;
  label: string;
  /** 1 for a top-level category, 2 for a page beneath one. */
  level: number;
}

/** One heading within the page being read. */
export interface HelpHeading {
  /** `#anchor`, appended to the current slug to make a page. */
  hash: string;
  label: string;
  /** 1 for a top-level heading, 2 for one nested under it. */
  level: number;
}

export interface HelpContents {
  /** Every page in the docs, in sidebar order. */
  pages: HelpEntry[];
  /** The headings of the page this was read from. */
  headings: HelpHeading[];
}

/**
 * The contents of the docs, read out of a rendered page.
 *
 * Docusaurus builds the sidebar into every page, so one page carries the whole
 * list. The embed stylesheet hides the site's own copy and the dialog draws its
 * rail from this instead, because the site's sidebar is gone below 997px and
 * the frame is always narrower than that, and because a rail the app draws is
 * one the app can style and can nest the current page's headings inside.
 *
 * Fed the document {@link loadHelpPage} parses from the served HTML, never the
 * live frame: see the note there.
 *
 * Reading it from the page rather than generating a list at build time keeps
 * the one-source rule: the order, the grouping and the labels are whatever
 * `sidebars.ts` says, already translated into the locale the frame is showing.
 *
 * WITH ONE CONDITION, which `sidebars.ts` carries a note about: a COLLAPSED
 * category's children are rendered into no page at all, so the rail would be
 * missing that whole group. Every category is `collapsed: false` there for this
 * reason, and an e2e spec reaches into the last one to keep it that way.
 */
export function readContents(doc: Document): HelpContents {
  const pages: HelpEntry[] = [];
  for (const li of doc.querySelectorAll('.theme-doc-sidebar-menu li')) {
    const level = Number(/-level-(\d+)/.exec(li.className)?.[1] ?? 0);
    // The category's own anchor sits in a wrapper div BEFORE any nested list,
    // so document order picks the right one for either kind of row.
    const anchor = li.querySelector('a[href]');
    const label = anchor?.textContent?.trim();
    if (!anchor || !label || !level) continue;
    // A category links to its own first child, so treating it as a page would
    // put the same page in the rail twice. It is a label.
    const isCategory = li.classList.contains('theme-doc-sidebar-item-category');
    // getAttribute, not .href: a document from DOMParser has no base URL, so
    // the resolved property would be empty. The sidebar links are absolute
    // paths, and helpTargetFromUrl resolves them against the app's location.
    const page = isCategory ? null : helpTargetFromUrl(anchor.getAttribute('href') ?? '');
    if (!isCategory && page === null) continue;
    pages.push({ page, label, level });
  }

  // The ARTICLE's own headings, not the site's table-of-contents widget.
  //
  // Docusaurus renders that widget on window size: the desktop one unmounts
  // below 997px, and the frame inside this dialog is narrower than that on
  // every screen, so reading it gave an empty list on a page full of headings.
  // The headings themselves are content. They carry the same ids the widget
  // linked to, and they are there at any width and either side of hydration.
  const headings: HelpHeading[] = [];
  for (const h of doc.querySelectorAll('.theme-doc-markdown h2[id], .theme-doc-markdown h3[id]')) {
    // Each heading ends with Docusaurus's own anchor link, which contributes a
    // stray glyph to textContent.
    const label = [...h.childNodes]
      .filter((n) => !(n instanceof Element && n.classList.contains('hash-link')))
      .map((n) => n.textContent ?? '')
      .join('')
      .trim();
    if (!label) continue;
    headings.push({ hash: `#${h.id}`, label, level: h.tagName === 'H2' ? 1 : 2 });
  }

  return { pages, headings };
}
