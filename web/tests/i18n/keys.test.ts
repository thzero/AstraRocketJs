import { describe, it, expect, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import en from '../../src/i18n/locales/en.json';
import { DEPLOY_EVENTS, FIELDS } from '../../src/services/design/componentFields';
import { REQUIRED_COMPONENT_FIELDS } from '../../src/services/design/requiredComponent';
import { MATERIAL_SLOTS } from '../../src/services/design/materialSlots';
import { PART_KEYS } from '../../src/services/design/partColors';
import { THEME_PREFS } from '../../src/services/app/theme';
import { DESIGN_VIEWS, RESULT_VIEWS, TOOLS } from '../../src/state/tabs';
import { EXPORT_FORMATS } from '../../src/services/exports/flightPathExport';
import { EXPORT_PRESETS } from '../../src/services/exports/pathExportPresets';
import { PROPOSAL_GROUPS } from '../../src/services/weather/weatherProposal';
import { QUANTITIES, UNIT_CHOICES } from '../../src/prefs/units';
import { COLUMNS } from '../../src/components/sim/motorColumns';
import { REQUIRED_LAUNCH_KEYS } from '../../src/services/flight/requiredLaunch';
import { DESIGN_TYPES } from '../../src/engine/openRocketEngine';

// Both suites read and parse every file under src: half a second to a second
// alone, ten times that on a loaded CI runner, and the work grows with src.
vi.setConfig({ testTimeout: 60_000 });

/**
 * Every English key must be reachable from the source.
 *
 * A key nothing calls `t()` with is a dead string: it costs translators a
 * line in every locale and hides which strings the UI actually shows. Most
 * keys are referenced by a quoted literal (`t('sim.noMount')`, or a table
 * entry like `labelKey: 'flight.altitude'`), so a literal grep of the source
 * finds them. The rest are built at runtime from a prefix and a value
 * (`t(\`part.${node.type}\`)`); those families are listed here with the
 * values each one is built from, so a key no value builds is dead even when
 * its prefix is a dynamic one, and an unlisted dynamic family fails loudly
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
  // Out of tests/i18n and into the source tree, which is what this scans.
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
 * Key families built at runtime: `prefix` is what the code concatenates and
 * `values` the exact suffixes it can concatenate, so a key under the prefix
 * that no value builds is still reported as dead. Where the source keeps the
 * values in an exported table, the table is imported, so the list follows the
 * source; otherwise they are copied here with the place that builds them.
 */
const fieldTables = Object.values(FIELDS).flat();
const FIELD_OPTIONS = (family: string) =>
  fieldTables.flatMap((f) => (f.kind === 'select' && f.optI18n === family ? f.options : []));

/** Every `"Warning.X"` string the kernel source names: the keys its warnings carry. */
function kernelWarningKeys(): string[] {
  const root = join(__dirname, '../../../engine-java/src/java/info/openrocket/core');
  const keys = new Set<string>();
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith('.java'))
        for (const m of readFileSync(p, 'utf8').matchAll(/"Warning\.([A-Za-z0-9_.]+)"/g)) keys.add(m[1]!);
    }
  };
  walk(root);
  return [...keys];
}
const KERNEL_WARNINGS = kernelWarningKeys();

const NOSE_SHAPES = FIELD_OPTIONS('noseShape');

const DYNAMIC_FAMILIES: { prefix: string; values: readonly string[] }[] = [
  // t(`part.${node.type}`) - component type names (schematic, tree, runnability).
  // ComponentType in engine/openRocketEngine.ts is a type, not a value.
  {
    prefix: 'part.',
    values: [
      'stage',
      'nosecone',
      'transition',
      'bodytube',
      'trapezoidfinset',
      'ellipticalfinset',
      'freeformfinset',
      'tubefinset',
      'innertube',
      'tubecoupler',
      'centeringring',
      'bulkhead',
      'engineblock',
      'launchlug',
      'railbutton',
      'fairing',
      'parachute',
      'streamer',
      'shockcord',
      'masscomponent',
      'podset',
      'parallelstage',
    ],
  },
  // t(`part.field.${d.field}`) - runnability.designBlockerText, over badDimensions
  { prefix: 'part.field.', values: Object.values(REQUIRED_COMPONENT_FIELDS).flat() },
  // t(`settings.materialSlot.${part}` / `${part}_${material}`) - the Materials
  // tab's row labels. Only the slots whose part name is not label enough have
  // a key; the rest fall back to `part.<type>` through defaultValue.
  {
    prefix: 'settings.materialSlot.',
    values: MATERIAL_SLOTS.map(({ part, material }) => (material === 'bulk' ? part : `${part}_${material}`)),
  },
  { prefix: 'settings.themeOption.', values: THEME_PREFS }, // SettingsDialog's Theme choices
  { prefix: 'settings.part.', values: PART_KEYS }, // SettingsDialog's part colors
  // t(`view.${v}`) - ViewToggle; t(`view.ruler_${side}`) and `_abbr` - CenterToolbar, SettingsDialog
  {
    prefix: 'view.',
    values: [
      ...DESIGN_VIEWS,
      ...RESULT_VIEWS,
      ...['top', 'bottom', 'left', 'right'].flatMap((s) => [`ruler_${s}`, `ruler_${s}_abbr`]),
    ],
  },
  // t(`schematic.tag.${type}`) - TreeSchematic, for the internal parts schematicShapes tags
  {
    prefix: 'schematic.tag.',
    values: [
      'parachute',
      'streamer',
      'shockcord',
      'masscomponent',
      'centeringring',
      'bulkhead',
      'engineblock',
      'tubecoupler',
      'innertube',
    ],
  },
  { prefix: 'pathExport.fmt.', values: EXPORT_FORMATS.map((f) => f.id) }, // ExportFormatPicker
  // t(`pathExport.preset.${preset.id}`) and `${id}Note` - FlightPathExport
  { prefix: 'pathExport.preset.', values: EXPORT_PRESETS.flatMap((p) => [p.id, `${p.id}Note`]) },
  // buildLabels() in flightPathExport.ts, over its LABEL_KEYS
  {
    prefix: 'pathExport.doc.',
    values: [
      'rocket',
      'time',
      'configuration',
      'launchSite',
      'latLon',
      'aboveSeaLevel',
      'abovePad',
      'fromThePad',
      'maxAltitude',
      'maxVelocity',
      'maxAcceleration',
      'maxRange',
      'timeToApogee',
      'flightTime',
      'altitude',
      'position',
      'coordinates',
      'landing',
      'device',
      'flightPath',
      'groundTrack',
    ],
  },
  // `${f.optI18n}.${o}` - componentFields option labels, and the configuration
  // table and override sections, which offer the same lists
  { prefix: 'deployEvent.', values: [...FIELD_OPTIONS('deployEvent'), ...DEPLOY_EVENTS] },
  { prefix: 'crossSection.', values: FIELD_OPTIONS('crossSection') },
  { prefix: 'finish.', values: FIELD_OPTIONS('finish') },
  { prefix: 'massComponentType.', values: FIELD_OPTIONS('massComponentType') },
  { prefix: 'separationEvent.', values: FIELD_OPTIONS('separationEvent') },
  { prefix: 'radiusMethod.', values: FIELD_OPTIONS('radiusMethod') },
  { prefix: 'tabOffsetMethod.', values: FIELD_OPTIONS('tabOffsetMethod') },
  { prefix: 'noseShape.', values: NOSE_SHAPES }, // also ComponentPicker, SavedPartsDialog, the RASAero writer
  // t(`shapeDesc.${node.type}.${shape}`) - ShapeDescription, for the two shaped parts
  { prefix: 'shapeDesc.', values: ['nosecone', 'transition'].flatMap((p) => NOSE_SHAPES.map((s) => `${p}.${s}`)) },
  { prefix: 'weather.group.', values: PROPOSAL_GROUPS }, // WeatherDialog's checkbox labels
  // t(`weather.error.${err.kind}`) - weatherErrorText, over WeatherErrorKind
  {
    prefix: 'weather.error.',
    values: ['offline', 'timeout', 'aborted', 'refused', 'badKey', 'quota', 'http', 'shape', 'units', 'noData'],
  },
  // t(`weather.dateRefusal.${reason}`) - weatherErrorText, over DateRefusalReason
  { prefix: 'weather.dateRefusal.', values: ['tooFarAhead', 'tooEarly', 'badDate'] },
  // t(`env.q.${q}`) - EnvironmentView's PAD and CHARTS quantities
  {
    prefix: 'env.q.',
    values: ['windSpeed', 'windDirection', 'temperature', 'pressure', 'density', 'speedOfSound'],
  },
  { prefix: 'landing.recovery_', values: ['single', 'dual'] }, // LandingEstimator's radios
  { prefix: 'tools.tool_', values: TOOLS }, // ToolsPane's tab per tool
  { prefix: 'positionFrom.', values: ['top', 'middle', 'bottom', 'absolute'] }, // PlacementSection
  { prefix: 'units.q.', values: QUANTITIES }, // SettingsDialog, UnitChip
  { prefix: 'dash.', values: COLUMNS.map((c) => c.label) }, // motor dashboard columns
  // t(`prop.${f.label}`) and `prop.${f.auto.tip}` - DimensionFields; the split
  // buttons - ComponentActions; t(`prop.${r.field}`) - repairValues, for density
  {
    prefix: 'prop.',
    values: [
      ...fieldTables.map((f) => f.label),
      ...fieldTables.flatMap((f) => (f.auto ? [f.auto.tip] : [])),
      'splitFins',
      'splitPods',
      'splitBoosters',
      'density',
    ],
  },
  // t(`tree.${g.group}`) - ComponentTree's ADD_GROUPS
  {
    prefix: 'tree.',
    values: ['groupBody', 'groupFins', 'groupInner', 'groupRecovery', 'groupOther', 'groupAssembly'],
  },
  // t(`windProfile.${r}`) and `${reference}Short` - WindProfileDialog, LaunchPanel;
  // `.csv.${e.key}` - the WindProfileCsvError keys in windProfileCsv.ts
  {
    prefix: 'windProfile.',
    values: [
      'msl',
      'agl',
      'mslShort',
      'aglShort',
      ...['emptyFile', 'missingColumns', 'shortRow', 'badNumber', 'noData'].map((k) => `csv.${k}`),
    ],
  },
  // t(`launch.turbulenceLevel.${turbulenceLevel(intensity)}`) - windTurbulence.ts
  {
    prefix: 'launch.turbulenceLevel.',
    values: ['none', 'veryLow', 'low', 'medium', 'high', 'veryHigh', 'extreme'],
  },
  { prefix: 'launch.windModel_', values: ['average', 'multilevel'] }, // LaunchPanel
  { prefix: 'launch.field.', values: REQUIRED_LAUNCH_KEYS }, // runnability.unflyableText
  // t(`recovery.verdict.${verdict}`) - SizingFigures, over RateVerdict
  { prefix: 'recovery.verdict.', values: ['slow', 'main', 'between', 'drogue', 'fast'] },
  { prefix: 'motorDlg.', values: ['typeSU', 'typeReload', 'typeHybrid'] }, // motorFormat's TYPE_KEY
  // t(`ignition.${ev}`) - MotorRow, configColumns, over IgnitionEvent
  { prefix: 'ignition.', values: ['automatic', 'launch', 'ejectioncharge', 'burnout', 'never'] },
  { prefix: 'export.units_', values: UNIT_CHOICES }, // ExportDialog
  { prefix: 'config.type_', values: DESIGN_TYPES }, // RocketConfigDialog
  // `warn.${key}` - warningText(), and `warnHelp.${key}` - warningHelp(), where
  // the key is read from the kernel's message ("[Warning.LargeAOA.str2] ...")
  { prefix: 'warn.', values: KERNEL_WARNINGS },
  { prefix: 'warnHelp.', values: KERNEL_WARNINGS },
  // t(`material.groups.${group}`) - MaterialPicker group headings: desktop's
  // MaterialGroup names, the catalog's Paper and Adhesives, and Custom.
  {
    prefix: 'material.groups.',
    values: [
      'Metals',
      'Woods',
      'Plastics',
      'Fabrics',
      'Paper',
      'PaperProducts',
      'Foams',
      'Composites',
      'Fibers',
      'Elastics',
      'Kevlars',
      'Nylons',
      'Other',
      'Custom',
      'Adhesives',
    ],
  },
];

const DYNAMIC_KEYS = new Set(DYNAMIC_FAMILIES.flatMap((f) => f.values.map((v) => f.prefix + v)));

/**
 * i18next plural forms: `sim.skipping_one` / `sim.skipping_other` are both
 * reached by `t('sim.skipping', { count })`, so the suffix is not part of what
 * the source references.
 */
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

/**
 * The launcher variants: `withLauncher` (services/design/launcher.ts) passes the
 * design's launcher as i18next context, so `sim.rodExit` is also read as
 * `sim.rodExit_rail` and `sim.rodExit_rod` without either being written out.
 */
const LAUNCHER_SUFFIX = /_(rail|rod)$/;

const KNOWN_DEAD: string[] = [];

describe('en.json keys', () => {
  it('are each referenced literally in src, or built by a listed dynamic family', () => {
    const src = sourceText();
    const referenced = (key: string) =>
      src.includes(`'${key}'`) || src.includes(`"${key}"`) || src.includes(`\`${key}\``);
    const dead = flatten(en as Tree).filter((full) => {
      const key = full.replace(PLURAL_SUFFIX, '');
      // Either the key itself or the base a launcher variant hangs off; a real
      // key that merely ends in `_rail` (`tools.tool_rail`) is the first case.
      const live = (k: string) => referenced(k) || DYNAMIC_KEYS.has(k) || KNOWN_DEAD.includes(k);
      return !live(key) && !live(key.replace(LAUNCHER_SUFFIX, ''));
    });
    expect(dead).toEqual([]);
  });

  it('every listed dynamic family is actually built somewhere', () => {
    // A prefix nobody builds keys under would let a whole dead family hide
    // behind the allowlist.
    const src = sourceText();
    const unbuilt = DYNAMIC_FAMILIES.map((f) => f.prefix).filter((p) => {
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
