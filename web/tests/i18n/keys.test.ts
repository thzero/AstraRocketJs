import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
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

/** Every non-test source file under src, as [path relative to src, text]. */
function sourceFiles(): [string, string][] {
  // Out of tests/i18n and into the SOURCE tree, which is what this scans.
  const root = join(__dirname, '../../src');
  const files: [string, string][] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        if (name === 'locales' || name === 'vendor') continue;
        walk(p);
      } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) {
        files.push([relative(root, p).replace(/\\/g, '/'), readFileSync(p, 'utf8')]);
      }
    }
  };
  walk(root);
  return files;
}

/** Every non-test source file under src, concatenated. */
function sourceText(): string {
  return sourceFiles()
    .map(([, text]) => text)
    .join('\n');
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
  'crossSection.', // same - the fin section (square / rounded / airfoil)
  'massComponentType.', // same - what a mass component represents
  'separationEvent.', // same
  'radiusMethod.', // same
  'noseShape.', // same - the nose cone and transition shape lists
  'shapeDesc.', // t(`shapeDesc.${node.type}.${shape}`) - ShapeDescription
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

/**
 * The other direction: every key the source names must exist in en.json.
 *
 * A key that is missing renders as the raw key in every locale, and i18next
 * says nothing. The source is parsed (not grepped) so a key is only read from
 * the places that carry one:
 *
 * - the first argument of `t(...)` or `<anything>.t(...)` (`i18n.t`,
 *   `i18nGlobal.t`, `p.t`): a string literal, both branches of a `?:`, the
 *   fallback of `??` or `||`, or a table lookup (`EVENT_LABEL[type]`,
 *   `WAYPOINT_LABEL_KEY.pad`) whose table is a const object literal in the same
 *   file or a uniquely named one elsewhere in src;
 * - `<Trans i18nKey="...">`;
 * - a `...Key: '...'` property (`labelKey: 'flight.altitude'`);
 * - any other string literal whose first dotted segment is an en.json
 *   namespace (`'flight.apogee'` in a lookup table, a key returned from a
 *   helper). These may also name an object, since some code joins a stem with
 *   a value (`optI18n: 'deployEvent'`).
 *
 * A template literal with a dynamic part (`t(\`part.${node.type}\`)`) is not
 * enumerated: its static head must be the start of at least one key.
 *
 * Arguments passed through a variable or a prop (`t(hint)`, `t(c.labelKey)`)
 * are not resolved here. The literal that feeds them is checked at its own
 * site by the rules above.
 */

const LEAVES = new Set(flatten(en as Tree));
const ALL_LEAVES = [...LEAVES];
const OBJECTS = new Set<string>();
(function collectObjects(node: Tree, prefix: string) {
  for (const [k, v] of Object.entries(node)) {
    if (typeof v === 'string') continue;
    const key = prefix ? `${prefix}.${k}` : k;
    OBJECTS.add(key);
    collectObjects(v, key);
  }
})(en as Tree, '');
const NAMESPACES = new Set(Object.keys(en));

/**
 * A key `t()` can resolve: the leaf itself, or a base whose plural forms
 * (`_one`, `_other`) or context forms (`_noWrap`) exist. i18next joins both
 * with `_` by default, and this app does not change the separator.
 */
const isLeafKey = (key: string) => LEAVES.has(key) || ALL_LEAVES.some((l) => l.startsWith(`${key}_`));

/** A dotted string that looks like a key under one of en.json's namespaces. */
const looksLikeKey = (s: string) => {
  const m = /^([A-Za-z]+)(\.[A-Za-z0-9_]+)+$/.exec(s);
  return m !== null && NAMESPACES.has(m[1]!);
};

type Miss = { file: string; line: number; key: string };

function unwrap(e: ts.Expression): ts.Expression {
  while (
    ts.isParenthesizedExpression(e) ||
    ts.isAsExpression(e) ||
    ts.isNonNullExpression(e) ||
    ts.isSatisfiesExpression(e)
  )
    e = e.expression;
  return e;
}

/** Top-level `const NAME = { ... }` object literals, for table lookups. */
function constTables(sf: ts.SourceFile): Map<string, ts.ObjectLiteralExpression> {
  const out = new Map<string, ts.ObjectLiteralExpression>();
  for (const stmt of sf.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    for (const d of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(d.name) || !d.initializer) continue;
      const init = unwrap(d.initializer);
      if (ts.isObjectLiteralExpression(init)) out.set(d.name.text, init);
    }
  }
  return out;
}

function findMissingKeys(): Miss[] {
  const parsed = sourceFiles().map(([file, text]) => ({
    file,
    sf: ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true),
  }));
  const local = new Map(parsed.map(({ file, sf }) => [file, constTables(sf)]));
  // A table imported from another file resolves only when its name is unique
  // across src, so a lookup never checks the wrong table.
  const global = new Map<string, ts.ObjectLiteralExpression | null>();
  for (const tables of local.values())
    for (const [name, obj] of tables) global.set(name, global.has(name) ? null : obj);

  const missing: Miss[] = [];
  for (const { file, sf } of parsed) {
    const tables = local.get(file)!;
    const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
    const requireLeaf = (n: ts.Node, key: string) => {
      if (!isLeafKey(key)) missing.push({ file, line: lineOf(n), key });
    };
    const requirePrefix = (n: ts.Node, head: string) => {
      if (!ALL_LEAVES.some((l) => l.startsWith(head))) missing.push({ file, line: lineOf(n), key: `${head}\${...}` });
    };

    /** Check whatever literal keys an argument to `t()` can evaluate to. */
    const checkArg = (raw: ts.Expression) => {
      const e = unwrap(raw);
      if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) requireLeaf(e, e.text);
      else if (ts.isTemplateExpression(e)) {
        if (e.head.text) requirePrefix(e, e.head.text);
      } else if (ts.isConditionalExpression(e)) {
        checkArg(e.whenTrue);
        checkArg(e.whenFalse);
      } else if (
        ts.isBinaryExpression(e) &&
        (e.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
          e.operatorToken.kind === ts.SyntaxKind.BarBarToken)
      ) {
        checkArg(e.left);
        checkArg(e.right);
      } else if (
        (ts.isElementAccessExpression(e) || ts.isPropertyAccessExpression(e)) &&
        ts.isIdentifier(e.expression)
      ) {
        const table = tables.get(e.expression.text) ?? global.get(e.expression.text);
        for (const prop of table?.properties ?? []) {
          if (ts.isPropertyAssignment(prop)) {
            const v = unwrap(prop.initializer);
            if (ts.isStringLiteral(v) || ts.isNoSubstitutionTemplateLiteral(v)) requireLeaf(v, v.text);
          }
        }
      }
    };

    const visit = (n: ts.Node) => {
      if (ts.isCallExpression(n) && n.arguments[0]) {
        const callee = n.expression;
        const name = ts.isIdentifier(callee)
          ? callee.text
          : ts.isPropertyAccessExpression(callee)
            ? callee.name.text
            : '';
        if (name === 't') checkArg(n.arguments[0]);
      } else if (ts.isJsxAttribute(n) && n.name.getText() === 'i18nKey' && n.initializer) {
        if (ts.isStringLiteral(n.initializer)) requireLeaf(n.initializer, n.initializer.text);
      } else if (
        ts.isPropertyAssignment(n) &&
        /Key$/.test(n.name.getText()) &&
        (ts.isStringLiteral(n.initializer) || ts.isNoSubstitutionTemplateLiteral(n.initializer))
      ) {
        requireLeaf(n.initializer, n.initializer.text);
      } else if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && looksLikeKey(n.text)) {
        if (!isLeafKey(n.text) && !OBJECTS.has(n.text)) missing.push({ file, line: lineOf(n), key: n.text });
      } else if (ts.isTemplateExpression(n) && looksLikeKey(n.head.text.replace(/[._]$/, ''))) {
        requirePrefix(n, n.head.text);
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  // A literal can be reached by more than one rule; report it once.
  const seen = new Set<string>();
  return missing.filter((m) => {
    const id = `${m.file}:${m.line}:${m.key}`;
    return seen.has(id) ? false : (seen.add(id), true);
  });
}

describe('keys named in src', () => {
  it('each exist in en.json (or as plural or context forms of one)', () => {
    const missing = findMissingKeys().map((m) => `${m.file}:${m.line} ${m.key}`);
    expect(missing).toEqual([]);
  });
});
