// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { bakeTokens, PRINT_COLORS } from '../../../src/services/exports/schematicExport';

/**
 * The schematic draws through tokens on screen and prints in colors of its own:
 * a downloaded SVG has no stylesheet, and a page prints on white whatever the
 * screen's theme is.
 */
describe('bakeTokens', () => {
  afterEach(() => document.documentElement.style.removeProperty('--c-accent-400'));

  it('writes each schematic token as its print color, whatever the screen shows', () => {
    document.documentElement.style.setProperty('--c-sch-line', '#123456');
    const out = bakeTokens('<path stroke="var(--c-sch-line)" fill="var(--c-sch-part)"/>');
    expect(out).toBe(`<path stroke="${PRINT_COLORS['sch-line']}" fill="${PRINT_COLORS['sch-part']}"/>`);
    document.documentElement.style.removeProperty('--c-sch-line');
  });

  it('writes a token with no print color as what it reads now', () => {
    document.documentElement.style.setProperty('--c-accent-400', '#38bdf8');
    expect(bakeTokens('fill="var(--c-accent-400)"')).toBe('fill="#38bdf8"');
  });

  it('leaves no variable in the file, even for a token the page does not define', () => {
    expect(bakeTokens('fill="var(--c-not-a-token)"')).toBe('fill="#000000"');
  });

  it('has a print color for every schematic token the stylesheet defines', () => {
    const css = readFileSync(join(__dirname, '../../../src/index.css'), 'utf8');
    const defined = [...css.matchAll(/--c-(sch-[\w-]+)\s*:/g)].map((m) => m[1]!);
    expect(defined.length).toBeGreaterThan(0);
    expect(defined.filter((name) => !(name in PRINT_COLORS))).toEqual([]);
  });
});
