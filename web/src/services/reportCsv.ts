import type { StaticInfo } from '../engine/openRocketEngine';
import type { ReportModel } from './reportModel';
import { saveText } from './saveFile';
import { fmtSi, type UnitSelection } from '../prefs/units';

/**
 * Design-info CSV export — the same Scope / Field / Value / Unit layout
 * OpenRocket writes: a Design block, the whole-Rocket summary, one block per
 * stage, then each fin set's axial position. Field names are kept as stable
 * English data identifiers (not localised); values are in the units the user
 * has chosen, which every row names in its own Unit column. Values use '.' as
 * the decimal separator regardless of locale.
 */

/** Number → clean string with a fixed max decimals and a '.' decimal point. */
const round = (v: number, d: number): string => (Number.isFinite(v) ? Number(v.toFixed(d)).toString() : '');

/** RFC-4180 cell: quote when it contains a comma, quote or newline. */
const cell = (s: string): string => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/** [field, value, unit] rows for one summary, in the user's units. */
function summaryRows(info: StaticInfo, units: UnitSelection): [string, string, string][] {
  const pct = info.length > 0 ? ((info.cp - info.cg) / info.length) * 100 : 0;
  // `fmtSi`, not the locale-aware formatter: this is a data file, and its
  // decimal separator must not move with the UI language.
  const len = (si: number) => fmtSi('length', units.length, si, 3);
  const mass = (si: number) => fmtSi('mass', units.mass, si, 3);
  return [
    ['Length', len(info.length), units.length],
    ['Max Diameter', len(info.refDiameter), units.length],
    ['Mass (Empty)', mass(info.massEmpty), units.mass],
    ['Mass (Loaded)', mass(info.mass), units.mass],
    ['Fineness (L/D)', round(info.refDiameter > 0 ? info.length / info.refDiameter : 0, 2), ''],
    ['CG (Empty)', len(info.cgEmpty), units.length],
    ['CG (Loaded)', len(info.cg), units.length],
    ['CP', len(info.cp), units.length],
    ['Stability (on pad)', round(info.stabilityCalibers, 2), 'cal'],
    ['Stability (%)', round(pct, 1), '%'],
    ['Drag Coeff. (Ma 0.3)', info.cd != null ? round(info.cd, 3) : '', ''],
    ['Normal-Force Slope (CNα)', round(info.cna, 2), '/rad'],
    ['Pitch Inertia (Loaded)', round(info.pitchInertia, 6), 'kg·m²'],
    ['Roll Inertia (Loaded)', round(info.rollInertia, 6), 'kg·m²'],
  ];
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
      push(
        st.stage,
        `${label}Nose to bottom of fin root`,
        fmtSi('length', units.length, s.bottomX, 3),
        units.length,
      );
    }
  }

  return lines.join('\r\n') + '\r\n';
}

const safe = (name: string) => (name || 'rocket').trim().replace(/[^a-z0-9._-]+/gi, '_') || 'rocket';

/** Build and download the design-info CSV. */
export function downloadDesignCsv(model: ReportModel, units: UnitSelection): void {
  void saveText(buildDesignCsv(model, units), `${safe(model.name)}-design.csv`, 'text/csv;charset=utf-8');
}
