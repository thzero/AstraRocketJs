import { describe, it, expect } from 'vitest';
import { delayString, motorDesignation, motorName } from '../../../src/services/motors/motorName';
import { PLUGGED_DELAY, type MotorSpec } from '../../../src/engine/openRocketEngine';

/**
 * How a seated motor is named.
 *
 * The delay is half of what motor a rocket is flying, because it is when the
 * nose comes off, so a readout that says only "C6" has not said which motor. The
 * format is the desktop's own (`ThrustCurveMotor.getDelayString`), which is also
 * what is printed on the casing.
 */
const spec = (designation: string, ejectionDelay: number) => ({ designation, ejectionDelay }) as unknown as MotorSpec;

describe('delayString', () => {
  it('writes a whole number without a trailing zero', () => {
    expect(delayString(5)).toBe('5');
    expect(delayString(0)).toBe('0');
  });

  it('keeps a fractional delay, to a tenth', () => {
    expect(delayString(4.5)).toBe('4.5');
    expect(delayString(4.54)).toBe('4.5');
  });

  it('writes a plugged motor as P', () => {
    // The letter on the casing, and NOT translated: a C6-P that read C6-T in
    // another language would name a motor nobody sells.
    expect(delayString(PLUGGED_DELAY)).toBe('P');
  });
});

describe('motorDesignation', () => {
  it('names the motor and the charge it was seated on', () => {
    expect(motorDesignation(spec('C6', 5))).toBe('C6-5');
    expect(motorDesignation(spec('C6', PLUGGED_DELAY))).toBe('C6-P');
  });

  it('says nothing at all for a mount with no motor in it', () => {
    // An unresolved `.ork` motor is seated as a nameless placeholder; a bare
    // "-5" would read as a motor.
    expect(motorDesignation(spec('', 5))).toBe('');
  });
});

describe('a motor that shares its common name', () => {
  it('is named by its full designation, so F67C and F67W read apart', () => {
    expect(motorDesignation({ designation: 'F67', code: 'F67W', ejectionDelay: 9 })).toBe('F67W-9');
    expect(motorDesignation({ designation: 'F67', code: 'F67C', ejectionDelay: 9 })).toBe('F67C-9');
  });

  it('falls back to the common name when there is no full one', () => {
    expect(motorName({ designation: 'C6' })).toBe('C6');
  });
});
