// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../testing/renderWithProviders';
import { resetHelpIndex } from '../../../src/services/app/helpSearch';
import { HelpDialog } from '../../../src/components/layout/HelpDialog';

// The search cases parse several served pages in jsdom: a quarter to half a
// second each alone, ten times that on a loaded CI runner.
vi.setConfig({ testTimeout: 60_000 });

/**
 * Searching the guide from inside the app.
 *
 * The frame itself cannot load here (jsdom fetches nothing a page links to), and that is
 * the point of testing this at the component level: the rail, the search box and
 * the results are all drawn by the app from the served html, so everything a
 * reader does to find a topic works without a rendered page. Highlighting inside
 * the frame is the one part that needs one, and it is covered against a real
 * document in helpSearch.test.ts.
 */

const appBase = import.meta.env.BASE_URL.replace(/\/*$/, '/');

/** The sidebar Docusaurus builds into every page, which is the rail's source. */
const SIDEBAR = `
<nav aria-label="Docs sidebar" class="menu">
  <ul class="theme-doc-sidebar-menu menu__list">
    <li class="theme-doc-sidebar-item-category theme-doc-sidebar-item-category-level-1 menu__list-item">
      <div class="menu__list-item-collapsible"><a class="menu__link" href="${appBase}docs/"><span>User Guide</span></a></div>
      <ul class="menu__list">
        <li class="theme-doc-sidebar-item-link theme-doc-sidebar-item-link-level-2 menu__list-item">
          <a class="menu__link" href="${appBase}docs/"><span>Overview</span></a></li>
        <li class="theme-doc-sidebar-item-link theme-doc-sidebar-item-link-level-2 menu__list-item">
          <a class="menu__link" href="${appBase}docs/safety/"><span>Safety</span></a></li>
      </ul>
    </li>
  </ul>
</nav>`;

const built = (title: string, body: string) =>
  `<!doctype html><html><body><div id="__docusaurus"><article>
    <div class="theme-doc-markdown markdown">
      <header><h1>${title}</h1></header>
      ${body}
    </div>
  </article>${SIDEBAR}</div></body></html>`;

const PAGES: Record<string, string> = {
  [`${appBase}docs/index.html`]: built('Overview', '<p>What this app is, and what it is not.</p>'),
  [`${appBase}docs/safety/index.html`]: built(
    'Safety',
    `<p>Read this before you fly.</p>
     <h2 class="anchor" id="the-pad">At the pad<a href="#the-pad" class="hash-link">#</a></h2>
     <p>Keep the launch rod clear and stand back to the flight line.</p>`,
  ),
};

/** Serve the built docs, the way the precache does on a deployed build. */
function serveDocs() {
  const fetchMock = vi.fn((url: string) =>
    Promise.resolve({ ok: url in PAGES, text: () => Promise.resolve(PAGES[url] ?? '') }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  resetHelpIndex();
});

/**
 * jsdom has no matchMedia, and the dialog asks whether it is wide enough to keep
 * the contents rail beside the page. `true` is the desktop answer, where the
 * rail (and so the search box) is open to begin with.
 */
function stubWide(): void {
  window.matchMedia = ((query: string) => ({
    matches: true,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

/** Render Help on a page and wait for the contents rail to arrive. */
async function openHelp(page = '') {
  stubWide();
  serveDocs();
  renderWithProviders(<HelpDialog page={page} onClose={() => {}} />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Safety' })).toBeTruthy());
}

const searchBox = () => screen.getByLabelText('Search help');
const type = (text: string) => fireEvent.change(searchBox(), { target: { value: text } });

describe('HelpDialog search', () => {
  it('finds a section on another page and names where it is', async () => {
    await openHelp();
    type('launch rod');

    // The section heading leads the row, because a result is a place in the
    // guide and the section is the part of it being looked for.
    const hit = await screen.findByRole('button', { name: /At the pad/ });
    expect(hit.textContent).toContain('Safety');
    expect(hit.textContent).toContain('Keep the launch rod clear');
  });

  it('opens the page the result is on', async () => {
    await openHelp();
    type('launch rod');
    fireEvent.click(await screen.findByRole('button', { name: /At the pad/ }));

    // The heading is read off the page that loaded, so it is proof the dialog
    // moved rather than merely listing somewhere else.
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Safety' })).toBeTruthy());
  });

  it('opens the top result on Enter', async () => {
    await openHelp();
    type('launch rod');
    await screen.findByRole('button', { name: /At the pad/ });

    fireEvent.keyDown(searchBox(), { key: 'Enter' });
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Safety' })).toBeTruthy());
  });

  it('says so when nothing matches', async () => {
    await openHelp();
    type('supersonic ramjet');
    expect(await screen.findByText(/Nothing in the guide matches/)).toBeTruthy();
  });

  it('leaves the page list alone for a single letter', async () => {
    await openHelp();
    type('r');
    // One letter matches most of a guide, and building the index to prove it
    // costs a fetch per page.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Overview' })).toBeTruthy());
  });

  it('gives the page list back when the search is cleared', async () => {
    await openHelp();
    type('launch rod');
    await screen.findByRole('button', { name: /At the pad/ });

    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(screen.getByRole('button', { name: 'Overview' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /At the pad/ })).toBeNull();
  });

  it('clears the search on Escape rather than closing the dialog', async () => {
    stubWide();
    serveDocs();
    const onClose = vi.fn();
    renderWithProviders(<HelpDialog page="" onClose={onClose} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Safety' })).toBeTruthy());

    type('launch rod');
    await screen.findByRole('button', { name: /At the pad/ });
    fireEvent.keyDown(searchBox(), { key: 'Escape' });

    expect((searchBox() as HTMLInputElement).value).toBe('');
    // The reason you are in a search box is that you have not found the thing
    // yet, so shutting the guide is the wrong answer.
    expect(onClose).not.toHaveBeenCalled();
  });

  it('builds the index once, whatever is typed after', async () => {
    stubWide();
    const fetchMock = serveDocs();
    renderWithProviders(<HelpDialog page="" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Safety' })).toBeTruthy());
    const beforeSearch = fetchMock.mock.calls.length;

    type('launch rod');
    await screen.findByRole('button', { name: /At the pad/ });
    const afterFirst = fetchMock.mock.calls.length;
    expect(afterFirst).toBeGreaterThan(beforeSearch);

    type('flight line');
    await screen.findByRole('button', { name: /At the pad/ });
    expect(fetchMock.mock.calls.length).toBe(afterFirst);
  });
});
