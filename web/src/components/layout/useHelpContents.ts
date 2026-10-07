import { type RefObject, useCallback, useEffect, useRef, useState } from 'react';

/**
 * Is the dialog wide enough to keep the contents rail BESIDE the page?
 *
 * 768px, the same `md:` breakpoint the rail's own classes switch on. Below it
 * the rail overlays the text, because a 224px rail inside a phone-width dialog
 * would leave the page about a hundred pixels to render in.
 */
const isWide = () => window.matchMedia('(min-width: 768px)').matches;

/**
 * The Help dialog's contents rail: whether it is open, opening a page from it,
 * and keeping the heading the frame has reached in view.
 *
 * It opens beside the page on a wide dialog and starts closed on a narrow one,
 * where picking a page folds it away again.
 */
export function useHelpContents(
  navigate: (next: string) => void,
  activeHash: string,
): {
  contentsOpen: boolean;
  toggleContents: () => void;
  pick: (next: string) => void;
  activeRow: RefObject<HTMLButtonElement | null>;
} {
  const [contentsOpen, setContentsOpen] = useState(isWide);
  const activeRow = useRef<HTMLButtonElement>(null);

  // Keep the current heading in view in the rail itself. On a long page the row
  // the frame has reached can easily be scrolled out of a 17-page list, and a
  // highlight you cannot see is not one that follows you.
  useEffect(() => {
    activeRow.current?.scrollIntoView({ block: 'nearest' });
  }, [activeHash]);

  const toggleContents = useCallback(() => setContentsOpen((o) => !o), []);

  /** Open a page from the rail, and on a phone get the rail out of the way. */
  const pick = useCallback(
    (next: string) => {
      navigate(next);
      if (!isWide()) setContentsOpen(false);
    },
    [navigate],
  );

  return { contentsOpen, toggleContents, pick, activeRow };
}
