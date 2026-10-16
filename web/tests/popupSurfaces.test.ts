import { describe, it, expect } from 'vitest';
import { globSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { POPUP_SURFACES } from '../e2e/popupSurfaces';

/**
 * The axe scans' list of popups matches the source: every component that
 * renders a control with `aria-expanded`, or a native `<details>`, is on it,
 * with as many such controls as it renders, and nothing on it is gone. a11y.spec.ts keys its popup scans
 * on the list, so a popup missing here is a popup no scan opens.
 *
 * Read as text, as dialogSurfaces.test.ts reads the dialog shells: the question
 * is which files render the attribute.
 */
const web = fileURLToPath(new URL('..', import.meta.url));
const EXPANDED = /aria-expanded=|<details[\s>]/g;
/** Block comments, which name `<details>` when they describe one. */
const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g;

const rendered: Record<string, number> = {};
for (const file of globSync('src/**/*.tsx', { cwd: web })) {
  const code = readFileSync(`${web}${file}`, 'utf8').replace(BLOCK_COMMENT, '');
  const count = code.match(EXPANDED)?.length ?? 0;
  if (count > 0) rendered[basename(file, '.tsx')] = count;
}

describe('popup surfaces', () => {
  it('finds the controls, so an empty scan cannot pass', () => {
    expect(Object.keys(rendered).length).toBeGreaterThanOrEqual(8);
  });

  it('lists every component that renders one, with its count', () => {
    expect(rendered).toEqual(POPUP_SURFACES);
  });
});
