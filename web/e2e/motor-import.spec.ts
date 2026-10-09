import { test, expect, openTab, ready, type Page } from './base';

/**
 * Importing a motor from a file, through the real app and real IndexedDB.
 *
 * `rseParser.test.ts` holds the parse to OpenRocket's own loader. What it
 * cannot reach is the half that matters to somebody with a hybrid they want to
 * fly: that the file reaches the store, the picker lists what it found, and the
 * motor is selectable like any other.
 */

async function openPicker(page: Page) {
  // One motor card per mount, on the Configurations tab.
  await openTab(page, 'Configurations');
  await page
    .getByRole('button', { name: /change/i })
    .first()
    .click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  return dialog;
}

test('a hybrid imports from a .rse file, which .eng could not describe', async ({ page }) => {
  await ready(page);
  const dialog = await openPicker(page);

  // The catalog ships no hybrid the default rocket can fly, and RASP has no
  // way to say "hybrid" at all; that is what this format is for.
  await dialog.locator('input[type=file]').setInputFiles('e2e/fixtures/hybrid.rse');

  // The import says what it did, where the motor count normally is.
  await expect(dialog.getByText('1 motor imported')).toBeVisible();

  // The default rocket has an 18 mm mount and this is a 54 mm hybrid, so the
  // mount filter hides it: the honest order of events is importing the motor
  // for a rocket you have yet to build. Turn the filter off to see it.
  await dialog.getByRole('checkbox', { name: /Fits the mount/ }).uncheck();

  // Listed with the star every imported motor carries.
  const row = dialog.getByRole('button').filter({ hasText: 'J350' });
  await expect(row.first()).toContainText('★');

  // And the detail panel reads it as a hybrid, from the file's Type attribute.
  await row.first().click();
  await expect(dialog.getByText('Hybrid', { exact: true }).first()).toBeVisible();

  // It seats like any other motor.
  await dialog.getByRole('button', { name: 'Select', exact: true }).click();
  await expect(dialog).toBeHidden();
  // Scoped to the motor card: the schematic behind the Simulations tab draws
  // the designation into an SVG label too, and that one is hidden.
  await expect(page.getByRole('button', { name: /change/i }).first()).toBeVisible();
  // A plugged motor shows "plugged" in place of a delay on the card, which is
  // what this hybrid lists and what .eng had no way to record.
  await expect(page.getByText('plugged', { exact: false }).first()).toBeVisible();
});

test('a .rse holding several motors imports all of them, and says so', async ({ page }) => {
  await ready(page);
  const dialog = await openPicker(page);

  // An engine-database file is a manufacturer's range, not one motor. One
  // landing and forty landing look identical in a list of 800, so it counts.
  const two = `<?xml version="1.0"?><engine-database><engine-list>
    <engine mfg="Bench" code="A1" Type="hybrid" dia="29" len="200" initWt="300" propWt="120"><data>
      <eng-data t="0" f="0"/><eng-data t="1" f="120"/><eng-data t="2" f="0"/>
    </data></engine>
    <engine mfg="Bench" code="A2" Type="hybrid" dia="38" len="300" initWt="600" propWt="240"><data>
      <eng-data t="0" f="0"/><eng-data t="1" f="240"/><eng-data t="2" f="0"/>
    </data></engine>
  </engine-list></engine-database>`;
  await dialog.locator('input[type=file]').setInputFiles({
    name: 'range.rse',
    mimeType: 'application/xml',
    buffer: Buffer.from(two, 'utf8'),
  });

  await expect(dialog.getByText('2 motors imported')).toBeVisible();
  await expect(dialog.getByRole('button').filter({ hasText: 'A1' }).first()).toBeVisible();
  await expect(dialog.getByRole('button').filter({ hasText: 'A2' }).first()).toBeVisible();
});

test('a malformed motor file is refused by name, not swallowed', async ({ page }) => {
  await ready(page);
  const dialog = await openPicker(page);

  await dialog.locator('input[type=file]').setInputFiles({
    name: 'broken.rse',
    mimeType: 'application/xml',
    // Well-formed XML, but it lists more propellant than the motor weighs,
    // which would fly a rocket that gains mass as it burns.
    buffer: Buffer.from(
      `<engine-database><engine-list><engine mfg="B" code="X" dia="29" len="100" initWt="100" propWt="900">
        <data><eng-data t="0" f="0"/><eng-data t="1" f="10"/></data></engine></engine-list></engine-database>`,
      'utf8',
    ),
  });

  await expect(page.getByText(/more propellant/i)).toBeVisible();
});
