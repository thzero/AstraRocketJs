import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';

/** Every menu item role: plain, radio and checkbox items all take part in the roving focus. */
const MENU_ITEMS = '[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]';

/**
 * The open state of a menu button and its popover, and the ARIA menu keyboard
 * model for the popover.
 *
 * While open, a pointer press outside `wrapRef` closes it, and Escape closes it
 * and returns focus to `triggerRef`: focus left on the body makes a popover a
 * dead end, since Tab restarts from the top of the document. A menu item that
 * closes the menu uses `closeAndRestore` for the same reason: closing unmounts
 * the focused item.
 *
 * Escape is taken in the capture phase and marked handled (`defaultPrevented`),
 * so a window listener that also answers Escape, such as leaving the maximized
 * canvas, can tell the key was spent closing the menu.
 *
 * A `role="menu"` promises the menu keyboard model, so the popover element takes
 * `menuRef` and `onMenuKeyDown`: opening moves focus to the first item, the
 * up and down arrows move between items (wrapping), Home and End jump to the
 * ends, and Tab closes the menu and lets focus move on. Items carry
 * `tabIndex={-1}` so the arrows, not Tab, move between them. The keys the menu
 * handles stop at the menu, so a host that answers arrows itself (a tree row)
 * does not act on them too.
 */
export function useMenuPopover<T extends HTMLElement = HTMLButtonElement>({
  shown,
}: {
  /**
   * Which items the arrows can reach, for a menu that keeps some of its items
   * mounted but not displayed. Every item, by default.
   */
  shown?: (item: HTMLElement) => boolean;
} = {}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<T>(null);
  const menuRef = useRef<HTMLDivElement>(null);

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

  // On open, focus goes to the first item, unless it is already inside.
  useEffect(() => {
    const menu = menuRef.current;
    if (!open || !menu || menu.contains(document.activeElement)) return;
    menu.querySelector<HTMLElement>(MENU_ITEMS)?.focus();
  }, [open]);

  const onMenuKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLElement>) => {
      const menu = menuRef.current;
      if (!menu) return;
      if (e.key === 'Tab') {
        setOpen(false); // no preventDefault: focus proceeds out of the menu
        return;
      }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
      e.preventDefault();
      e.stopPropagation();
      const all = Array.from(menu.querySelectorAll<HTMLElement>(MENU_ITEMS));
      const items = shown ? all.filter(shown) : all;
      if (items.length === 0) return;
      const i = items.indexOf(document.activeElement as HTMLElement);
      const to =
        e.key === 'Home'
          ? 0
          : e.key === 'End'
            ? items.length - 1
            : e.key === 'ArrowDown'
              ? (i + 1) % items.length
              : i < 0
                ? items.length - 1
                : (i - 1 + items.length) % items.length;
      items[to]?.focus();
    },
    [shown],
  );

  const toggle = useCallback(() => setOpen((v) => !v), []);
  const close = useCallback(() => setOpen(false), []);
  const closeAndRestore = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);
  return { open, toggle, close, closeAndRestore, wrapRef, triggerRef, menuRef, onMenuKeyDown };
}
