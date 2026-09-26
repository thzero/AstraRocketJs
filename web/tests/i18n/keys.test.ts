import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import en from '../../src/i18n/locales/en.json';

/**
 * Every English key must be reachable from the source.
 *
 * A key nothing calls `t()` with is a dead string: it costs translators a
 * line in every locale and hides which strings the UI actually shows. Most
 * keys are referenced by a quoted literal (`t('sim.noMount')`, or a table
 * entry like `labelKey: 'flight.altitude'`), so a literal grep of the source
 * finds them. The rest are BUILT at runtime from a prefix and a value
 * (`t(\`part.${node.type}\`)`); those prefixes are listed here, each with the
 * expression that builds it, so an unlisted dynamic family fails loudly
 * rather than being assumed.
 */

type Tree = { [k: string]: string | Tree };

function flatten(node: Tree, prefix = '', out: string[] = []): string[] {
  for (const [k, v] of Object.entries(node)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out.push(key);
    else flatten(v, key, out);
  }
  return out;
}

/** Every non-test source file under src, concatenated. */
function sourceText(): string {
  // Out of tests/i18n and into the SOURCE tree, which is what this scans.
  const root = join(__dirname, '../../src');
  const chunks: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        if (name === 'locales' || name === 'vendor') continue;
        walk(p);
      } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) {
        chunks.push(readFileSync(p, 'utf8'));
      }
    }
  };
  walk(root);
  return chunks.join('\n');
}

/**
 * Key families built at runtime: `prefix` is what the code concatenates, and
 * the comment says where. Keep this list honest: a prefix here is a promise
 * that SOME call site builds keys under it.
 */
const DYNAMIC_PREFIXES: string[] = [
  'part.', // t(`part.${node.type}`) - component type names (schematic, tree, runnability)
  'part.field.', // t(`part.field.${d.field}`) - runnability.designBlockerText
  // t(`settings.materialSlot.${part}` / `${part}_${material}`) - the Materials
  // tab's row labels. Only the slots whose part name is not label enough have
  // a key; the rest fall back to `part.<type>` through defaultValue.
  'settings.materialSlot.',
  'view.', // t(`view.${v}`), t(`view.ruler_${side}`) - ViewToggle, rulers
  'pathExport.fmt.', // t(`pathExport.fmt.${f.id}`) - flight-path export formats
  'pathExport.preset.', // t(`pathExport.preset.${preset.id}`) and `${id}Note`
  'pathExport.doc.', // buildLabels() - the strings the built-in export templates write INTO the file
  'deployEvent.', // `${f.optI18n}.${o}` - componentFields option labels
  'separationEvent.', // same
  'radiusMethod.', // same
  'noseShape.', // same - the nose cone and transition shape lists
  'tabOffsetMethod.', // same - what a fin tab's offset is measured from
  'positionFrom.', // t(`positionFrom.${m}`) - PlacementSection's own select
  'units.q.', // t(`units.q.${q}`) - unit quantity names
  'dash.', // t(`dash.${c.label}`) - motor dashboard columns
  'prop.', // t(`prop.${f.label}`) - property panel field labels
  'tree.', // t(`tree.${g.group}`) - tree group headings
  'settings.part.', // t(`settings.part.${key}`) - part color settings
  'windProfile.', // t(`windProfile.${r}`), `.csv.${e.key}`, `${reference}Short`
  'launch.turbulenceLevel.', // t(`launch.turbulenceLevel.${...}`)
  'launch.windModel_', // t(`launch.windModel_${m}`)
  'launch.field.', // t(`launch.field.${k}`) - runnability.unflyableText
  'recovery.verdict.', // t(`recovery.verdict.${sizing.verdict}`)
  'motorDlg.', // t(`motorDlg.${TYPE_KEY[motor.type]}`)
  'ignition.', // t(`ignition.${ev}`)
  'export.units_', // t(`export.units_${c}`)
  'config.type_', // t(`config.type_${tk}`)
  'warn.', // `warn.${key}` - warningText.ts:80, per kernel warning code
  'warnHelp.', // `warnHelp.${key}` - warningText.ts:66, the longer explanation
];

/**
 * i18next plural forms: `sim.skipping_one` / `sim.skipping_other` are both
 * reached by `t('sim.skipping', { count })`, so the suffix is not part of what
 * the source references.
 */
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

const KNOWN_DEAD: string[] = [];

describe('en.json keys', () => {
  it('are each referenced literally in src, or built under a listed dynamic prefix', () => {
    const src = sourceText();
    const referenced = (key: string) =>
      src.includes(`'${key}'`) || src.includes(`"${key}"`) || src.includes(`\`${key}\``);
    const dead = flatten(en as Tree).filter((full) => {
      const key = full.replace(PLURAL_SUFFIX, '');
      return !referenced(key) && !DYNAMIC_PREFIXES.some((p) => key.startsWith(p)) && !KNOWN_DEAD.includes(key);
    });
    expect(dead).toEqual([]);
  });

  it('every listed dynamic prefix is actually built somewhere', () => {
    // A prefix nobody builds keys under would let a whole dead family hide
    // behind the allowlist.
    const src = sourceText();
    const unbuilt = DYNAMIC_PREFIXES.filter((p) => {
      // Either the template literal opens with the prefix, or the stem is a
      // quoted value some table joins with '.' (`optI18n: 'deployEvent'`).
      const stem = p.replace(/[._]$/, '');
      return !src.includes(`\`${p}`) && !src.includes(`'${stem}'`) && !src.includes(`'${p}'`);
    });
    expect(unbuilt).toEqual([]);
  });
});
