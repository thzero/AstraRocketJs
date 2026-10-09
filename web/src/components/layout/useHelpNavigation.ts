import { useCallback, useMemo, useState } from 'react';
import { type HelpTarget, helpTarget } from '../../services/app/helpDocs';

/**
 * The Help dialog's back stack: which page it is on, and the pages to go back to.
 *
 * `page` is only the entry point: whoever opened Help named a topic.
 * Navigation from inside the frame moves `current` and pushes onto `stack`.
 * A fresh openHelp() from elsewhere in the app remounts the dialog
 * (HeaderDialogs keys it on the page), so there is no effect resetting them.
 */
export function useHelpNavigation(
  page: string,
  language: string,
): { target: HelpTarget; canGoBack: boolean; open: (next: string) => void; goBack: () => void } {
  const [current, setCurrent] = useState(page);
  const [stack, setStack] = useState<string[]>([]);

  const target = useMemo(() => helpTarget(current, language), [current, language]);

  /** Move to another page, keeping the one being left to come back to. */
  const open = useCallback(
    (next: string) => {
      setStack((s) => [...s, current]);
      setCurrent(next);
    },
    [current],
  );

  const goBack = useCallback(() => {
    const prev = stack[stack.length - 1];
    if (prev === undefined) return;
    setCurrent(prev);
    setStack(stack.slice(0, -1));
  }, [stack]);

  return { target, canGoBack: stack.length > 0, open, goBack };
}
