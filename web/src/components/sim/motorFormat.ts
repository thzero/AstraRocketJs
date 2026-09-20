import { fmtNum } from '../../i18n/format';
import type { Units } from '../../prefs/useUnits';
import type { Quantity } from '../../prefs/units';

/**
 * The two readout formatters the motor panels share. They were re-declared
 * as local `g` / `q` arrows in MotorDetail, MotorSpecDialog and MotorDashboard.
 */

/** A number with a FIXED unit (seconds, a percent): "1.20 s", or a dash when absent. */
export const withUnit = (v: number | null | undefined, unit: string, digits = 1): string =>
  v == null || !Number.isFinite(v) ? '—' : `${fmtNum(v, digits)} ${unit}`;

/**
 * An SI value in the user's unit with its symbol: "61.0 N·s". `scale` lifts a
 * catalog field (mm / g, see CatalogMotor) to SI first; MotorSpec fields are
 * already SI and pass 1.
 */
export const inUserUnit = (
  u: Units,
  quantity: Quantity,
  v: number | null | undefined,
  scale = 1,
  digits?: number,
): string => (v == null || !Number.isFinite(v) ? '—' : `${u.fmt(quantity, v * scale, digits)} ${u.sym(quantity)}`);
