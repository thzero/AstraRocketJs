import type { StaticInfo } from '../engine/openRocketEngine';
import type { ReportModel } from './reportModel';
import type { DesignInfo, DesignFinSet, DesignStat, DesignStatGroup } from './orkTypes';

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
 * Round to 4 significant figures, rendered as a plain decimal string — no
 * exponent, no trailing zeros. e.g. 0.4250 → "0.425", 24993 → "24990",
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

/** The statistic rows for one rocket/stage. Omits any value that can't be
 *  computed (non-finite), and CP/stability when there are no aero surfaces. */
function statsFor(info: StaticInfo, cd: number | undefined): DesignStat[] {
  const stats: DesignStat[] = [];
  const push = (field: string, value: number, unit: string) => {
    if (Number.isFinite(value)) stats.push({ field, value: sig4(value), unit });
  };
  push('Length', info.length, M);
  push('Max Diameter', info.refDiameter, M);
  push('Mass (Empty)', info.massEmpty, KG);
  push('Mass (Loaded)', info.mass, KG);
  if (info.refDiameter > 0) push('Fineness (L/D)', info.length / info.refDiameter, NONE);
  push('CG (Empty)', info.cgEmpty, M);
  push('CG (Loaded)', info.cg, M);
  // CP / stability are only meaningful once there's a normal-force slope (fins);
  // a finless design has no defined CP, so OpenRocket omits these.
  const hasAero = Number.isFinite(info.cna) && Math.abs(info.cna) > 1e-9;
  if (hasAero && Number.isFinite(info.cp) && info.cp > 0) {
    push('CP', info.cp, M);
    push('Stability (on pad)', info.stabilityCalibers, CAL);
    if (info.length > 0) push('Stability (%)', ((info.cp - info.cg) / info.length) * 100, PCT);
  }
  if (cd !== undefined) push(`Drag Coeff. (Ma ${CD_MACH})`, cd, NONE);
  if (hasAero) push('Normal-Force Slope (CNα)', info.cna, PER_RAD);
  push('Pitch Inertia (Loaded)', info.pitchInertia, INERTIA);
  push('Roll Inertia (Loaded)', info.rollInertia, INERTIA);
  return stats;
}

export function buildDesignInfo(report: ReportModel): DesignInfo {
  const groups: DesignStatGroup[] = [];

  // Whole rocket (all stages active). Only the live whole-rocket info carries cd.
  groups.push({ scope: 'rocket', stats: statsFor(report.whole.info, report.whole.info.cd) });

  // Per-stage — multi-stage designs only (a single stage IS the whole rocket).
  if (report.stageSummaries.length > 1) {
    report.stageSummaries.forEach((s, i) => {
      groups.push({ scope: 'stage', stageNumber: i, name: s.label, stats: statsFor(s.info, s.info.cd) });
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
