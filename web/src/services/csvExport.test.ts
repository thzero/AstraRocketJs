import { describe, it, expect } from 'vitest';
import { flightDataCsv, dragTableCsv } from './csvExport';
import type { FlightResult, DragSweep } from '../engine/openRocketEngine';

const result = {
  series: {
    time: [0, 1],
    altitude: [0, 100],
    velocity: [0, 50],
    acceleration: [10, 20],
    mass: [0.05, 0.04], // kg → g ×1000
    thrust: [6, 0],
    drag: [0, 1],
    mach: [0, 0.3],
    stability: [1.5, 2.0],
    cpLocation: [0.223, 0.225], // m → cm ×100
    cgLocation: [0.2, 0.21], // m → cm ×100
    aoa: [0, Math.PI / 180], // rad → deg
  },
  events: [
    { type: 'BURNOUT', time: 1.0 },
    { type: 'APOGEE', time: 5.234 },
  ],
} as unknown as FlightResult;

describe('flightDataCsv', () => {
  const csv = flightDataCsv(result);
  const lines = csv.split('\r\n');

  it('uses CRLF line endings and a trailing newline', () => {
    expect(csv.includes('\r\n')).toBe(true);
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  it('prefixes OpenRocket-style event comment rows (time to 3 dp)', () => {
    expect(lines[0]).toBe('# Event BURNOUT at t=1.000 s');
    expect(lines[1]).toBe('# Event APOGEE at t=5.234 s');
  });

  it('emits the metric column header', () => {
    expect(lines[2]).toBe(
      'Time (s),Altitude (m),Velocity (m/s),Acceleration (m/s^2),Mass (g),Thrust (N),Drag (N),Mach,Stability (cal),CP (cm),CG (cm),AoA (deg)',
    );
  });

  it('applies unit conversions per row (mass×1000, cp/cg×100, aoa→deg)', () => {
    // data rows follow the 2 event lines + 1 header line
    expect(lines[3]).toBe('0.0000,0,0,10,50,6,0,0,1.5,22.3,20,0');
    expect(lines[4]).toBe('1.0000,100,50,20,40,0,1,0.3,2,22.5,21,1');
  });

  it('renders null / non-finite cells as empty', () => {
    const r = {
      series: { time: [0], altitude: [null], velocity: [NaN] },
      events: [],
    } as unknown as FlightResult;
    const row = flightDataCsv(r).split('\r\n')[1]; // header is line 0 (no events)
    expect(row!.startsWith('0.0000,,,')).toBe(true);
  });
});

const sweep = {
  machs: [0.5],
  powerOff: { total: [0.5], friction: [0.1], pressure: [0.2], base: [0.2] },
  powerOn: { total: [0.6] },
  cp: [0.223],
  cna: [2.0],
  hasNozzle: true,
  components: [{ name: 'Nose[1],x', cd: [0.05] }],
} as unknown as DragSweep;

describe('dragTableCsv', () => {
  it('includes the Cd_powerOn column and sanitizes component header names', () => {
    const lines = dragTableCsv(sweep).split('\r\n');
    // brackets stripped, comma → semicolon
    expect(lines[0]).toBe('Mach,Cd,Cd_friction,Cd_pressure,Cd_base,Cd_powerOn,CP (cm),CNalpha (/rad),Cd_Nose1;x');
    expect(lines[1]).toBe('0.500,0.5,0.1,0.2,0.2,0.6,22.3,2,0.05');
  });

  it('omits the Cd_powerOn column when there is no nozzle', () => {
    const noNozzle = { ...sweep, hasNozzle: false } as unknown as DragSweep;
    const header = dragTableCsv(noNozzle).split('\r\n')[0];
    expect(header!.includes('Cd_powerOn')).toBe(false);
  });
});
