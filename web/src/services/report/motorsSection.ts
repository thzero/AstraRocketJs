import type { ReportModel } from '../reportModel';
import { fmtNum } from '../../i18n/format';
import { g, heading, kvGrid, q, qv, sectionBreak, sub, table, type Col, type PdfPage } from './pdfPage';

type MotorConfig = ReportModel['configs'][number];

/**
 * The motors section: one block per configuration that carries motors, with
 * its simulation results (when it flew) and its motor table.
 */
export function writeMotorsSection(p: PdfPage, model: ReportModel): void {
  sectionBreak(p);
  heading(p, p.t('report.motors'));
  for (const c of model.configs) {
    if (!c.motors.length) continue;
    sub(p, c.name);
    if (c.flight) writeFlightSummary(p, c.flight);
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
    [t('report.velDeploy'), flight.deploymentVelocity != null ? q(p, 'velocity', flight.deploymentVelocity) : '—'],
    [t('report.landingVel'), q(p, 'velocity', flight.groundHitVelocity)],
  ]);
}

function writeMotorTable(p: PdfPage, c: MotorConfig): void {
  const { t, units } = p;
  const w = p.CW;
  const cols: Col[] = [
    { title: t('report.motor'), w: w * 0.22 },
    { title: t('report.avgThrust'), w: w * 0.12, align: 'right' },
    { title: t('report.burnTime'), w: w * 0.11, align: 'right' },
    { title: t('report.maxThrust'), w: w * 0.11, align: 'right' },
    { title: t('report.totalImpulse'), w: w * 0.14, align: 'right' },
    { title: t('report.twRatio'), w: w * 0.1, align: 'right' },
    { title: t('report.motorWt'), w: w * 0.1, align: 'right' },
    { title: t('report.size'), w: w * 0.1, align: 'right' },
  ];
  const rows = c.motors.map((m) => [
    `${m.manufacturer ? m.manufacturer + ' ' : ''}${m.designation}`,
    q(p, 'force', m.avgThrust),
    `${fmtNum(m.burnTime, 2)} s`,
    q(p, 'force', m.maxThrust, 0),
    q(p, 'impulse', m.totalImpulse, 0),
    `${fmtNum(m.avgThrust / (c.loadedMass * 9.80665), 2)}:1`,
    g(p, m.weight),
    `${qv(p, 'motorDimensions', m.diameter, 0)}/${qv(p, 'motorDimensions', m.length, 0)} ${units.motorDimensions}`,
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
      0,
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
