import { useEffect, useRef } from 'react';

// Elements that can receive keyboard focus. Disabled and tabindex=-1 nodes are
// excluded so Tab cycling skips them, matching browser behaviour.
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * Trap keyboard focus inside a dialog while `active`, then restore focus to
 * whatever was focused before it opened once it closes or unmounts. Without
 * this, Tab walks the still-present page behind an `aria-modal` overlay and the
 * trigger loses focus on close — the two gaps flagged for our modals.
 *
 * Attach the returned ref to the dialog's PANEL element (the box, not the
 * backdrop): focus moves to its first focusable child on open, and Tab /
 * Shift+Tab wrap within it. Hidden children (`display:none`, e.g. a responsive
 * pane) are skipped because they have no `offsetParent`.
 */
export function useFocusTrap<T extends HTMLElement>(active: boolean) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const panel = ref.current;
    if (!active || !panel) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const focusable = () =>
      Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );

    // Pull focus into the dialog: its first control, or the panel itself.
    const first = focusable()[0];
    if (first) first.focus();
    else {
      panel.tabIndex = -1;
      panel.focus();
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const els = focusable();
      if (els.length === 0) {
        e.preventDefault();
        return;
      }
      const firstEl = els[0]!;
      const lastEl = els[els.length - 1]!;
      const current = document.activeElement;
      if (e.shiftKey) {
        if (current === firstEl || !panel.contains(current)) {
          e.preventDefault();
          lastEl.focus();
        }
      } else if (current === lastEl || !panel.contains(current)) {
        e.preventDefault();
        firstEl.focus();
      }
    };

    panel.addEventListener('keydown', onKeyDown);
    return () => {
      panel.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [active]);
  return ref;
}
