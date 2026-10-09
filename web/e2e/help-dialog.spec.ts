import { existsSync } from 'node:fs';
import { test, expect, openTab, runFlight } from './base';

/**
 * In-app Help: the Docusaurus site, rendered inside the app.
 *
 * What is worth an end-to-end test here is precisely what unit tests cannot
 * reach: that a real Docusaurus page loads into the frame, that the embed
 * stylesheet shipped with the docs actually strips the site chrome, and that a
 * link inside that frame is intercepted and re-opened in the dialog rather than
 * navigating the frame out of the app.
 *
 * Requires the docs, and in CI that is not optional. `web/public/docs` is
 * gitignored, so a skip on a missing build would let a CI run report green with
 * the in-app Help dialog untested. The e2e-full workflow and the update-flow job
 * run `npm run docs:build` for themselves.
 *
 * So the skip is local only. Without the docs a CI run fails loudly and names
 * the missing step. Locally it still skips, so nobody has to build Docusaurus
 * to run the rest of the suite.
 *
 * The condition is on the directory, not on the dialog's behavior: with no docs
 * the dialog correctly offers the docs site instead, which is a different thing
 * from the feature being broken, and helpDocs.test.ts covers that path.
 */

const helpDialog = 'Help';

// Playwright's cwd is web/, the same base the fixture paths use.
const docsBuilt = existsSync('public/docs/index.html');

test.beforeEach(() => {
  // In CI the docs are a hard precondition: the job builds them, and if they
  // are missing the job configuration is wrong and has to say so. A skip here
  // would hide this spec from CI entirely.
  if (process.env.CI && !docsBuilt) {
    throw new Error(
      'web/public/docs is not built. e2e-full.yml runs `npm run docs:build` before this spec; ' +
        'if that step was removed or failed, these tests must fail rather than skip.',
    );
  }
  // Locally it stays a skip: an environment precondition, not a disabled test.
  // The rule exists to stop a failing spec being quietly switched off, and this
  // one runs in full wherever the docs exist.
  // eslint-disable-next-line playwright/no-skipped-test
  test.skip(!docsBuilt, 'web/public/docs is not built; run `npm run docs:build`');
});

test('Help opens the docs inside the app, with the site chrome stripped', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('menuitem', { name: 'Help' }).click();

  const dialog = page.getByRole('dialog', { name: helpDialog });
  await expect(dialog).toBeVisible();

  const docs = page.frameLocator(`iframe[title="${helpDialog}"]`);
  // A real docs page, not the app answering for a missing one: the app has no
  // "Documentation" heading, and Docusaurus mounts every page in #__docusaurus.
  await expect(docs.locator('#__docusaurus')).toBeAttached();
  await expect(docs.locator('article')).toBeVisible();

  // The embed stylesheet (website/src/css/custom.css) hides the site's own
  // navigation, which would otherwise be a second set of controls inside a
  // dialog that already has a title, a back button and a close button.
  await expect(docs.locator('.navbar')).toBeHidden();
  await expect(docs.locator('.theme-doc-sidebar-container')).toBeHidden();
  await expect(docs.locator('footer.footer')).toBeHidden();
});

test('Safety opens Help already on the Safety page', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('menuitem', { name: 'Safety' }).click();

  const dialog = page.getByRole('dialog', { name: helpDialog });
  // The heading is read off the loaded page, so it doubles as proof that the
  // dialog opened on the named topic rather than at the docs index.
  await expect(dialog.getByRole('heading', { name: 'Safety' })).toBeVisible();

  // The external link is kept: a docs site you can send someone is not
  // replaceable by a dialog.
  await expect(dialog.getByRole('link', { name: 'Open on the docs site' })).toHaveAttribute(
    'href',
    'https://thzero.github.io/AstraRocketJs/docs/safety',
  );

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('a link inside the docs navigates the dialog, and Back returns', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('menuitem', { name: 'Safety' }).click();

  const dialog = page.getByRole('dialog', { name: helpDialog });
  const back = dialog.getByRole('button', { name: 'Back' });
  await expect(dialog.getByRole('heading', { name: 'Safety' })).toBeVisible();
  await expect(back).toBeDisabled();

  // The previous/next pair is deliberately left in place by the embed styles:
  // it is how you read straight through the guide. Following it must stay in
  // the dialog, because the URL it points at is the directory form, which is
  // the one that does not come back from the precache offline.
  const docs = page.frameLocator(`iframe[title="${helpDialog}"]`);
  await docs.locator('.pagination-nav__link--next').click();

  // Safety is the last User Guide page, so next is the Appendix's first, which
  // is the glossary (see the note in sidebars.ts for why it leads that group).
  await expect(dialog.getByRole('heading', { name: 'Glossary' })).toBeVisible();
  // Still inside the app: the frame moved, the page did not.
  await expect(page.getByRole('button', { name: 'Menu' })).toBeVisible();

  await expect(back).toBeEnabled();
  await back.click();
  await expect(dialog.getByRole('heading', { name: 'Safety' })).toBeVisible();
  await expect(back).toBeDisabled();
});

test('the contents rail lists every page, and the headings of the one you are on', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('menuitem', { name: 'Help' }).click();

  const dialog = page.getByRole('dialog', { name: helpDialog });
  const contents = dialog.getByRole('navigation', { name: 'Contents' });
  // Open by default at this viewport: the rail is beside the page from the `md`
  // breakpoint up, and overlays it below.
  await expect(contents).toBeVisible();

  // The rail is read out of the sidebar Docusaurus builds into every page, so
  // the grouping, the order and the labels are whatever sidebars.ts says. A
  // category is a label rather than a link, because it points at its own first
  // child and would otherwise list that page twice.
  await expect(contents.getByText('User Guide', { exact: true })).toBeVisible();
  await expect(contents.getByRole('button', { name: 'User Guide', exact: true })).toHaveCount(0);

  // A page from the last group, opened from the first page. Docusaurus renders
  // a collapsed category's children into no page at all, so this is what fails
  // if a category in sidebars.ts loses its `collapsed: false` and takes a whole
  // group out of the rail.
  await expect(contents.getByRole('button', { name: 'Compared with mmrocket-sim', exact: true })).toBeVisible();

  await contents.getByRole('button', { name: 'Designing a Rocket', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Designing a Rocket' })).toBeVisible();

  // The page you are on opens into its own headings, so the rail answers both
  // "what else is there" and "where in this page".
  const heading = contents.getByRole('button', { name: 'The component tree' });
  await expect(heading).toBeVisible();
  // Nothing is current yet: the frame is above the first heading.
  await expect(contents.locator('[aria-current="location"]')).toHaveCount(0);

  await heading.click();
  // Same page, so this scrolls the frame rather than reloading it.
  await expect(dialog.getByRole('heading', { name: 'Designing a Rocket' })).toBeVisible();
  // And the rail follows the frame down the page rather than only listing it.
  await expect(heading).toHaveAttribute('aria-current', 'location');

  const later = contents.getByRole('button', { name: 'Undo / redo' });
  await later.click();
  await expect(later).toHaveAttribute('aria-current', 'location');
  await expect(heading).not.toHaveAttribute('aria-current', 'location');

  // And it folds away, for the width it costs.
  await dialog.getByRole('button', { name: 'Contents' }).click();
  await expect(contents).toBeHidden();
});

test('search finds a section on another page and opens it there', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('menuitem', { name: 'Help' }).click();

  const dialog = page.getByRole('dialog', { name: helpDialog });
  const contents = dialog.getByRole('navigation', { name: 'Contents' });
  // Opened at the docs index: the point is that search reaches a page the
  // reader is not on and has never opened.
  await expect(dialog.getByRole('heading', { name: 'Overview' })).toBeVisible();

  await contents.getByLabel('Search help').fill('ejection delay');

  // The index is built from the same built pages the frame renders, on first
  // use, so what is worth an end-to-end test is that a real docs build comes
  // back as searchable text: a page whose markup the reader changed shape on
  // would index as nothing and fail here rather than in a unit test with a
  // fixture in it.
  // Scoped to the results group, which is named by its own count line: the rail
  // holds two lists of buttons that look alike, and a row's accessible name
  // includes its quoted snippet, so the phrase matches several of them.
  const results = contents.getByRole('group', { name: /Matches:/ });
  await expect(results).toBeVisible();

  const hit = results.getByRole('button').first();
  // Ranked first because the words are the section's own heading rather than a
  // phrase somewhere in a page's text.
  await expect(hit).toContainText('Ejection delay');
  // Where the section is, beside what it is called.
  await expect(hit).toContainText('Motors');

  await hit.click();
  await expect(dialog.getByRole('heading', { name: 'Motors' })).toBeVisible();

  // And the words are marked in the page itself, which is what makes a hit on a
  // long page (the glossary is one heading per letter) findable by eye.
  const docs = page.frameLocator(`iframe[title="${helpDialog}"]`);
  await expect(docs.locator('article mark[data-astra-help-mark]').first()).toBeVisible();

  // Clearing gives the page list back, rather than leaving the rail showing
  // results for a search that is no longer there.
  await dialog.getByRole('button', { name: 'Clear search' }).click();
  await expect(contents.getByRole('button', { name: 'Safety', exact: true })).toBeVisible();
  await expect(docs.locator('article mark[data-astra-help-mark]')).toHaveCount(0);
});

test.describe('at phone width', () => {
  // The desktop project runs at 1600px, where the rail is simply beside the
  // page. This is the layout that matters at a launch site.
  test.use({ viewport: { width: 390, height: 844 } });

  test('the contents rail overlays the page, and folds away once you pick one', async ({ page }) => {
    await page.goto('/');

    await page.getByRole('button', { name: 'Menu' }).click();
    await page.getByRole('menuitem', { name: 'Help' }).click();

    const dialog = page.getByRole('dialog', { name: helpDialog });
    const contents = dialog.getByRole('navigation', { name: 'Contents' });
    const toggle = dialog.getByRole('button', { name: 'Contents' });

    // Shut by default here: a 224px rail inside a 358px dialog would leave the
    // page about a hundred pixels to render in.
    await expect(toggle).toBeVisible();
    await expect(contents).toBeHidden();

    await toggle.click();
    await expect(contents).toBeVisible();

    await contents.getByRole('button', { name: 'Motors', exact: true }).click();
    // And gets out of the way, or it would be covering the page it just sent
    // you to.
    await expect(contents).toBeHidden();
    await expect(dialog.getByRole('heading', { name: 'Motors' })).toBeVisible();
  });
});

test('the Safety card opens Help without leaving the results', async ({ page }) => {
  await page.goto('/');
  await runFlight(page);
  await openTab(page, 'Results');

  // The reason this card links into the dialog rather than a new tab: someone
  // reading it is looking at a flight they are about to fly, quite possibly at
  // a field with no signal.
  await page.getByRole('button', { name: 'Read the safety notes' }).first().click();

  const dialog = page.getByRole('dialog', { name: helpDialog });
  await expect(dialog.getByRole('heading', { name: 'Safety' })).toBeVisible();
});

/**
 * The rail's headings come from the fetched page HTML, so they are clickable
 * while the frame is still loading that page. A click in that window has to land
 * once the frame arrives rather than scroll a document that is not there yet.
 */
test('a rail heading picked before the frame has loaded still takes you there', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('menuitem', { name: 'Help' }).click();
  const dialog = page.getByRole('dialog', { name: helpDialog });
  const contents = dialog.getByRole('navigation', { name: 'Contents' });
  await expect(contents.getByRole('button', { name: 'Designing a Rocket', exact: true })).toBeVisible();

  // Hold back only the frame's document; the dialog's own fetch of the page,
  // which builds the rail, goes through.
  await page.route('**/docs/**', async (route) => {
    const req = route.request();
    if (req.resourceType() === 'document' && req.frame() !== page.mainFrame()) {
      await new Promise((r) => setTimeout(r, 2000));
    }
    await route.continue();
  });

  await contents.getByRole('button', { name: 'Designing a Rocket', exact: true }).click();
  const heading = contents.getByRole('button', { name: 'The component tree' });
  await heading.click();
  await expect(heading).toHaveAttribute('aria-current', 'location', { timeout: 10_000 });
});
