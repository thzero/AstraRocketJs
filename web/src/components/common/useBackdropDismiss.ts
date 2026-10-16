import { useRef, type MouseEvent, type PointerEvent } from 'react';

/**
 * Handlers for a modal's backdrop that dismiss only on a press that both starts
 * and ends on the backdrop itself. A text selection dragged out of the panel
 * fires its click on the backdrop, the nearest common ancestor, and must not
 * close the dialog and discard what is in it.
 *
 * The click never propagates: a nested dialog renders inside its parent's
 * backdrop, and a click that bubbled on would close both.
 */
export function useBackdropDismiss(onDismiss: (() => void) | undefined) {
  const pressedHere = useRef(false);
  return {
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      pressedHere.current = e.target === e.currentTarget;
    },
    onClick: (e: MouseEvent<HTMLElement>) => {
      e.stopPropagation();
      const dismiss = pressedHere.current && e.target === e.currentTarget;
      pressedHere.current = false;
      if (dismiss) onDismiss?.();
    },
  };
}
