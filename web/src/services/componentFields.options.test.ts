import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from '../testing/dataDir';
import { FIELDS, type Field } from './componentFields';

/**
 * Every option in a `select` field has to be given a LABEL.
 *
 * `DimensionFields` renders an option as `optLabel(o, t)`, else
 * `t(`${optI18n}.${o}`)`, else the raw value — and that last fallback is not a
 * default so much as an oversight with a rendering. The nose cone's Shape
 * dropdown shipped reading `ogive / conical / ellipsoid / power / parabolic /
 * haack`, in lower case, beside fields whose every other label is capitalized
 * and translated; the fin tab's reference did the same with `top / middle /
 * bottom`. Nothing failed, because a raw enum value is a perfectly good string.
 *
 * So the fallback is fenced off here rather than removed: it stays in the
 * renderer for a field mid-edit, and a field that reaches FIELDS without a
 * label for each of its options fails.
 *
 * Both locales are read off disk. A key present in English and missing in
 * Spanish renders the English word inside a Spanish panel, which is the same
 * defect one language further along.
 */
const LOCALES = ['en', 'es'] as const;

/** The locale files, read the way the app ships them. `DATA_DIR` resolves from
 *  the repo rather than from `import.meta.url`, which a jsdom-flavored run
 *  turns into an http URL. */
const messages = Object.fromEntries(
  LOCALES.map((l) => [
    l,
    JSON.parse(readFileSync(join(DATA_DIR, '..', '..', 'src', 'i18n', 'locales', `${l}.json`), 'utf8')) as Record<
      string,
      unknown
    >,
  ]),
) as Record<(typeof LOCALES)[number], Record<string, unknown>>;

const lookup = (locale: (typeof LOCALES)[number], key: string): unknown =>
  key.split('.').reduce<unknown>((acc, part) => (acc as Record<string, unknown> | undefined)?.[part], messages[locale]);

const selects = Object.entries(FIELDS).flatMap(([type, fields]) =>
  fields.filter((f): f is Extract<Field, { kind: 'select' }> => f.kind === 'select').map((f) => ({ type, f })),
);

describe('select fields', () => {
  it('has some, or this whole file is passing on an empty list', () => {
    expect(selects.length).toBeGreaterThan(5);
  });

  it('gives every one a way to label its options', () => {
    const bare = selects.filter(({ f }) => !f.optI18n && !f.optLabel).map(({ type, f }) => `${type}.${f.key}`);
    expect(bare).toEqual([]);
  });

  it('resolves every option to a string in both locales', () => {
    const missing: string[] = [];
    for (const { type, f } of selects) {
      // An optLabel computes its text in code (the cluster patterns build
      // theirs from a count), so there is no key to look up.
      if (!f.optI18n) continue;
      for (const o of f.options) {
        for (const locale of LOCALES) {
          const v = lookup(locale, `${f.optI18n}.${o}`);
          if (typeof v !== 'string' || !v) missing.push(`${locale}: ${f.optI18n}.${o} (${type}.${f.key})`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('capitalizes the English option text, the way the field labels are', () => {
    // The defect this file exists for, stated directly: a dropdown of lower
    // case enum values under a capitalized label.
    const lower: string[] = [];
    for (const { f } of selects) {
      if (!f.optI18n) continue;
      for (const o of f.options) {
        const v = lookup('en', `${f.optI18n}.${o}`);
        if (typeof v === 'string' && v && v[0] !== v[0]!.toUpperCase()) lower.push(`${f.optI18n}.${o} = ${v}`);
      }
    }
    expect(lower).toEqual([]);
  });
});
