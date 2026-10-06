import { PLUGGED_DELAY, type MotorSpec } from '../../engine/openRocketEngine';
import { roundTo } from '../app/numbers';

/**
 * A delay as a motor is labeled: `P` for plugged, else the number.
 *
 * Mirrors the kernel's `ThrustCurveMotor.getDelayString`, which is what the
 * desktop puts on screen and in a file: rounded to a tenth and printed as a
 * whole number when it is one, so a 5 s charge reads `5` and not `5.0`.
 *
 * `P` is not translated. It is the letter printed on the motor casing, the same
 * in every catalog, and a `C6-P` that read `C6-T` in German would name a motor
 * nobody sells. The long form in the motor card is a translated phrase.
 */
export function delayString(delay: number): string {
  if (delay >= PLUGGED_DELAY) return 'P';
  return String(roundTo(delay, 1));
}

/** A motor's name as shown: the full designation (`F67W`) when known, else the common name. */
export function motorName(spec: Pick<MotorSpec, 'designation' | 'code'>): string {
  return spec.code || spec.designation;
}

/**
 * How a SEATED motor is named: its name and the delay it was seated on,
 * `F67W-9`, or `C6-P` for a plugged one.
 *
 * The delay is half of what motor a rocket is flying - it is when the nose comes
 * off - so anywhere that names a seated motor without room to state the delay
 * separately names it this way, which is also how the desktop names it
 * (`Motor.getDesignation(delay)`). A motor CATALOG row is not seated and has no
 * delay yet, so the picker still lists a bare designation.
 */
export function motorDesignation(spec: Pick<MotorSpec, 'designation' | 'code' | 'ejectionDelay'>): string {
  if (!spec.designation) return '';
  return `${motorName(spec)}-${delayString(spec.ejectionDelay)}`;
}
