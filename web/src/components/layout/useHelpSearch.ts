import { type KeyboardEvent, useCallback, useEffect, useId, useMemo, useState } from 'react';
import type { HelpEntry } from '../../services/app/helpDocs';
import { type HelpHit, helpIndex, searchHelp, searchTokens } from '../../services/app/helpSearch';

/**
 * How long a pause in typing means "search for that".
 *
 * A search is not free the way filtering a list in memory is: the first one
 * fetches every page to build the index, and each one after that scans every
 * section of every page. Neither is worth doing for the prefixes on the way to
 * a word.
 */
const SEARCH_DEBOUNCE_MS = 200;

/**
 * The shortest query worth running.
 *
 * One letter matches most of the guide, so the result would be a list too long
 * to read, built at the cost of the whole index.
 */
const SEARCH_MIN_CHARS = 2;

/**
 * Searching the whole guide from the Help dialog's rail.
 *
 * `query` is what has been typed; `found` is the answer for a query, tagged
 * with it the same way the page probe is tagged with its src, so a result list
 * for a query that has since been edited stops matching instead of having to be
 * cleared. `highlight` is the words to mark inside the frame, which is set by
 * opening a result rather than by typing: marking the page you happen to be
 * reading as you type would be the dialog rearranging itself under you.
 */
export function useHelpSearch(pages: HelpEntry[], language: string, pick: (next: string) => void) {
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<{ query: string; hits: HelpHit[] } | null>(null);
  const [highlight, setHighlight] = useState<string[]>([]);
  const trimmed = query.trim();
  const resultsId = useId();

  /*
   * Search the whole guide, after a pause in typing.
   *
   * `pages` is the dependency that matters: it is the rail's own page list, so
   * search covers exactly what the dialog can open and is only possible once a
   * page has loaded and brought that list with it. On a build with no docs it
   * stays empty, and the search box is not rendered at all.
   */
  useEffect(() => {
    // Nothing is cleared on the way out: `found` carries the query it answers,
    // so an answer for a query that has since been shortened simply stops
    // matching, the same way the probe's src tag works in useHelpPage.
    if (trimmed.length < SEARCH_MIN_CHARS || pages.length === 0) return;
    let canceled = false;
    const timer = window.setTimeout(() => {
      // The index is built on the first search and kept for the session; this
      // resolves immediately on every search after it.
      void helpIndex(pages, language).then((docs) => {
        if (!canceled) setFound({ query: trimmed, hits: searchHelp(docs, trimmed) });
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      canceled = true;
      window.clearTimeout(timer);
    };
  }, [trimmed, pages, language]);

  /** Open a result: the page it is on, with the words that found it marked. */
  const openHit = useCallback(
    (hit: HelpHit) => {
      setHighlight(searchTokens(trimmed));
      pick(hit.page);
    },
    [pick, trimmed],
  );

  const clearSearch = useCallback(() => {
    setQuery('');
    setHighlight([]);
  }, []);

  // An answer counts only while it still describes what is in the box; between
  // an edit and the next answer the rail says it is working, rather than
  // showing results for a query that is no longer there.
  const results = found?.query === trimmed ? found.hits : null;
  const searching = results === null && trimmed.length >= SEARCH_MIN_CHARS;
  const hitTokens = useMemo(() => searchTokens(trimmed), [trimmed]);

  const onSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape' && query !== '') {
      // Clear the search instead of closing the dialog. Escape closes every
      // modal in the app (useFocusTrap's window listener), and stopping it here
      // is the narrow exception: the reason you are in a search box is that you
      // have not found the thing yet, so shutting the guide is the wrong answer.
      e.stopPropagation();
      clearSearch();
      return;
    }
    if (e.key !== 'Enter') return;
    const top = results?.[0];
    if (top) openHit(top);
  };

  return {
    query,
    setQuery,
    trimmed,
    resultsId,
    results,
    searching,
    hitTokens,
    highlight,
    openHit,
    clearSearch,
    onSearchKey,
  };
}
