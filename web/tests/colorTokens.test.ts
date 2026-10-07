import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * Components color through the semantic tokens in src/index.css (`bg-surface`,
 * `text-ink-muted`, `ring-line/10`, `text-accent-300`), never a Tailwind
 * palette color. A palette class is a color the theme cannot reach: it stays
 * slate or sky whatever the tokens say, so one added back is one more part of
 * the screen a theme gets wrong.
 */

const SRC = join(__dirname, '../src');
const PALETTE = [
  'slate',
  'gray',
  'zinc',
  'neutral',
  'stone',
  'red',
  'orange',
  'amber',
  'yellow',
  'lime',
  'green',
  'emerald',
  'teal',
  'cyan',
  'sky',
  'blue',
  'indigo',
  'violet',
  'purple',
  'fuchsia',
  'pink',
  'rose',
].join('|');
const UTILS =
  'bg|text|ring-offset|ring|border|fill|stroke|from|to|via|accent|divide|outline|placeholder|decoration|shadow|caret';
// A class, with or without a variant, starting a string or after whitespace,
// a quote, a backtick, a colon or an opening bracket.
const RE = new RegExp(`(?:^|[\\s'"\`:{(\\[])((?:${UTILS})-(?:(?:${PALETTE})-\\d{2,3}|white|black))(?![\\w-])`, 'g');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === 'vendor' ? [] : sources(p);
    return /\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}

describe('color tokens', () => {
  it('leaves no Tailwind palette color class in the source', () => {
    const found = sources(SRC).flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(RE)].map((m) => `${relative(SRC, file)}: ${m[1]}`),
    );
    expect(found).toEqual([]);
  });

  /**
   * A hex color in code is allowed only where it is not the interface's color,
   * each with the reason. Anything else draws through `token()`
   * (components/common/colorTokens), so a theme reaches it.
   */
  it('keeps hex colors in code to the files whose colors are not the interface', () => {
    const ALLOWED: Record<string, string> = {
      'services/design/partColors.ts': 'default paint of each kind of part: the rocket, not the UI',
      'services/files/rktImport.ts': "RockSim's color names, as its file format defines them",
      'services/exports/schematicExport.ts': 'the print colors a downloaded schematic is written in',
      'services/storage/settings.ts': 'defaults for user-chosen colors (flight phases, print templates)',
      'components/report/ExportDialog.tsx': "the print template fill's default, a user-chosen color",
      'components/canvas/FlightPath3D.tsx': "the motor flame and the parachute's lines: the rocket's own colors",
      'components/canvas/RocketModel.tsx': 'black emission, which is no glow at all',
      'components/canvas/sceneColors.ts': 'what a scene token reads as where no stylesheet is loaded',
      'components/canvas/aeroTables.ts': 'text on a cell whose shade is computed from its value',
      'services/app/helpSearch.ts': 'a search highlight inside the docs frame, which has its own stylesheet',
      'services/app/theme.ts': "the browser chrome color per theme, a meta tag's content that cannot read a variable",
    };
    const HEX = /['"]#[0-9a-fA-F]{3,8}['"]/;
    const offenders = sources(SRC)
      .map((file) => relative(SRC, file).split(sep).join('/'))
      .filter((rel) => !(rel in ALLOWED) && HEX.test(readFileSync(join(SRC, rel), 'utf8')));
    expect(offenders).toEqual([]);
  });

  /**
   * Every `token('name')` drawn in code is defined in a `:root` block of
   * index.css. A `--c-*` written inside `@theme` is a theme variable, which
   * Tailwind emits only when a class uses it; a color used only from code then
   * resolves to nothing and the element falls back to the inherited color.
   */
  it('defines every color token used in code on :root', () => {
    const css = readFileSync(join(SRC, 'index.css'), 'utf8');
    const rootBlocks = [...css.matchAll(/:root\s*\{([^}]*)\}/g)].map((m) => m[1]!).join('\n');
    const defined = new Set([...rootBlocks.matchAll(/--c-([\w-]+)\s*:/g)].map((m) => m[1]!));
    const used = new Set(
      sources(SRC).flatMap((file) =>
        [...readFileSync(file, 'utf8').matchAll(/token\('([\w-]+)'\)/g)].map((m) => m[1]!),
      ),
    );
    expect([...used].filter((name) => !defined.has(name))).toEqual([]);
  });
});
