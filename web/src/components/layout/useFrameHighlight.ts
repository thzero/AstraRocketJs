import { type RefObject, useEffect } from 'react';
import type { HelpTarget } from '../../services/app/helpDocs';
import { clearMarks, markMatches } from '../../services/app/helpSearch';

/**
 * Mark the words inside the frame, and go to the first one.
 *
 * Not part of the load handler, because opening a second result on the SAME
 * page does not reload the frame: `navigate` scrolls it instead, so this is
 * keyed on the anchor as well as on the page. Marking is undone before each
 * re-run, which leaves the document as it was served.
 */
export function useFrameHighlight(
  frameRef: RefObject<HTMLIFrameElement | null>,
  ready: boolean,
  highlight: string[],
  target: HelpTarget,
): void {
  useEffect(() => {
    const doc = frameRef.current?.contentDocument;
    const root = doc?.querySelector('article');
    if (!ready || !doc || !root) return;
    const marks = markMatches(root, highlight);
    const win = doc.defaultView;
    if (marks.length && win) {
      // The first match at or after the section the result named. The anchor
      // alone lands on the HEADING, which on a page like the glossary is a
      // letter with a hundred entries under it.
      const anchor = target.hash ? doc.getElementById(decodeURIComponent(target.hash.slice(1))) : null;
      const from = anchor ? anchor.getBoundingClientRect().top + win.scrollY : 0;
      const at = marks.find((mark) => mark.getBoundingClientRect().top + win.scrollY >= from) ?? marks[0]!;
      at.scrollIntoView({ block: 'center' });
    }
    return () => clearMarks(root);
  }, [frameRef, ready, highlight, target.hash, target.src]);
}
