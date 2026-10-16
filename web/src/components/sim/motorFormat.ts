import { fmtNum, withUnit } from '../../i18n/format';
import { NO_VALUE } from '../../i18n/noValue';
import type { TFunction } from 'i18next';
import type { Units } from '../../prefs/useUnits';
import type { Quantity } from '../../prefs/units';

/**
 * The readout formatters the motor panels share (MotorDetail, MotorSpecDialog,
 * MotorCombinePane and the dashboard grid), so they format readouts the same way.
 */

/** A number with a fixed unit (seconds, a percent): "1.20 s", or a dash when absent. */
export const withFixedUnit = (v: number | null | undefined, unit: string, digits = 1): string =>
  v == null || !Number.isFinite(v) ? NO_VALUE : withUnit(fmtNum(v, digits), unit);

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
): string =>
  v == null || !Number.isFinite(v) ? NO_VALUE : withUnit(u.fmt(quantity, v * scale, digits), u.sym(quantity));

const TYPE_KEY: Record<string, string> = { SU: 'typeSU', reload: 'typeReload', hybrid: 'typeHybrid' };

/** A catalog motor type ("SU", "reload", "hybrid") in the UI language; a type the catalog adds later shows as written. */
export const motorTypeLabel = (type: string, t: TFunction): string =>
  TYPE_KEY[type] ? t(`motorDlg.${TYPE_KEY[type]}`) : type;
