import type { MaterialDensity, ReportModel } from './reportModel';
import { fmtSig, partLabel } from '../../i18n/format';
import { NO_VALUE } from '../../i18n/noValue';
import { siToUi } from '../../prefs/units';
import { heading, len, q, qv, sectionBreak, sub, table, type Col, type PdfPage, type T } from './pdfPage';

type PartRow = ReportModel['partsByStage'][number]['rows'][number];

/** The components table: every part of every selected stage, by stage or as one list. */
export function writePartsSection(p: PdfPage, partsStages: ReportModel['partsByStage']): void {
  const { t, CW, opts } = p;
  sectionBreak(p);
  heading(p, t('report.partsDetail'));
  const cols = partColumns(t, CW);
  const toRow = (r: PartRow) => partRow(p, r);
  if (opts.showByStage) {
    for (const st of partsStages) {
      sub(p, `${t('report.stage')}: ${st.stage}`, 9);
      table(p, cols, st.rows.map(toRow));
    }
  } else {
    table(p, cols, partsStages.flatMap((st) => st.rows).map(toRow));
  }
}

/** The components table's columns, across a content width of `w` millimeters. */
export function partColumns(t: T, w: number): Col[] {
  return [
    { title: t('report.part'), w: w * 0.3 },
    { title: t('report.material'), w: w * 0.25 },
    { title: t('report.dimensions'), w: w * 0.32 },
    { title: t('report.mass'), w: w * 0.13, align: 'right' },
  ];
}

/**
 * A material density in the unit of its own kind: bulk, surface or line, to
 * four significant figures. Densities span seven orders of magnitude across
 * the three kinds (steel is 7850 kg/m³, a Kevlar thread 0.00015 kg/m), so a
 * fixed count of decimals is wrong in one unit or another.
 */
function density(p: PdfPage, kind: MaterialDensity, si: number): string {
  const unit = p.units[kind];
  return `${fmtSig(siToUi(kind, unit, si), 4)} ${unit}`;
}

function partRow(p: PdfPage, r: PartRow): string[] {
  const { t, units } = p;
  const dims = [
    r.outerR != null
      ? `Ø ${qv(p, 'length', r.outerR * 2)}${r.innerR != null ? '/' + qv(p, 'length', r.innerR * 2) : ''} ${units.length}`
      : '',
    // A transition: its fore end, then its aft end.
    r.foreR != null && r.aftR != null
      ? `Ø ${qv(p, 'length', r.foreR * 2)} → ${qv(p, 'length', r.aftR * 2)} ${units.length}`
      : '',
    r.length > 0 ? t('report.dimLength', { value: len(p, r.length) }) : '',
    r.span != null && r.span > 0 ? t('export.headerSpan', { value: len(p, r.span) }) : '',
    r.thickness != null ? t('report.dimWall', { value: `${qv(p, 'length', r.thickness)} ${units.length}` }) : '',
  ]
    .filter(Boolean)
    .join(' · ');
  return [
    `${'  '.repeat(r.depth)}${partLabel(t, r)}`,
    `${r.material ?? NO_VALUE}${r.density ? ` (${density(p, r.densityKind ?? 'density', r.density)})` : ''}`,
    dims,
    q(p, 'mass', r.mass, 2),
  ];
}
