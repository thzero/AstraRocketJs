import { useEffect, useLayoutEffect, useRef } from 'react';

/**
 * A color input that commits once, when the picker closes, rather than on every
 * drag tick. React's `onChange` on a color input maps to the native `input`
 * event, which fires continuously while the OS picker is dragged; bound to a
 * saved setting, every tick would write the whole settings object to storage,
 * dozens of writes per gesture. This listens to the NATIVE `change` (once, on close)
 * and to blur, since closing the picker with its own OK does not always move
 * focus. The swatch still previews while dragging: it shows its own value.
 */
export function ColorInput({
  value,
  onCommit,
  id,
  disabled,
  ariaLabel,
  title,
  className,
  style,
}: {
  value: string;
  onCommit: (color: string) => void;
  id?: string;
  disabled?: boolean;
  ariaLabel?: string;
  title?: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const latest = useRef({ value, onCommit });
  useLayoutEffect(() => {
    latest.current = { value, onCommit };
  });
  // Uncontrolled, re-seeded when the stored value changes from elsewhere. The
  // same element is kept, not remounted, so the native listener below stays
  // attached for every later pick.
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && el.value !== value) el.value = value;
  }, [value]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const commit = () => {
      if (el.value !== latest.current.value) latest.current.onCommit(el.value);
    };
    el.addEventListener('change', commit);
    return () => el.removeEventListener('change', commit);
  }, []);
  return (
    <input
      ref={ref}
      id={id}
      type="color"
      defaultValue={value}
      disabled={disabled}
      aria-label={ariaLabel}
      title={title}
      onBlur={(e) => {
        if (e.target.value !== value) onCommit(e.target.value);
      }}
      className={className}
      style={style}
    />
  );
}
