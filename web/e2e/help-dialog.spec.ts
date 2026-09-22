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
 * SKIPPED WITHOUT THE DOCS, and that is a real gap, not a formality.
 * `web/public/docs` is gitignored and the docs are deliberately NOT built on a
 * PR (see the note above the e2e job in gates.yml), so these skip in CI and run
 * for anyone who has run `npm run docs:build`. Building Docusaurus in the e2e
 * job, once per shard, would close it; that is a cost decision, and the one
 * already recorded in gates.yml was taken when the app did not depend on the
 * docs output. It does now.
 *
 * The skip is on the DIRECTORY, not on the dialog's behavior: with no docs the
 * dialog correctly offers the docs site instead, which is a different thing
 * from the feature being broken, and helpDocs.test.ts covers that path.
 */

const helpDialog = 'Help';

// Playwright's cwd is web/, the same base the fixture paths use.
const docsBuilt = existsSync('public/docs/index.html');

test.beforeEach(() => {
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
  // dialog opened ON the named topic rather than at the docs index.
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

  await expect(dialog.getByRole('heading', { name: 'Contributing' })).toBeVisible();
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

  // A page from the LAST group, opened from the FIRST page. Docusaurus renders
  // a collapsed category's children into no page at all, so this is what fails
  // if a category in sidebars.ts loses its `collapsed: false` and takes a whole
  // group out of the rail.
  await expect(contents.getByRole('button', { name: 'Dependencies', exact: true })).toBeVisible();

  await contents.getByRole('button', { name: 'Designing a Rocket', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Designing a Rocket' })).toBeVisible();

  // The page you are ON opens into its own headings, so the rail answers both
  // "what else is there" and "where in this page".
  const heading = contents.getByRole('button', { name: 'The component tree' });
  await expect(heading).toBeVisible();
  await heading.click();
  // Same page, so this scrolls the frame rather than reloading it.
  await expect(dialog.getByRole('heading', { name: 'Designing a Rocket' })).toBeVisible();

  // And it folds away, for the width it costs.
  await dialog.getByRole('button', { name: 'Contents' }).click();
  await expect(contents).toBeHidden();
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
