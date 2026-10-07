import type { ReactNode } from 'react';

/**
 * A button that is on or off: a filter chip, a sub-tab, one segment of a group.
 * The state is in the ARIA (`aria-pressed`, or `aria-current` for a tab-like
 * control) as well as the color, so it is not conveyed by `bg-accent-600` alone.
 * Size, shape and weight are the caller's (`className`); the on and off inks are
 * this component's, the same everywhere.
 */
export function ToggleButton({
  active,
  onClick,
  current = false,
  disabled,
  title,
  className = 'rounded-lg px-3 py-1 text-xs font-medium',
  children,
}: {
  active: boolean;
  onClick: () => void;
  /** Announce as the current item of a set (`aria-current`) rather than as pressed. */
  current?: boolean;
  disabled?: boolean;
  title?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-pressed={current ? undefined : active}
      aria-current={current && active ? 'true' : undefined}
      className={`disabled:cursor-not-allowed disabled:opacity-40 ${
        active ? 'bg-accent-600 text-on-accent' : 'bg-raised text-ink-soft hover:bg-elevated'
      } ${className}`}
    >
      {children}
    </button>
  );
}
