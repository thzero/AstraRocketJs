import { useEffect, useRef } from 'react';

// Elements that Tab stops on. Disabled controls are excluded, and so is anything
// at tabindex=-1 (a roving item, a menu entry): the browser skips it, so a wrap
// target taken from it would never be the control focus is leaving. `iframe` is
// a stop of its own: the Help dialog's content is one, and without it Tab
// reaches every control in that dialog and never the page it exists to show.
const FOCUSABLE = [
  'a[href]',
  'iframe',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]',
]
  .map((s) => `${s}:not([tabindex="-1"])`)
  .join(',');

export interface FocusTrapOptions {
  /**
   * Called on a window-level Escape while the trap is active, and only if this is
   * the topmost open surface. Every modal in the app closes on Escape, and this is
   * the one window listener that does it. Omit it for a surface that must not be
   * dismissible (WorkInProgressDialog), which then swallows Escape while it is
   * on top, rather than letting it through to whatever is underneath.
   */
  onEscape?: () => void;
}

/**
 * Marks a panel as an open modal surface, for as long as its trap is active.
 *
 * The Escape listener has to be on the window (a dialog is not always focused
 * when it is pressed), so every open surface hears every Escape. The marker lets
 * each one check whether it is on top, so dismissing the rename prompt inside
 * the design library closes the prompt and leaves the library open. A
 * per-dialog `stopPropagation` only works between two surfaces that know about
 * each other.
 */
const SURFACE = 'data-modal-surface';

/**
 * The order surfaces opened in. Each one's marker holds its place in it, so the
 * stack is in the DOM where every trap and window key handler can read it.
 */
let opened = 0;

/**
 * The surface an Escape belongs to: the one opened last.
 *
 * Opening order, not document order: Help is mounted early in the header and
 * opens over dialogs rendered after it (the launch site map's key note links to
 * it), so the last surface in the document is not always the one on top. Not
 * z-index either, which jsdom cannot compute from the Tailwind classes that
 * carry it. A marker with no place in the order counts as opened first, and
 * among equals the later one in the document wins.
 */
export const topmostSurface = (): Element | null => {
  let top: Element | null = null;
  let topAt = -1;
  for (const el of document.querySelectorAll(`[${SURFACE}]`)) {
    const at = Number(el.getAttribute(SURFACE)) || 0;
    if (at >= topAt) {
      top = el;
      topAt = at;
    }
  }
  return top;
};

/**
 * Whether any modal surface is open, for a window-level key handler outside a
 * dialog that must leave Escape to it. Every surface carries the marker,
 * whatever its role: an `alertdialog` is a surface too.
 */
export const hasOpenSurface = (): boolean => topmostSurface() !== null;

/**
 * Trap keyboard focus inside a dialog while `active`, then restore focus to
 * whatever was focused before it opened once it closes or unmounts. Without
 * this, Tab walks the still-present page behind an `aria-modal` overlay and the
 * trigger loses focus on close. Every dialog goes through it.
 *
 * Attach the returned ref to the dialog's panel element (the box, not the
 * backdrop): focus moves to its first focusable child on open, and Tab /
 * Shift+Tab wrap within it. Hidden children (`display:none`, e.g. a responsive
 * pane) are skipped because they have no `offsetParent`.
 *
 * `useFocusTrap(active)` traps focus only; `useFocusTrap(active, { onEscape })`
 * also closes on Escape.
 */
export function useFocusTrap<T extends HTMLElement>(active: boolean, { onEscape }: FocusTrapOptions = {}) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const panel = ref.current;
    if (!active || !panel) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    panel.setAttribute(SURFACE, String(++opened));

    const focusable = () =>
      Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );

    // Pull focus into the dialog: its first control, or the panel itself.
    //
    // Unless the dialog already placed it. React applies `autoFocus` during
    // commit, before this passive effect runs, so moving focus unconditionally
    // overrides every `autoFocus` in every dialog: ConfirmDialog's Confirm button
    // loses to Cancel (first in DOM order), and the name and search inputs lose to
    // their dialog's close button.
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

    // Tab inside an iframe is the frame document's keydown, which the listener
    // above never hears, so tabbing past the frame's last link moves focus out of
    // the panel into the page behind. Anything that lands outside is brought back
    // to the first control, unless a surface opened on top of this one owns it.
    const onFocusIn = (e: FocusEvent) => {
      if (topmostSurface() !== panel || panel.contains(e.target as Node)) return;
      const first = focusable()[0];
      if (first) first.focus();
      else panel.focus();
    };

    panel.addEventListener('keydown', onKeyDown);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      panel.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('focusin', onFocusIn);
      panel.removeAttribute(SURFACE);
      previouslyFocused?.focus?.();
    };
  }, [active]);

  // A separate effect, keyed on the callback too: most callers pass an inline
  // arrow, and re-running the trap above on every render would re-pull focus
  // each time. Re-subscribing a window listener is free.
  useEffect(() => {
    if (!active || !onEscape) return;
    const onKey = (e: KeyboardEvent) => {
      // Spent already: a menu or popover inside the surface closed on it.
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      // Not mine to answer: something is open on top of me. A panel that never
      // received the ref cannot be placed in the stack, so it still answers.
      const panel = ref.current;
      if (panel && topmostSurface() !== panel) return;
      onEscape();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, onEscape]);

  return ref;
}
