import type { ReportModel } from './reportModel';
import { fmtNum } from '../../i18n/format';
import { NO_VALUE } from '../../i18n/noValue';
import { G0 } from '../motors/motorMath';
import {
  ensure,
  g,
  heading,
  kvGrid,
  paragraph,
  q,
  qv,
  sectionBreak,
  sub,
  table,
  type Col,
  type PdfPage,
  type T,
} from './pdfPage';

type MotorConfig = ReportModel['configs'][number];

/**
 * The motors section: one block per configuration that carries motors, with
 * its simulation results (when it flew) and its motor table. Results flown
 * from an earlier state of the design say so above their figures, since the
 * thrust-to-weight beside them is the current design's.
 */
export function writeMotorsSection(p: PdfPage, model: ReportModel): void {
  sectionBreak(p);
  heading(p, p.t('report.motors'));
  for (const c of model.configs) {
    if (!c.motors.length) continue;
    sub(p, c.name);
    if (c.flight) {
      if (c.outdated) {
        ensure(p, 8);
        paragraph(p, p.t('report.outdatedFlight'), 'italic', 60);
      }
      writeFlightSummary(p, c.flight);
    }
    writeMotorTable(p, c);
  }
}

/** The simulation results grid for one configuration. */
function writeFlightSummary(p: PdfPage, flight: NonNullable<MotorConfig['flight']>): void {
  const { t } = p;
  kvGrid(p, [
    [t('report.altitude'), q(p, 'distance', flight.maxAltitude, 0)],
    [t('report.flightTime'), `${fmtNum(flight.flightTime, 1)} s`],
    [t('report.timeToApogee'), `${fmtNum(flight.timeToApogee, 1)} s`],
    [t('report.velOffRod'), q(p, 'velocity', flight.launchRodVelocity)],
    [t('report.maxVel'), q(p, 'velocity', flight.maxVelocity, 0)],
    [t('report.velDeploy'), flight.deploymentVelocity != null ? q(p, 'velocity', flight.deploymentVelocity) : NO_VALUE],
    [t('report.landingVel'), q(p, 'velocity', flight.groundHitVelocity)],
  ]);
}

/**
 * Average thrust over the weight of the stack the motor lifts, as `n.nn:1`. A
 * mass the kernel could not give has no ratio.
 */
export function twRatio(avgThrust: number, loadedMass: number): string {
  const ratio = avgThrust / (loadedMass * G0);
  return Number.isFinite(ratio) && loadedMass > 0 ? `${fmtNum(ratio, 2)}:1` : NO_VALUE;
}

/** The motor table's columns, across a content width of `w` millimeters. */
export function motorColumns(t: T, w: number): Col[] {
  return [
    { title: t('report.motor'), w: w * 0.22 },
    { title: t('report.avgThrust'), w: w * 0.12, align: 'right' },
    { title: t('report.burnTime'), w: w * 0.11, align: 'right' },
    { title: t('report.maxThrust'), w: w * 0.11, align: 'right' },
    { title: t('report.totalImpulse'), w: w * 0.14, align: 'right' },
    { title: t('report.twRatio'), w: w * 0.1, align: 'right' },
    { title: t('report.motorWt'), w: w * 0.1, align: 'right' },
    { title: t('report.size'), w: w * 0.1, align: 'right' },
  ];
}

function writeMotorTable(p: PdfPage, c: MotorConfig): void {
  const { t, units } = p;
  const cols = motorColumns(t, p.CW);
  // Motor sizes are whole millimeters; in centimeters or inches they follow
  // the ladder, so a 24 mm motor is 0.945 in, not 1. A decimal in millimeters
  // would also overrun the column for a 98 mm motor a meter long.
  const sizeDigits = units.motorDimensions === 'mm' ? 0 : undefined;
  const rows = c.motors.map((m) => [
    `${m.manufacturer ? m.manufacturer + ' ' : ''}${m.designation}`,
    q(p, 'force', m.avgThrust),
    Number.isFinite(m.burnTime) ? `${fmtNum(m.burnTime, 2)} s` : NO_VALUE,
    q(p, 'force', m.maxThrust),
    q(p, 'impulse', m.totalImpulse),
    twRatio(m.avgThrust, m.loadedMass),
    g(p, m.weight),
    `${qv(p, 'motorDimensions', m.diameter, sizeDigits)}/${qv(p, 'motorDimensions', m.length, sizeDigits)} ${units.motorDimensions}`,
  ]);
  rows.push([
    t('report.total'),
    '',
    '',
    '',
    q(
      p,
      'impulse',
      c.motors.reduce((a, m) => a + m.totalImpulse, 0),
    ),
    '',
    g(
      p,
      c.motors.reduce((a, m) => a + m.weight, 0),
    ),
    '',
  ]);
  table(p, cols, rows, true);
}
