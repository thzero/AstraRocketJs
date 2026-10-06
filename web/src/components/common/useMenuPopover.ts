import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * The open state of a menu button and its popover. While open, a pointer
 * press outside `wrapRef` closes it, and Escape closes it and returns focus to
 * `triggerRef`: focus left on the body makes a popover a dead end, since Tab
 * restarts from the top of the document.
 *
 * Escape is taken in the capture phase and marked handled (`defaultPrevented`),
 * so a window listener that also answers Escape, such as leaving the maximized
 * canvas, can tell the key was spent closing the menu.
 */
export function useMenuPopover<T extends HTMLElement = HTMLButtonElement>() {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<T>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const toggle = useCallback(() => setOpen((v) => !v), []);
  const close = useCallback(() => setOpen(false), []);
  return { open, toggle, close, wrapRef, triggerRef };
}
