import { type RefObject, useEffect } from 'react';
import type { HelpTarget } from '../../services/app/helpDocs';
import { clearMarks, markMatches } from '../../services/app/helpSearch';

const MARK = 'mark[data-astra-help-mark]';

/**
 * Mark the words inside the frame, and go to the first one.
 *
 * Not part of the load handler, because opening a second result on the SAME
 * page does not reload the frame: `navigate` scrolls it instead, so this is
 * keyed on the anchor as well as on the page. Marking is undone before each
 * re-run, which leaves the document as it was served.
 *
 * The docs page can hydrate and re-render its article after the frame's load
 * event, which drops the marks (or replaces the article outright), so the body
 * is watched and the words marked again whenever the article has none.
 */
export function useFrameHighlight(
  frameRef: RefObject<HTMLIFrameElement | null>,
  ready: boolean,
  highlight: string[],
  target: HelpTarget,
): void {
  useEffect(() => {
    const doc = frameRef.current?.contentDocument;
    if (!ready || !doc?.querySelector('article')) return;
    const win = doc.defaultView;
    let scrolled = false;

    const mark = () => {
      const root = doc.querySelector('article');
      if (!root || root.querySelector(MARK)) return;
      const marks = markMatches(root, highlight);
      if (!marks.length || !win || scrolled) return;
      scrolled = true;
      // The first match at or after the section the result named. The anchor
      // alone lands on the HEADING, which on a page like the glossary is a
      // letter with a hundred entries under it.
      const anchor = target.hash ? doc.getElementById(decodeURIComponent(target.hash.slice(1))) : null;
      const from = anchor ? anchor.getBoundingClientRect().top + win.scrollY : 0;
      const at = marks.find((m) => m.getBoundingClientRect().top + win.scrollY >= from) ?? marks[0]!;
      at.scrollIntoView({ block: 'center' });
    };

    mark();
    const Observer = win?.MutationObserver ?? MutationObserver;
    const watch = highlight.length ? new Observer(mark) : null;
    watch?.observe(doc.body, { childList: true, subtree: true });
    return () => {
      watch?.disconnect();
      const root = doc.querySelector('article');
      if (root) clearMarks(root);
    };
  }, [frameRef, ready, highlight, target.hash, target.src]);
}
