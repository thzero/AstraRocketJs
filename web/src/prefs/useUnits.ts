import { useMemo } from 'react';
import { useSettings } from '../state/SettingsProvider';
import { fmtNum, ladderDigits } from '../i18n/format';
import { niceStep, siToUi, siToUiDelta, uiToSi, unitFor, type Quantity, type UnitSelection } from './units';

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
  fromUi: (ui: number) => number;
  fmt: (si: number, digits?: number) => string;
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
  /** A typed-in number → SI, for writing back to the tree / kernel. */
  fromUi: (q: Quantity, ui: number) => number;
  /**
   * SI → a locale-formatted string, no unit suffix. Omit `digits` to get a
   * magnitude ladder instead of a fixed count — which is what a readout wants
   * once the unit can change under it: "1234 mm" and "48.6 in" are both right,
   * where a hard-coded 0 dp would round that same length to "49 in".
   */
  fmt: (q: Quantity, si: number, digits?: number) => string;
  /** An SI step (e.g. 0.001 m) → a "nice" spinner step in the user's unit. */
  step: (q: Quantity, si: number) => number;
  /**
   * Multiplier from SI to the user's unit, for scaling a whole series at once
   * (a chart axis, a mesh). Ignores the temperature offset, so it is a scale,
   * not a conversion — use `toUi` for a single reading.
   */
  factor: (q: Quantity) => number;
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
export function useUnits(): Units {
  const { settings } = useSettings();
  const { units, unitOverrides } = settings;
  return useMemo(() => {
    const at = (scope: string, q: Quantity): FieldUnit => {
      const sym = unitFor(units, unitOverrides, q, scope);
      return {
        sym,
        toUi: (si) => siToUi(q, sym, si),
        fromUi: (ui) => uiToSi(q, sym, ui),
        fmt: (si, digits) => (Number.isFinite(si) ? format(siToUi(q, sym, si), digits) : '—'),
        step: (si) => niceStep(siToUiDelta(q, sym, si)),
      };
    };
    return {
      all: units,
      sym: (q) => units[q],
      toUi: (q, si) => siToUi(q, units[q], si),
      fromUi: (q, ui) => uiToSi(q, units[q], ui),
      fmt: (q, si, digits) => (Number.isFinite(si) ? format(siToUi(q, units[q], si), digits) : '—'),
      step: (q, si) => niceStep(siToUiDelta(q, units[q], si)),
      factor: (q) => siToUiDelta(q, units[q], 1),
      at,
    };
  }, [units, unitOverrides]);
}
