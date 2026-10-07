import type { ButtonHTMLAttributes } from 'react';

const VARIANT = {
  primary: 'bg-sky-600 text-white hover:bg-sky-500',
  secondary: 'bg-slate-800 text-slate-200 ring-1 ring-white/10 hover:bg-slate-700',
  danger: 'bg-red-600 text-white hover:bg-red-500',
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
