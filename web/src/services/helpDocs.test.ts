// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { helpTarget, helpTargetFromUrl, loadHelpPage, readContents } from './helpDocs';

// jsdom, because the link parser resolves against window.location: an in-frame
// link is only "still in the docs" relative to the origin the app is served from.
const appBase = import.meta.env.BASE_URL.replace(/\/*$/, '/');
const origin = window.location.origin;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('helpTarget', () => {
  it('resolves a slug to the precached file, not the directory', () => {
    // The directory form is the one that does NOT come back from the precache
    // (directoryIndex is off in vite.config.ts), so this difference is what
    // makes Help open with no signal.
    expect(helpTarget('safety', 'en').fileUrl).toBe(`${appBase}docs/safety/index.html`);
  });

  it('treats the empty page as the docs index', () => {
    const target = helpTarget('', 'en');
    expect(target.slug).toBe('');
    expect(target.fileUrl).toBe(`${appBase}docs/index.html`);
  });

  it('splits an anchor off the slug', () => {
    const target = helpTarget('designing-a-rocket#fins', 'en');
    expect(target.slug).toBe('designing-a-rocket');
    expect(target.hash).toBe('#fins');
    // The anchor cannot be part of the file name, but it must survive into what
    // the frame is pointed at, or opening help ON a topic lands at the top.
    expect(target.fileUrl).toBe(`${appBase}docs/designing-a-rocket/index.html`);
    expect(target.src).toBe(`${appBase}docs/designing-a-rocket/index.html#fins`);
  });

  it('reads a translated page out of the locale tree', () => {
    expect(helpTarget('safety', 'es').fileUrl).toBe(`${appBase}docs/es/safety/index.html`);
  });
});

describe('helpTargetFromUrl', () => {
  it('turns an in-frame docs link back into a page', () => {
    expect(helpTargetFromUrl(`${origin}${appBase}docs/faq/`)).toBe('faq');
  });

  it('accepts the file form as well as the directory form', () => {
    expect(helpTargetFromUrl(`${origin}${appBase}docs/faq/index.html`)).toBe('faq');
  });

  it('keeps the anchor', () => {
    expect(helpTargetFromUrl(`${origin}${appBase}docs/faq/#answers`)).toBe('faq#answers');
  });

  it('maps the docs root to the index page', () => {
    expect(helpTargetFromUrl(`${origin}${appBase}docs/`)).toBe('');
  });

  it('strips the locale segment so the dialog can re-add the current one', () => {
    // The page is the same page in either tree, so a link is reported as a
    // page and nothing else. The dialog puts it back under the locale matching
    // the app's UI language, which is how a Spanish reader who follows a link
    // into the English tree stays in Spanish.
    expect(helpTargetFromUrl(`${origin}${appBase}docs/es/faq/`)).toBe('faq');
    expect(helpTargetFromUrl(`${origin}${appBase}docs/faq/`)).toBe('faq');
    // The Spanish root is the index page, not a page named "es".
    expect(helpTargetFromUrl(`${origin}${appBase}docs/es/`)).toBe('');
  });

  it('reports a link that leaves the docs, so the dialog can open a tab', () => {
    // GitHub, the OpenRocket manual and the site's own "launch the app" link all
    // reach this: following them inside the frame would replace the docs with
    // something else in a box labeled Help.
    expect(helpTargetFromUrl('https://github.com/thzero/AstraRocketJs')).toBeNull();
    expect(helpTargetFromUrl('https://openrocket.readthedocs.io/')).toBeNull();
  });

  it('reports a same-origin link that is not a docs page', () => {
    expect(helpTargetFromUrl(`${origin}${appBase}`)).toBeNull();
    // A sibling path that merely starts with the same letters is not the docs.
    expect(helpTargetFromUrl(`${origin}${appBase}docs-archive/faq/`)).toBeNull();
  });

  it('reports an unparseable href rather than throwing', () => {
    expect(helpTargetFromUrl('http://[')).toBeNull();
  });
});

describe('loadHelpPage', () => {
  const target = helpTarget('safety', 'en');
  /** A served page, minimal but with the two markers that matter. */
  const served = (body: string) => `<!doctype html><html><body><div id="__docusaurus">${body}</div></body></html>`;
  const answers = (html: string) =>
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve(html) }));

  it('reads the heading and the contents out of the served page', async () => {
    answers(served(`<article><h1>Safety</h1></article>${SIDEBAR}`));
    const page = await loadHelpPage(target);
    expect(page?.title).toBe('Safety');
    expect(page?.contents.pages.map((p) => p.label)).toContain('FAQ');
  });

  it('rejects the app shell answering for a missing page', async () => {
    // This is the dev-build case: web/public/docs is gitignored, and Vite
    // answers the missing path with the APP's index.html and a 200. Without the
    // marker check the dialog would render the app inside its own Help dialog.
    answers('<div id="root"></div>');
    await expect(loadHelpPage(target)).resolves.toBeNull();
  });

  it('rejects a 404', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, text: () => Promise.resolve('') }));
    await expect(loadHelpPage(target)).resolves.toBeNull();
  });

  it('rejects a failed fetch rather than throwing', async () => {
    // Offline with nothing cached throws; the dialog must fall back to offering
    // the docs site, not blow up over the design being edited.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(loadHelpPage(target)).resolves.toBeNull();
  });

  it('asks for the file URL, which is the precache key', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve(served('')) });
    vi.stubGlobal('fetch', fetchMock);
    await loadHelpPage(helpTarget('safety#storage', 'en'));
    // The anchor must not reach the request: it is not part of the cached name.
    expect(fetchMock).toHaveBeenCalledWith(`${appBase}docs/safety/index.html`);
  });

  it('resolves sidebar links although a parsed document has no base URL', async () => {
    // DOMParser gives a document whose `a.href` is empty, so the reader takes
    // the href attribute instead. If that regresses, every rail row goes
    // missing.
    answers(served(SIDEBAR));
    const page = await loadHelpPage(target);
    expect(page?.contents.pages.filter((p) => p.page !== null)).not.toEqual([]);
  });
});

// A trimmed copy of what Docusaurus actually builds into every page: the whole
// sidebar, and the current page's heading list beside it. The class names are
// the contract, so the fixture keeps them verbatim rather than simplifying.
const SIDEBAR = `
<nav aria-label="Docs sidebar" class="menu">
  <ul class="theme-doc-sidebar-menu menu__list">
    <li class="theme-doc-sidebar-item-category theme-doc-sidebar-item-category-level-1 menu__list-item">
      <div class="menu__list-item-collapsible"><a class="menu__link" href="/docs/"><span>Introduction</span></a></div>
      <ul class="menu__list">
        <li class="theme-doc-sidebar-item-link theme-doc-sidebar-item-link-level-2 menu__list-item">
          <a class="menu__link" href="/docs/"><span>Overview</span></a></li>
        <li class="theme-doc-sidebar-item-link theme-doc-sidebar-item-link-level-2 menu__list-item">
          <a class="menu__link" href="/docs/faq/"><span>FAQ</span></a></li>
      </ul>
    </li>
    <li class="theme-doc-sidebar-item-category theme-doc-sidebar-item-category-level-1 menu__list-item">
      <div class="menu__list-item-collapsible"><a class="menu__link" href="/docs/safety/"><span>User Guide</span></a></div>
      <ul class="menu__list">
        <li class="theme-doc-sidebar-item-link theme-doc-sidebar-item-link-level-2 menu__list-item">
          <a class="menu__link" href="/docs/safety/"><span>Safety</span></a></li>
      </ul>
    </li>
  </ul>
</nav>`;

const ARTICLE = `
<article>
  <div class="theme-doc-markdown markdown">
    <h1>Designing a Rocket</h1>
    <h2 class="anchor" id="the-component-tree">The component tree<a href="#the-component-tree" class="hash-link" title="Direct link to The component tree"></a></h2>
    <h3 class="anchor" id="dual-deployment">Dual deployment<a href="#dual-deployment" class="hash-link"></a></h3>
    <h2 class="anchor" id="undo--redo">Undo / redo<a href="#undo--redo" class="hash-link"></a></h2>
  </div>
</article>`;

describe('readContents', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  /** Render a fixture into the real document, so its links resolve against a
   *  base the way they do in the frame. */
  const read = (html: string) => {
    document.body.innerHTML = html;
    return readContents(document);
  };

  it('reads the whole page list out of one page', () => {
    // Docusaurus puts the entire sidebar into every page, which is why the rail
    // needs no generated index and no second source to drift from.
    expect(read(SIDEBAR).pages).toEqual([
      { page: null, label: 'Introduction', level: 1 },
      { page: '', label: 'Overview', level: 2 },
      { page: 'faq', label: 'FAQ', level: 2 },
      { page: null, label: 'User Guide', level: 1 },
      { page: 'safety', label: 'Safety', level: 2 },
    ]);
  });

  it('makes a category a label, not a page', () => {
    // A category links to its own first child, so treating it as a page would
    // list that page twice in a row.
    const [intro] = read(SIDEBAR).pages;
    expect(intro?.page).toBeNull();
  });

  it('reads the current page headings, with their nesting', () => {
    // The ARTICLE's headings, not the site's table-of-contents widget: that
    // widget is rendered on window size and is absent at the width the dialog's
    // frame runs at.
    expect(read(ARTICLE).headings).toEqual([
      { hash: '#the-component-tree', label: 'The component tree', level: 1 },
      { hash: '#dual-deployment', label: 'Dual deployment', level: 2 },
      { hash: '#undo--redo', label: 'Undo / redo', level: 1 },
    ]);
  });

  it('reports empty lists for a page with neither', () => {
    // A page with no h2 has no table of contents at all, and the fallback panel
    // has no sidebar; neither may throw.
    expect(read('<p>nothing here</p>')).toEqual({ pages: [], headings: [] });
  });
});
