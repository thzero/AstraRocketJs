import { useMemo } from 'react';
import { useSettings } from '../state/SettingsProvider';
import { fmtNum, ladderDigits, withUnit } from '../i18n/format';
import { niceStep, siToUi, siToUiDelta, uiToSi, unitFor, type Quantity, type UnitSelection } from './units';
import { siEntry } from './entryValue';

/** Locale-aware formatting with a magnitude ladder when no precision is asked. */
function format(v: number, digits?: number): string {
  if (!Number.isFinite(v)) return '—';
  return fmtNum(v, digits ?? ladderDigits(v));
}

/** One field's unit, already resolved — the same helpers with the unit bound. */
export interface FieldUnit {
  /** The symbol this field is shown in. */
  sym: string;
  toUi: (si: number) => number;
  /**
   * The RAW conversion, for a number that is not being stored — a chart axis,
   * a ruler step, a readout. It can overflow, so an entry must not use it:
   * see {@link FieldUnit.toSi}.
   */
  fromUi: (ui: number) => number;
  /**
   * What a TYPED value means: the SI number to store, or `null` for "do not
   * store" (blank, or a value that cannot survive the conversion). This is the
   * call every data-entry box makes — see prefs/entryValue.
   *
   * `then` chains the extra leg for a field whose stored form is not SI, and
   * its result is checked too.
   */
  toSi: (ui: number | null | undefined, then?: (si: number) => number) => number | null;
  fmt: (si: number, digits?: number) => string;
  /** {@link FieldUnit.fmt} with the symbol, joined by `withUnit`. */
  fmtSym: (si: number, digits?: number) => string;
  step: (si: number) => number;
}

export interface Units {
  /** The Settings ▸ Units defaults — what an export writes, and what any field
   *  without an override of its own follows. */
  all: UnitSelection;
  /** The default symbol for a quantity, e.g. 'cm'. */
  sym: (q: Quantity) => string;
  /** SI → the displayed number. */
  toUi: (q: Quantity, si: number) => number;
  /**
   * The raw conversion the other way, for a number that is not being stored.
   * An entry uses {@link Units.toSi}, which cannot overflow into the tree.
   */
  fromUi: (q: Quantity, ui: number) => number;
  /** A typed-in number → the SI value to store, or `null` for "do not store". */
  toSi: (q: Quantity, ui: number | null | undefined, then?: (si: number) => number) => number | null;
  /**
   * SI → a locale-formatted string, no unit suffix. Omit `digits` to get a
   * magnitude ladder instead of a fixed count — which is what a readout wants
   * once the unit can change under it: "1234 mm" and "48.6 in" are both right,
   * where a hard-coded 0 dp would round that same length to "49 in".
   */
  fmt: (q: Quantity, si: number, digits?: number) => string;
  /** {@link Units.fmt} with the symbol, joined by `withUnit`: a degree sign
   *  closes up and every other symbol takes a space. */
  fmtSym: (q: Quantity, si: number, digits?: number) => string;
  /** An SI step (e.g. 0.001 m) → a "nice" spinner step in the user's unit. */
  step: (q: Quantity, si: number) => number;
  /**
   * Multiplier from SI to the user's unit, for scaling a whole series at once
   * (a chart axis, a mesh). Ignores the temperature offset, so it is a scale,
   * not a conversion — use `toUi` for a single reading.
   */
  factor: (q: Quantity) => number;
  /**
   * The same helpers bound to a quantity at the Settings default, for a box
   * that has NO chip of its own — a preference, a filter bound, a wind-profile
   * cell. It is `at` without a field scope, and it exists so such a box can
   * hand itself to `onSi` (prefs/entryValue) exactly like a scoped field does,
   * rather than spelling the conversion and its check out again.
   */
  plain: (q: Quantity) => FieldUnit;
  /**
   * The same helpers for ONE FIELD, honouring a unit set from that field's own
   * chip. Use it wherever a `<UnitChip scope=…>` is rendered, passing the same
   * scope; everything else (the tree, rulers, charts, exports) takes the
   * quantity-level calls above and follows Settings alone.
   *
   * A plain function rather than its own hook on purpose: fields are rendered
   * in loops, and a hook there would break the rules of hooks.
   */
  at: (scope: string, q: Quantity) => FieldUnit;
}

/**
 * Units for display and entry. Everything that PUTS A NUMBER ON SCREEN goes
 * through this; the tree, the kernel and saved files stay SI.
 *
 * Two layers: the Settings ▸ Units defaults, and per-field overrides set from
 * an inline chip. Only the preferences dialog writes the first, only a chip
 * writes the second, and a chip's reach stops at its own field.
 *
 * `fmt` is locale-aware (fmtNum) rather than units.ts's plain `fmtSi`, because
 * the decimal separator differs per language — fmtSi stays for export code,
 * which runs outside React and must not depend on the active i18n language.
 */
/**
 * A distance over the ground (a landing, a range ring), in a field's unit: whole
 * units from 100 up, one decimal below. The number alone, for a caller that
 * places the symbol itself.
 */
export function groundDistanceNumber(fu: FieldUnit, m: number): string {
  const v = fu.toUi(m);
  return fmtNum(v, Math.abs(v) >= 100 ? 0 : 1);
}

/** {@link groundDistanceNumber} with the unit symbol. */
export function fmtGroundDistance(fu: FieldUnit, m: number): string {
  return withUnit(groundDistanceNumber(fu, m), fu.sym);
}

export function useUnits(): Units {
  const { settings } = useSettings();
  const { units, unitOverrides } = settings;
  return useMemo(() => {
    const bind = (q: Quantity, sym: string): FieldUnit => {
      const fmt = (si: number, digits?: number) => (Number.isFinite(si) ? format(siToUi(q, sym, si), digits) : '—');
      return {
        sym,
        toUi: (si) => siToUi(q, sym, si),
        fromUi: (ui) => uiToSi(q, sym, ui),
        toSi: (ui, then) => siEntry(q, sym, ui, then),
        fmt,
        fmtSym: (si, digits) => withUnit(fmt(si, digits), sym),
        step: (si) => niceStep(siToUiDelta(q, sym, si)),
      };
    };
    const at = (scope: string, q: Quantity): FieldUnit => bind(q, unitFor(units, unitOverrides, q, scope));
    return {
      all: units,
      sym: (q) => units[q],
      toUi: (q, si) => siToUi(q, units[q], si),
      fromUi: (q, ui) => uiToSi(q, units[q], ui),
      toSi: (q, ui, then) => siEntry(q, units[q], ui, then),
      fmt: (q, si, digits) => (Number.isFinite(si) ? format(siToUi(q, units[q], si), digits) : '—'),
      fmtSym: (q, si, digits) =>
        withUnit(Number.isFinite(si) ? format(siToUi(q, units[q], si), digits) : '—', units[q]),
      step: (q, si) => niceStep(siToUiDelta(q, units[q], si)),
      factor: (q) => siToUiDelta(q, units[q], 1),
      plain: (q) => bind(q, units[q]),
      at,
    };
  }, [units, unitOverrides]);
}
