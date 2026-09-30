import { type HelpEntry, fetchHelpDocument, headingLabel, helpTarget } from './helpDocs';

/**
 * Search across the docs that ship INSIDE the app, for the Help dialog.
 *
 * The published site has its own search (a Docusaurus plugin), and the dialog
 * cannot use it: the embed stylesheet hides the site's navbar, which is where
 * that plugin puts its search box, and its index is a file deliberately kept
 * OUT of the app's precache for its size. So the dialog searches the same thing
 * it already renders, the built pages under `docs/<slug>/index.html`.
 *
 * WHICH MAKES IT OFFLINE BY CONSTRUCTION. Those files are the exact keys the
 * service worker precaches each page under, so an index built from them is
 * built from cache hits, with no index file to ship and nothing that can go
 * stale against the pages it describes. Nothing here is generated at build
 * time, so there is no second source to drift from the docs.
 *
 * It is built LAZILY, on the first search, because it costs one fetch per page
 * and most Help visits are a read rather than a hunt, and kept for the session.
 */

/** One searchable slice of a page: the text under one heading. */
export interface HelpSection {
  /** `#anchor`, or '' for the text above the first heading. */
  hash: string;
  /** The heading's own words, or '' for that lead text. */
  heading: string;
  /** The section's visible text, whitespace collapsed. */
  text: string;
}

/** One indexed page. */
export interface HelpDoc {
  /** The docs slug, which is what the dialog navigates by. */
  slug: string;
  /** The sidebar's label for the page, already in the reader's language. */
  label: string;
  /** The page's own h1. */
  title: string;
  sections: HelpSection[];
}

/** One result row. */
export interface HelpHit {
  /** `slug` or `slug#anchor`: the page to open. */
  page: string;
  /** The page it is in. */
  label: string;
  /** The section it is in, '' for the lead. */
  heading: string;
  /** A window of the section's text around the first match. */
  snippet: string;
  score: number;
}

/** How many rows the rail will show. */
const HIT_LIMIT = 60;

/** How much of a section to quote around the match. */
const SNIPPET_CHARS = 170;

/**
 * Case- and accent-insensitive text, POSITION FOR POSITION with its input.
 *
 * A plain `normalize('NFD')` would do the folding, but it changes the string's
 * length, and the snippet and the highlighter both need an index found in the
 * folded text to point at the same character of the original. So each character
 * is folded on its own, and anything that would not fold to exactly one
 * character is left alone: `ñ` becomes `n`, and the handful of characters whose
 * lowercase is longer than themselves stay as they are rather than shifting
 * every index after them.
 */
export function fold(s: string): string {
  let out = '';
  for (const ch of s) {
    const base = ch.normalize('NFD')[0] ?? ch;
    const low = base.toLowerCase();
    out += low.length === 1 ? low : ch;
  }
  return out;
}

/** The words of a query, folded. Punctuation is a separator, not a term. */
export function searchTokens(query: string): string[] {
  return fold(query)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 0);
}

/** Runs of whitespace in extracted text are not meaningful. */
const collapse = (s: string) => s.replace(/\s+/g, ' ').trim();

/**
 * A rendered page split into the sections its headings define.
 *
 * Split at h2 and h3 with an id, which are exactly the headings the rail
 * already lists and the only ones the dialog can navigate to, so every hit has
 * somewhere to land. Text under an h4 or deeper is searchable as part of the
 * section it sits in.
 *
 * Fed the document parsed from the SERVED HTML, like everything else the dialog
 * reads: see the note on loadHelpPage. Here it also means the whole page is
 * indexed whether or not it has ever been rendered.
 */
export function readSections(doc: Document): HelpSection[] {
  const root = doc.querySelector('.theme-doc-markdown');
  if (!root) return [];

  const sections: HelpSection[] = [{ hash: '', heading: '', text: '' }];
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as Element;
      // A heading OPENS a section rather than joining one. The h1 is the page
      // title, which is indexed separately, and a heading with no id cannot be
      // linked to, so its text stays with the section it sits in.
      if ((el.tagName === 'H2' || el.tagName === 'H3') && el.id) {
        sections.push({ hash: `#${el.id}`, heading: headingLabel(el), text: '' });
      }
      continue;
    }
    // Heading text is already held as a heading; taking it again would double
    // every heading's score and would put Docusaurus's own anchor glyph into
    // the snippets.
    if (node.parentElement?.closest('h1, h2, h3')) continue;
    const at = sections[sections.length - 1]!;
    at.text += node.nodeValue ?? '';
  }

  for (const section of sections) section.text = collapse(section.text);
  return sections.filter((section) => section.heading !== '' || section.text !== '');
}

/**
 * Every page in the docs, read for searching, cached per language.
 *
 * Keyed on the language alone: the pages within a build do not change, and two
 * locales are two different sets of files.
 */
const INDEXES = new Map<string, Promise<HelpDoc[]>>();

/** Forget the built indexes. For tests; nothing in the app needs it. */
export function resetHelpIndex(): void {
  INDEXES.clear();
}

async function buildIndex(pages: HelpEntry[], language: string): Promise<HelpDoc[]> {
  // The rail's own list is the page list, so the index covers exactly what the
  // dialog can open, labeled in the reader's language, with no second list to
  // maintain. A category row is a label pointing at its first child, so taking
  // it too would index that page twice.
  const slugs = new Map<string, string>();
  for (const entry of pages) {
    if (entry.page === null) continue;
    const slug = entry.page.split('#')[0] ?? '';
    if (!slugs.has(slug)) slugs.set(slug, entry.label);
  }

  const docs = await Promise.all(
    [...slugs].map(async ([slug, label]): Promise<HelpDoc | null> => {
      const doc = await fetchHelpDocument(helpTarget(slug, language).fileUrl);
      if (!doc) return null;
      const sections = readSections(doc);
      if (!sections.length) return null;
      return { slug, label, title: doc.querySelector('article h1')?.textContent?.trim() ?? label, sections };
    }),
  );
  return docs.filter((doc): doc is HelpDoc => doc !== null);
}

/**
 * The index for a language, built on first use.
 *
 * A build that came back with nothing is not kept: every page fetch answers
 * null rather than throwing (see fetchHelpDocument), so the empty result is
 * also what a first search launched with a cold cache and no signal looks like,
 * and caching that would leave search quietly broken for the session.
 */
export function helpIndex(pages: HelpEntry[], language: string): Promise<HelpDoc[]> {
  const cached = INDEXES.get(language);
  if (cached) return cached;
  const built = buildIndex(pages, language).then((docs) => {
    if (!docs.length) INDEXES.delete(language);
    return docs;
  });
  INDEXES.set(language, built);
  return built;
}

/** Where the first of any token appears in already-folded text, or -1. */
function firstMatch(folded: string, tokens: string[]): number {
  let at = -1;
  for (const token of tokens) {
    const i = folded.indexOf(token);
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  return at;
}

/** A word boundary at or before `i`, so a snippet does not start mid-word. */
function backToWord(text: string, i: number): number {
  const space = text.lastIndexOf(' ', i);
  return space < 0 ? 0 : space + 1;
}

/** A window of `text` around the first match, with an ellipsis where it was cut. */
export function snippetAround(text: string, tokens: string[]): string {
  if (text.length <= SNIPPET_CHARS) return text;
  const at = firstMatch(fold(text), tokens);
  // No token in the body means the match was in the heading or the page title;
  // the opening of the section is then the useful quote.
  if (at < 0) return `${text.slice(0, backToWord(text, SNIPPET_CHARS)).trimEnd()}…`;

  const start = backToWord(text, Math.max(0, at - Math.floor(SNIPPET_CHARS / 3)));
  const end = start + SNIPPET_CHARS;
  const cut = end >= text.length ? text.length : backToWord(text, end) - 1;
  return `${start > 0 ? '…' : ''}${text.slice(start, cut).trim()}${cut < text.length ? '…' : ''}`;
}

/**
 * Rank every section that holds ALL of the query's words.
 *
 * All of them, not any: two words typed together are a narrowing, and a search
 * where "rod length" returns every page that says "length" is useless on a
 * guide whose vocabulary repeats on every page.
 *
 * A word counts wherever it is: the heading, the body, or the page's own title
 * and sidebar label, which is what lets "glossary caliber" find one entry and
 * "safety wind" find the wind limits inside the safety page.
 */
export function searchHelp(docs: HelpDoc[], query: string, limit = HIT_LIMIT): HelpHit[] {
  const tokens = searchTokens(query);
  if (!tokens.length) return [];
  const phrase = fold(query.trim());

  const hits: HelpHit[] = [];
  for (const doc of docs) {
    const titleHay = fold(`${doc.title} ${doc.label}`);
    for (const section of doc.sections) {
      const headHay = fold(section.heading);
      const bodyHay = fold(section.text);
      let score = 0;
      let all = true;
      for (const token of tokens) {
        const inHead = headHay.includes(token);
        const inBody = bodyHay.includes(token);
        const inTitle = titleHay.includes(token);
        if (!inHead && !inBody && !inTitle) {
          all = false;
          break;
        }
        // A word in a heading is what the section is ABOUT; a word in the page
        // title is true of every section on that page, so it ranks lowest.
        score += (inHead ? 4 : 0) + (inBody ? 2 : 0) + (inTitle ? 1 : 0);
      }
      if (!all) continue;
      // The words in the order they were typed, which is usually the thing
      // being looked for rather than the same words scattered about.
      if (tokens.length > 1) {
        if (headHay.includes(phrase)) score += 8;
        else if (bodyHay.includes(phrase)) score += 4;
      }
      hits.push({
        page: `${doc.slug}${section.hash}`,
        label: doc.label,
        heading: section.heading,
        snippet: snippetAround(section.text, tokens),
        score,
      });
    }
  }

  // By score, and within a score by the order the pages were indexed, which is
  // sidebar order: the guide's own idea of what comes first.
  return hits
    .map((hit, i) => ({ hit, i }))
    .sort((a, b) => b.hit.score - a.hit.score || a.i - b.i)
    .slice(0, limit)
    .map(({ hit }) => hit);
}

/** A run of text, and whether it is one of the words searched for. */
export interface HelpSegment {
  text: string;
  hit: boolean;
}

/**
 * Split text into plain runs and matched runs, for showing WHERE the match is.
 *
 * Folded indices line up with the original by construction (see fold), so what
 * comes back is the original's own characters, accents and case intact.
 */
export function splitHighlight(text: string, tokens: string[]): HelpSegment[] {
  if (!tokens.length) return [{ text, hit: false }];
  const folded = fold(text);
  const out: HelpSegment[] = [];
  let at = 0;
  let plain = 0;
  while (at < text.length) {
    // The longest token matching here, so a query of "fin fins" does not cut
    // the longer match short.
    let len = 0;
    for (const token of tokens) {
      if (token.length > len && folded.startsWith(token, at)) len = token.length;
    }
    if (!len) {
      at += 1;
      continue;
    }
    if (at > plain) out.push({ text: text.slice(plain, at), hit: false });
    out.push({ text: text.slice(at, at + len), hit: true });
    at += len;
    plain = at;
  }
  if (plain < text.length) out.push({ text: text.slice(plain), hit: false });
  return out;
}

/** The attribute that says a mark is the dialog's, not the page's own. */
const MARK_ATTR = 'data-astra-help-mark';

/**
 * Highlight the words searched for inside the rendered page, in document order.
 *
 * Why the app does this to the docs document rather than the docs doing it for
 * themselves: the frame is same-origin and the dialog is the thing that knows
 * what was typed. The marks are styled inline, so nothing is injected into the
 * page's stylesheets and the docs build does not have to know the dialog exists.
 *
 * Reversible on purpose: the marks handed back are what the dialog scrolls to,
 * and {@link clearMarks} puts the text back before the next search.
 */
export function markMatches(root: Element, tokens: string[]): HTMLElement[] {
  if (!tokens.length) return [];
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  // Collected first, because marking replaces the node the walker is standing
  // on and a live walk would then step into the text it had just inserted.
  const texts: Text[] = [];
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (node.nodeValue?.trim()) texts.push(node);
  }

  const marks: HTMLElement[] = [];
  for (const node of texts) {
    const segments = splitHighlight(node.nodeValue ?? '', tokens);
    if (!segments.some((segment) => segment.hit)) continue;
    const fragment = doc.createDocumentFragment();
    for (const segment of segments) {
      if (!segment.hit) {
        fragment.append(doc.createTextNode(segment.text));
        continue;
      }
      const mark = doc.createElement('mark');
      mark.setAttribute(MARK_ATTR, '');
      mark.style.backgroundColor = '#fcd34d';
      mark.style.color = '#0f172a';
      mark.style.borderRadius = '2px';
      mark.textContent = segment.text;
      fragment.append(mark);
      marks.push(mark);
    }
    node.replaceWith(fragment);
  }
  return marks;
}

/** Undo {@link markMatches}, leaving the page as it was served. */
export function clearMarks(root: Element): void {
  for (const mark of [...root.querySelectorAll(`mark[${MARK_ATTR}]`)]) {
    const parent = mark.parentNode;
    mark.replaceWith(mark.textContent ?? '');
    // Re-join the text nodes the replacement leaves either side, so the next
    // search sees the one node the served page had and can match across where
    // the last mark was.
    parent?.normalize();
  }
}
