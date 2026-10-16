import { describe, it, expect } from 'vitest';
import { globSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DIALOG_SURFACES } from '../e2e/dialogSurfaces';

/**
 * The axe scans' list of dialogs matches the source: every component that
 * renders a `<Dialog>` or an `<AlertDialog>` is on it, with as many shells as
 * it renders, and nothing on it is gone. a11y.spec.ts keys its dialog scans on
 * the list, so a dialog missing here is a dialog no scan opens.
 *
 * Read as text: the question is which files render the shells, and a render is
 * a JSX tag, not an import.
 */
const web = fileURLToPath(new URL('..', import.meta.url));
const SHELL = /<(?:Dialog|AlertDialog)[\s>/]/g;

const rendered: Record<string, number> = {};
for (const file of globSync('src/**/*.tsx', { cwd: web })) {
  const count = readFileSync(`${web}${file}`, 'utf8').match(SHELL)?.length ?? 0;
  if (count > 0) rendered[basename(file, '.tsx')] = count;
}

describe('dialog surfaces', () => {
  it('finds the shells, so an empty scan cannot pass', () => {
    expect(Object.keys(rendered).length).toBeGreaterThanOrEqual(25);
  });

  it('lists every component that renders a dialog, with its count', () => {
    expect(rendered).toEqual(DIALOG_SURFACES);
  });
});
