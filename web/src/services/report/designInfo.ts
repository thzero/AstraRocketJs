import type { StaticInfo } from '../../engine/openRocketEngine';
import type { ReportModel } from './reportModel';
import type { DesignInfo, DesignFinSet, DesignStat, DesignStatGroup } from '../files/orkTypes';

// Builds the optional <designinfo> block from the report model (whole-rocket +
// per-stage static info and fin-set positions). Pure data (type-only imports),
// so it has no runtime dependency on the engine or store and is easy to test.

/** The Mach number the coast drag coefficient is sampled at (matches the store's
 *  single-point drag sweep that fills StaticInfo.cd). */
const CD_MACH = 0.3;

// Unit tokens (SI base units for dimensional values; natural units otherwise).
const M = 'm';
const KG = 'kg';
const INERTIA = 'kg*m^2';
const CAL = 'cal';
const PCT = '%';
const PER_RAD = '1/rad';
const NONE = '';

/**
 * Round to 4 significant figures, rendered as a plain decimal string with no
 * exponent and no trailing zeros. e.g. 0.4250 → "0.425", 24993 → "24990",
 * 9.3e-6 → "0.0000093".
 */
export function sig4(v: number): string {
  if (!Number.isFinite(v) || v === 0) return '0';
  const mag = Math.floor(Math.log10(Math.abs(v)));
  const factor = 10 ** (3 - mag); // 4 sig figs = 3 fractional digits past the leading one
  const rounded = Math.round(v * factor) / factor;
  const decimals = Math.max(0, 3 - mag);
  let str = rounded.toFixed(Math.min(decimals, 100));
  if (str.includes('.')) str = str.replace(/0+$/, '').replace(/\.$/, '');
  return str;
}

/** One whole-rocket or per-stage statistic, by a stable key. */
export type StatKey =
  | 'length'
  | 'maxDiameter'
  | 'massEmpty'
  | 'massLoaded'
  | 'fineness'
  | 'cgEmpty'
  | 'cgLoaded'
  | 'cp'
  | 'stabilityCal'
  | 'stabilityPct'
  | 'cd'
  | 'cna'
  | 'pitchInertia'
  | 'rollInertia';

/** A statistic row: its key, its English field name (the .ork and CSV label),
 *  and its SI value. */
export interface StatRow {
  key: StatKey;
  field: string;
  value: number;
}

/**
 * Which statistics a rocket or stage has, in order: the one list the .ork
 * <designinfo> block, the design CSV and the PDF summary all write, each with
 * its own formatting. A finless design has no defined CP, so OpenRocket omits CP,
 * both stability rows and CNα; a design with no reference diameter has no
 * fineness. A non-finite value is left in for the writer to show its own way.
 */
export function staticInfoRows(info: StaticInfo): StatRow[] {
  const rows: StatRow[] = [];
  const add = (key: StatKey, field: string, value: number) => rows.push({ key, field, value });
  add('length', 'Length', info.length);
  add('maxDiameter', 'Max Diameter', info.refDiameter);
  add('massEmpty', 'Mass (Empty)', info.massEmpty);
  add('massLoaded', 'Mass (Loaded)', info.mass);
  if (info.refDiameter > 0) add('fineness', 'Fineness (L/D)', info.length / info.refDiameter);
  add('cgEmpty', 'CG (Empty)', info.cgEmpty);
  add('cgLoaded', 'CG (Loaded)', info.cg);
  const hasAero = Number.isFinite(info.cna) && Math.abs(info.cna) > 1e-9;
  if (hasAero && Number.isFinite(info.cp) && info.cp > 0) {
    add('cp', 'CP', info.cp);
    add('stabilityCal', 'Stability (on pad)', info.stabilityCalibers);
    // The engine's own figure, not ours: see StaticInfo.stabilityPercent. The
    // margin is over the aerodynamic length, which this module does not have.
    add('stabilityPct', 'Stability (%)', info.stabilityPercent);
  }
  if (info.cd != null) add('cd', `Drag Coeff. (Ma ${CD_MACH})`, info.cd);
  if (hasAero) add('cna', 'Normal-Force Slope (CNα)', info.cna);
  add('pitchInertia', 'Pitch Inertia (Loaded)', info.pitchInertia);
  add('rollInertia', 'Roll Inertia (Loaded)', info.rollInertia);
  return rows;
}

const UNIT: Record<StatKey, string> = {
  length: M,
  maxDiameter: M,
  massEmpty: KG,
  massLoaded: KG,
  fineness: NONE,
  cgEmpty: M,
  cgLoaded: M,
  cp: M,
  stabilityCal: CAL,
  stabilityPct: PCT,
  cd: NONE,
  cna: PER_RAD,
  pitchInertia: INERTIA,
  rollInertia: INERTIA,
};

/** The <designinfo> statistics for one rocket/stage: every row with a finite value. */
function statsFor(info: StaticInfo): DesignStat[] {
  return staticInfoRows(info)
    .filter((r) => Number.isFinite(r.value))
    .map((r) => ({ field: r.field, value: sig4(r.value), unit: UNIT[r.key] }));
}

export function buildDesignInfo(report: ReportModel): DesignInfo {
  const groups: DesignStatGroup[] = [];

  // Whole rocket (all stages active). Only the live whole-rocket info carries cd.
  groups.push({ scope: 'rocket', stats: statsFor(report.whole.info) });

  // Per-stage: multi-stage designs only (a single stage is the whole rocket).
  if (report.stageSummaries.length > 1) {
    report.stageSummaries.forEach((s, i) => {
      groups.push({ scope: 'stage', stageNumber: i, name: s.label, stats: statsFor(s.info) });
    });
  }

  // One <finset> per fin set; suffix duplicate names within a stage (#1, #2, …).
  const finsets: DesignFinSet[] = [];
  report.finSetsByStage.forEach((grp, stageNumber) => {
    const counts = new Map<string, number>();
    for (const set of grp.sets) counts.set(set.name, (counts.get(set.name) ?? 0) + 1);
    const seen = new Map<string, number>();
    for (const set of grp.sets) {
      let name = set.name;
      if ((counts.get(set.name) ?? 0) > 1) {
        const n = (seen.get(set.name) ?? 0) + 1;
        seen.set(set.name, n);
        name = `${set.name} #${n}`;
      }
      finsets.push({ stageNumber, stage: grp.stage, name, topX: set.topX, bottomX: set.bottomX });
    }
  });

  return { groups, finsets };
}
