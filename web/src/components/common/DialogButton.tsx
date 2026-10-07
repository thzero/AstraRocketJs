import type { ButtonHTMLAttributes } from 'react';

const VARIANT = {
  primary: 'bg-accent-600 text-on-accent hover:bg-accent-500',
  secondary: 'bg-raised text-ink ring-1 ring-line/10 hover:bg-elevated',
  danger: 'bg-danger-600 text-on-accent hover:bg-danger-500',
} as const;

/**
 * A dialog's action button: the Cancel (`secondary`), the OK (`primary`) and the
 * destructive confirm (`danger`). One component, so a dialog's buttons look the
 * same as every other dialog's, and a disabled primary reads the same everywhere
 * rather than four different ways.
 */
export function DialogButton({
  variant = 'secondary',
  className = '',
  type = 'button',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof VARIANT }) {
  return (
    <button
      type={type}
      className={`rounded-lg px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${VARIANT[variant]} ${className}`}
      {...rest}
    />
  );
}
