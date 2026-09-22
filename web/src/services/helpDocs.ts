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

/**
 * Whether a page is actually in this build, and can be shown.
 *
 * Resolves to null for the two ways it can be absent, which the dialog treats
 * the same way (fall back to the docs site):
 *
 *  - a DEV build. `web/public/docs` is gitignored and only written by the
 *    deploy job, so `npm run dev` has no docs unless `npm run docs:build` has
 *    been run. The marker check is what catches this, since Vite answers the
 *    missing path with the app's own shell rather than a 404.
 *  - offline with nothing cached, which throws rather than returning a status.
 *
 * On a deployed build this is a service-worker cache hit, because `fileUrl` is
 * the key the page is precached under (see {@link docPageFileUrl}). That is why
 * the probe is affordable on every open.
 */
export async function helpPageExists(target: HelpTarget): Promise<boolean> {
  try {
    const res = await fetch(target.fileUrl);
    if (!res.ok) return false;
    return (await res.text()).includes(DOCUSAURUS_MARKER);
  } catch {
    return false;
  }
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
 * Docusaurus puts the WHOLE sidebar into every page it builds, and the current
 * page's heading list beside it, so both are already in the frame's DOM. The
 * embed stylesheet hides them and the dialog draws its own rail from this
 * instead, for two reasons: the site's sidebar is `display:none` below 997px,
 * which is exactly the phone at a launch site where being able to find a topic
 * matters most, and a rail the app draws is a rail the app can style and can
 * put the current page's headings inside.
 *
 * Reading it from the page rather than generating a list at build time keeps
 * the one-source rule: the order, the grouping and the labels are whatever
 * `sidebars.ts` says, already translated into the locale the frame is showing.
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
    const page = isCategory ? null : helpTargetFromUrl((anchor as HTMLAnchorElement).href);
    if (!isCategory && page === null) continue;
    pages.push({ page, label, level });
  }

  const headings: HelpHeading[] = [];
  for (const anchor of doc.querySelectorAll('.table-of-contents a[href^="#"]')) {
    const label = anchor.textContent?.trim();
    const hash = (anchor as HTMLAnchorElement).hash;
    if (!label || !hash) continue;
    // Depth by nesting: the root list carries `table-of-contents`, and a
    // sub-heading sits in a plain <ul> inside it.
    let level = 0;
    for (let el = anchor.parentElement; el; el = el.parentElement) {
      if (el.tagName === 'UL') level++;
      if (el.classList.contains('table-of-contents')) break;
    }
    headings.push({ hash, label, level });
  }

  return { pages, headings };
}
