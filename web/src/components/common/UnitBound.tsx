import { useUnits } from '../../prefs/useUnits';
import type { Quantity } from '../../prefs/units';
import { NumberInput } from './NumberInput';

/**
 * One end of a min/max filter, typed in the user's unit and held in SI. Built on
 * NumberInput, so the box keeps what is being typed ("2.", a cleared field)
 * instead of re-deriving it from the converted value on every keystroke. An
 * empty box, or a value that cannot survive the conversion, is "no bound".
 */
export function UnitBound({
  quantity,
  value,
  onChange,
  placeholder,
  ariaLabel,
  className,
  min,
}: {
  quantity: Quantity;
  value: number | null;
  onChange: (si: number | null) => void;
  placeholder?: string;
  ariaLabel: string;
  className?: string;
  min?: number;
}) {
  const u = useUnits();
  return (
    <NumberInput
      value={value == null ? null : u.toUi(quantity, value)}
      onChange={(ui) => onChange(ui === null ? null : u.toSi(quantity, ui))}
      min={min}
      placeholder={placeholder}
      ariaLabel={ariaLabel}
      className={className}
    />
  );
}
