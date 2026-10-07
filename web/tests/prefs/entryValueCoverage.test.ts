import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * The gate on a whole class of bug, rather than on one instance of it.
 *
 * Twenty-odd numeric boxes each spelled out their own idea of what a typed
 * number may be, and they disagreed: one refused the entry, several converted it
 * without looking, and two used `Number(x) || 0`, which lets Infinity through
 * because `Infinity || 0` is Infinity. Every one had to be found by reading, and
 * a regression looks exactly like the correct call. So the two idioms that were
 * wrong are named here, with the files allowed to use them and why.
 *
 * The correct call is `FieldUnit.toSi` / `onSi` / `clampEntry`
 * (src/prefs/entryValue.ts), which cannot put a number the tree has no answer
 * for into it.
 */

const SRC = join(__dirname, '..', '..', 'src');

/** Source with comments removed, so the prose explaining a fix cannot trip it. */
function code(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
    .replace(/[ \t]\/\/.*$/gm, '');
}

function sources(dir: string, out: { path: string; code: string }[] = []): { path: string; code: string }[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      sources(full, out);
    } else if (/\.tsx?$/.test(name)) {
      out.push({ path: relative(SRC, full).replace(/\\/g, '/'), code: code(readFileSync(full, 'utf8')) });
    }
  }
  return out;
}

/**
 * Files that may call the RAW conversion, each because the number is not on its
 * way into storage.
 */
const RAW_CONVERSION_ALLOWED = [
  /** Defines it. */
  'prefs/units.ts',
  /** Binds it onto FieldUnit and Units. */
  'prefs/useUnits.ts',
  /** A ruler step, computed from a constant and drawn — never stored. */
  'components/canvas/TreeSchematic.tsx',
];

/** Files that may fall back from a parsed number with `||`. */
const OR_FALLBACK_ALLOWED = [
  /**
   * Reads a finished flight series into the 3D scene. Not an entry: the numbers
   * come from the kernel, and a hole in a series is a missing sample to draw at
   * the origin, not a value anyone typed.
   */
  'components/canvas/flightScene.ts',
];

describe('entry-value coverage', () => {
  const files = sources(SRC);

  it('finds the source tree', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('converts typed numbers through toSi, never fromUi', () => {
    const offenders = files
      .filter((f) => !RAW_CONVERSION_ALLOWED.includes(f.path))
      .filter((f) => /\bfromUi\(/.test(f.code))
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  /**
   * `Number(x) || 0` fires on NaN and on 0 and does nothing at all for
   * Infinity, so it reads like a guard and is not one. It is how an infinite
   * ignition delay reached the kernel and an infinite stride reached the saved
   * export options.
   */
  it('never falls back from a parsed number with ||', () => {
    const offenders = files
      .filter((f) => !OR_FALLBACK_ALLOWED.includes(f.path))
      .filter((f) => /(?:Number|parseFloat|parseInt)\([^)]*\)\s*\|\|/.test(f.code))
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });
});
