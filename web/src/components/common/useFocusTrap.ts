import { useEffect, useRef } from 'react';

// Elements that can receive keyboard focus. Disabled and tabindex=-1 nodes are
// excluded so Tab cycling skips them, matching browser behavior.
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export interface FocusTrapOptions {
  /**
   * Called on a window-level Escape while the trap is active. Every modal in
   * the app closes on Escape, and each one used to carry its own copy of the
   * same five-line window listener; this is the one copy. Omit it for a
   * surface that must not be dismissible (WorkInProgressDialog).
   */
  onEscape?: () => void;
}

/**
 * Trap keyboard focus inside a dialog while `active`, then restore focus to
 * whatever was focused before it opened once it closes or unmounts. Without
 * this, Tab walks the still-present page behind an `aria-modal` overlay and the
 * trigger loses focus on close: the two gaps flagged for our modals.
 *
 * Tab stays inside the modal, and focus returns to the trigger on close.
 * Seven dialogs declared aria-modal and had neither, so Tab walked straight
 * out into the page behind the overlay, the exact gap this hook exists to
 * close. Every dialog now goes through it.
 *
 * Attach the returned ref to the dialog's PANEL element (the box, not the
 * backdrop): focus moves to its first focusable child on open, and Tab /
 * Shift+Tab wrap within it. Hidden children (`display:none`, e.g. a responsive
 * pane) are skipped because they have no `offsetParent`.
 *
 * `useFocusTrap(active)` keeps working; `useFocusTrap(active, { onEscape })`
 * also closes on Escape.
 */
export function useFocusTrap<T extends HTMLElement>(active: boolean, { onEscape }: FocusTrapOptions = {}) {
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
    //
    // Unless the dialog already placed it. React applies `autoFocus` during
    // commit, before this passive effect runs, so moving focus unconditionally
    // overrode every `autoFocus` in every dialog: ConfirmDialog's Confirm
    // button lost to Cancel (which came first in DOM order), and the name and
    // search inputs lost to their dialog's close button.
    if (!panel.contains(document.activeElement)) {
      const first = focusable()[0];
      if (first) first.focus();
      else {
        panel.tabIndex = -1;
        panel.focus();
      }
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

  // A separate effect, keyed on the callback too: most callers pass an inline
  // arrow, and re-running the trap above on every render would re-pull focus
  // each time. Re-subscribing a window listener is free.
  useEffect(() => {
    if (!active || !onEscape) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onEscape();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, onEscape]);

  return ref;
}
