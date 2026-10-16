import { expect, openTab, type Page } from './base';
import type { ComponentType } from '../src/engine/openRocketEngine';
import en from '../src/i18n/locales/en.json' with { type: 'json' };

/** Every type with a property editor. The fairing has none, and the Add menu never offers one. */
type EditorType = Exclude<ComponentType, 'fairing'>;

/**
 * Where a part of each type comes from: the default design, or the Add menu
 * with the stage or the default body tube selected. Keyed by the app's own
 * type, so a type the app gains fails the typecheck until its editor is
 * scanned. The order is the Add menu's.
 */
const EDITORS: Record<EditorType, 'default' | 'stage' | 'body'> = {
  stage: 'default',
  nosecone: 'default',
  bodytube: 'default',
  transition: 'stage',
  trapezoidfinset: 'default',
  ellipticalfinset: 'body',
  freeformfinset: 'body',
  tubefinset: 'body',
  innertube: 'default',
  tubecoupler: 'body',
  centeringring: 'default',
  bulkhead: 'body',
  engineblock: 'default',
  parachute: 'default',
  streamer: 'body',
  shockcord: 'default',
  launchlug: 'default',
  railbutton: 'body',
  masscomponent: 'default',
  podset: 'body',
  parallelstage: 'body',
};

/** The editor's heading: the part's type, as the panel names it. */
const label = (type: EditorType): string => en.part[type];

/**
 * Select a part of every type in turn, the way a user does: a click on its row
 * in the tree, or the Add menu where the default design has none. `scan` runs
 * once each editor is showing.
 *
 * `dialog` is for a window under `2xl`, where the editor is a modal over the
 * tree: it is closed before each next click, as a user closes it to reach the
 * tree again.
 */
export async function eachEditor(
  page: Page,
  scan: (name: string) => Promise<void>,
  { dialog = false }: { dialog?: boolean } = {},
): Promise<void> {
  await openTab(page, 'Design');
  const tree = page.getByRole('tree', { name: 'Components' });
  const row = (type: EditorType) =>
    (type === 'stage' ? tree.locator('[aria-level="1"]') : tree.locator(`[title="${label(type)}"]`)).first();
  const editor = page.getByRole('dialog', { name: en.prop.editTitle });
  const shut = async () => {
    if (!dialog) return;
    await page.keyboard.press('Escape');
    await expect(editor).toHaveCount(0);
  };

  for (const type of Object.keys(EDITORS) as EditorType[]) {
    const from = EDITORS[type];
    if (from === 'default') {
      await row(type).click();
    } else {
      await row(from === 'stage' ? 'stage' : 'bodytube').click();
      await shut();
      await page.getByRole('combobox', { name: /^Add a part under/ }).selectOption(type);
    }
    await expect(page.getByRole('heading', { level: 2, name: label(type), exact: true })).toBeVisible();
    await scan(`${label(type)} editor`);
    await shut();
  }
}
