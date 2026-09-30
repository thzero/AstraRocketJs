// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  type HelpDoc,
  clearMarks,
  fold,
  helpIndex,
  markMatches,
  readSections,
  resetHelpIndex,
  searchHelp,
  searchTokens,
  snippetAround,
  splitHighlight,
} from '../../../src/services/app/helpSearch';

/**
 * Search over the docs that ship inside the app.
 *
 * jsdom, because all of this is DOM work: the index is read out of the built
 * pages with a TreeWalker, and the highlighter edits the page in the frame.
 *
 * What these hold still is the behavior a reader would notice going wrong: that
 * every word typed has to appear (an OR search is useless on a guide that says
 * "length" on every page), that a hit lands somewhere the dialog can navigate
 * to, that accents and case do not matter in either language, and that
 * highlighting is reversible, because the same document is marked again on the
 * next search.
 */

const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html');
const appBase = import.meta.env.BASE_URL.replace(/\/*$/, '/');

afterEach(() => {
  vi.unstubAllGlobals();
  resetHelpIndex();
  document.body.innerHTML = '';
});

/** A page as Docusaurus builds it, down to the class names that are read. */
const built = (title: string, body: string) =>
  `<!doctype html><html><body><div id="__docusaurus"><article>
    <div class="theme-doc-markdown markdown">
      <header><h1>${title}</h1></header>
      ${body}
    </div>
  </article></div></body></html>`;

/** A heading, with the anchor link Docusaurus puts at the end of every one. */
const h = (level: 2 | 3, id: string, label: string) =>
  `<h${level} class="anchor" id="${id}">${label}<a href="#${id}" class="hash-link" title="Direct link">#</a></h${level}>`;

const SAFETY = built(
  'Safety',
  `<p>Read this before you fly.</p>
   ${h(2, 'the-pad', 'At the pad')}
   <p>Keep the rod clear and stand back to the flight line.</p>
   ${h(3, 'misfires', 'Misfires')}
   <p>Wait sixty seconds before approaching.</p>`,
);

describe('readSections', () => {
  const sections = readSections(parse(SAFETY));

  it('splits a page at the headings the dialog can navigate to', () => {
    // h2 and h3 with an id, which are exactly the rows the contents rail
    // already lists, so every hit has somewhere to land.
    expect(sections.map((s) => s.hash)).toEqual(['', '#the-pad', '#misfires']);
    expect(sections.map((s) => s.heading)).toEqual(['', 'At the pad', 'Misfires']);
  });

  it('keeps the text above the first heading as a section of its own', () => {
    expect(sections[0]!.text).toBe('Read this before you fly.');
  });

  it('drops the anchor glyph out of a heading', () => {
    // Left in, every heading in the results list would end in a stray #.
    expect(sections[1]!.heading).toBe('At the pad');
  });

  it('keeps heading text out of the body text', () => {
    // Held as a heading already: taken twice it would double that section's
    // score and put the anchor glyph into the snippets.
    expect(sections[1]!.text).toBe('Keep the rod clear and stand back to the flight line.');
    expect(sections[0]!.text).not.toContain('At the pad');
  });

  it('reads a page with no headings at all', () => {
    const only = readSections(parse(built('FAQ', '<p>Only prose here.</p>')));
    expect(only).toEqual([{ hash: '', heading: '', text: 'Only prose here.' }]);
  });

  it('reports nothing for a document that is not a docs page', () => {
    expect(readSections(parse('<div id="root"></div>'))).toEqual([]);
  });
});

describe('searchHelp', () => {
  const docs: HelpDoc[] = [
    {
      slug: 'safety',
      label: 'Safety',
      title: 'Safety',
      sections: [
        { hash: '', heading: '', text: 'Read this before you fly.' },
        { hash: '#the-pad', heading: 'At the pad', text: 'Keep the rod clear and stand back.' },
      ],
    },
    {
      slug: 'glossary',
      label: 'Glossary',
      title: 'Glossary',
      sections: [
        { hash: '#c', heading: 'C', text: 'Caliber: one body diameter, the unit of stability margin.' },
        { hash: '#k', heading: 'Kármán line', text: 'Where the atmosphere stops mattering.' },
      ],
    },
  ];

  it('points a hit at the section, not just the page', () => {
    expect(searchHelp(docs, 'rod').map((hit) => hit.page)).toEqual(['safety#the-pad']);
  });

  it('demands every word, not any of them', () => {
    // The whole point of typing a second word. "rod" is in the safety page and
    // "caliber" in the glossary, and no section holds both.
    expect(searchHelp(docs, 'rod caliber')).toEqual([]);
    expect(searchHelp(docs, 'rod clear').map((hit) => hit.page)).toEqual(['safety#the-pad']);
  });

  it('counts a word in the page title, so a page can be named', () => {
    // "glossary" appears in no section's text: it is the page. This is what
    // lets a reader narrow to one page by naming it.
    expect(searchHelp(docs, 'glossary caliber').map((hit) => hit.page)).toEqual(['glossary#c']);
  });

  it('ranks a heading match above a body match', () => {
    const ranked: HelpDoc[] = [
      { slug: 'a', label: 'A', title: 'A', sections: [{ hash: '#x', heading: 'Prose', text: 'the fin can span far' }] },
      { slug: 'b', label: 'B', title: 'B', sections: [{ hash: '#y', heading: 'Fin span', text: 'unrelated words' }] },
    ];
    expect(searchHelp(ranked, 'fin span').map((hit) => hit.page)).toEqual(['b#y', 'a#x']);
  });

  it('ignores case and accents', () => {
    // Nobody types the accents, in either language, and the headings are full of
    // capitals.
    expect(searchHelp(docs, 'karman line').map((hit) => hit.page)).toEqual(['glossary#k']);
    expect(searchHelp(docs, 'CALIBER').map((hit) => hit.page)).toEqual(['glossary#c']);
  });

  it('treats punctuation as a separator rather than a word', () => {
    expect(searchTokens('rod, clear!')).toEqual(['rod', 'clear']);
    expect(searchHelp(docs, 'caliber:').map((hit) => hit.page)).toEqual(['glossary#c']);
  });

  it('answers an empty query with nothing rather than everything', () => {
    expect(searchHelp(docs, '   ')).toEqual([]);
  });

  it('caps the list', () => {
    const many: HelpDoc[] = [
      {
        slug: 'many',
        label: 'Many',
        title: 'Many',
        sections: Array.from({ length: 40 }, (_, i) => ({ hash: `#s${i}`, heading: `Fin ${i}`, text: 'fin' })),
      },
    ];
    expect(searchHelp(many, 'fin', 5)).toHaveLength(5);
  });
});

describe('snippetAround', () => {
  const long = `${'word '.repeat(60)}caliber is the unit ${'tail '.repeat(40)}`.trim();

  it('quotes a short section whole', () => {
    expect(snippetAround('Short enough already.', ['short'])).toBe('Short enough already.');
  });

  it('quotes around the match rather than from the top', () => {
    const snippet = snippetAround(long, ['caliber']);
    expect(snippet).toContain('caliber is the unit');
    expect(snippet.startsWith('…')).toBe(true);
    expect(snippet.endsWith('…')).toBe(true);
  });

  it('does not start or end mid-word', () => {
    const snippet = snippetAround(long, ['caliber']).replace(/^…|…$/g, '');
    expect(long).toContain(snippet);
    expect(snippet).toMatch(/^\S/);
  });

  it('falls back to the opening when the word was in the heading', () => {
    // A hit can match on the heading or the page title alone, and the section's
    // first words are then the useful quote.
    expect(snippetAround(long, ['nowhere'])).toMatch(/^word word/);
  });
});

describe('splitHighlight', () => {
  it('marks the matches and leaves the rest alone', () => {
    expect(splitHighlight('the rod is clear', ['rod'])).toEqual([
      { text: 'the ', hit: false },
      { text: 'rod', hit: true },
      { text: ' is clear', hit: false },
    ]);
  });

  it('hands back the original characters, accents and case intact', () => {
    // The folding is position for position (see fold), which is what makes an
    // index found in folded text usable against the original.
    const segments = splitHighlight('Kármán', ['karman']);
    expect(segments).toEqual([{ text: 'Kármán', hit: true }]);
  });

  it('prefers the longest token at a position', () => {
    // Otherwise "fin" would cut "fins" short and leave a stray "s" unmarked.
    expect(splitHighlight('fins', ['fin', 'fins'])).toEqual([{ text: 'fins', hit: true }]);
  });

  it('leaves text whole when nothing was searched for', () => {
    expect(splitHighlight('untouched', [])).toEqual([{ text: 'untouched', hit: false }]);
  });

  it('folds to the same length it was given', () => {
    // The one property everything above depends on.
    for (const s of ['Kármán', 'ANGSTROM', 'plain']) expect(fold(s)).toHaveLength(s.length);
  });
});

describe('markMatches', () => {
  const article = (html: string) => {
    document.body.innerHTML = `<article>${html}</article>`;
    return document.querySelector('article')!;
  };

  it('wraps every match in the page, in document order', () => {
    const root = article('<p>the rod</p><h2>Rod length</h2><p>no match</p>');
    const marks = markMatches(root, ['rod']);
    expect(marks.map((mark) => mark.textContent)).toEqual(['rod', 'Rod']);
    expect(root.querySelectorAll('mark')).toHaveLength(2);
  });

  it('puts the page back exactly as it was', () => {
    // Not a nicety: the next search marks this same document, so a leftover
    // mark would split the text it has to match across.
    const html = '<p>the rod is clear</p>';
    const root = article(html);
    markMatches(root, ['rod', 'clear']);
    clearMarks(root);
    expect(root.innerHTML).toBe(html);
    // And the text is ONE node again, or a later search could not match across
    // where the last mark was.
    expect(root.querySelector('p')!.childNodes).toHaveLength(1);
  });

  it('marks across a second search', () => {
    const root = article('<p>the rod is clear</p>');
    markMatches(root, ['rod']);
    clearMarks(root);
    const marks = markMatches(root, ['rod is clear']);
    expect(marks.map((mark) => mark.textContent)).toEqual(['rod is clear']);
  });

  it('does nothing with nothing to mark', () => {
    const root = article('<p>the rod</p>');
    expect(markMatches(root, [])).toEqual([]);
    expect(root.querySelectorAll('mark')).toHaveLength(0);
  });
});

describe('helpIndex', () => {
  const pages = [
    { page: null, label: 'User Guide', level: 1 },
    { page: '', label: 'Overview', level: 2 },
    { page: 'safety', label: 'Safety', level: 2 },
  ];

  /** Every page answers, keyed by the file URL that is the precache key. */
  const serving = (html: string) => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve(html) });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  };

  it('indexes every page the rail lists, and nothing else', async () => {
    const fetchMock = serving(SAFETY);
    const docs = await helpIndex(pages, 'en');
    // The category row is a label pointing at its own first child, so taking it
    // too would index that page twice.
    expect(docs.map((doc) => doc.slug)).toEqual(['', 'safety']);
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      `${appBase}docs/index.html`,
      `${appBase}docs/safety/index.html`,
    ]);
  });

  it('labels a page as the sidebar does, in the reader’s language', async () => {
    serving(SAFETY);
    const docs = await helpIndex(pages, 'es');
    expect(docs.map((doc) => doc.label)).toEqual(['Overview', 'Safety']);
  });

  it('reads a locale tree for a locale', async () => {
    const fetchMock = serving(SAFETY);
    await helpIndex(pages, 'es');
    expect(fetchMock.mock.calls.map((call) => call[0])).toContain(`${appBase}docs/es/safety/index.html`);
  });

  it('builds once per language and keeps it for the session', async () => {
    const fetchMock = serving(SAFETY);
    await helpIndex(pages, 'en');
    await helpIndex(pages, 'en');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await helpIndex(pages, 'es');
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('does not keep an empty index', async () => {
    // What a first search launched with a cold cache and no signal looks like.
    // Cached, it would leave search quietly broken for the rest of the session.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    expect(await helpIndex(pages, 'en')).toEqual([]);
    vi.unstubAllGlobals();

    const fetchMock = serving(SAFETY);
    expect(await helpIndex(pages, 'en')).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalled();
  });

  it('skips a page the build does not have', async () => {
    // The dev-build case: Vite answers a missing docs path with the APP's own
    // shell and a 200, which is what the marker check in fetchHelpDocument is
    // for. An unmarked answer must not become an indexed page.
    serving('<div id="root"></div>');
    expect(await helpIndex(pages, 'en')).toEqual([]);
  });
});
