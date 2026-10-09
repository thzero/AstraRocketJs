import { Fragment, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import type { HelpEntry, HelpHeading } from '../../services/app/helpDocs';
import { splitHighlight } from '../../services/app/helpSearch';
import type { useHelpSearch } from './useHelpSearch';

/** A rail row: the page list and the heading list share their look. */
const railRow =
  'block w-full truncate rounded px-2 py-1 text-left text-xs text-ink-soft hover:bg-raised hover:text-ink-strong';

/** Text with the searched-for words marked, for a result row. */
function Marked({ text, tokens }: { text: string; tokens: string[] }) {
  return (
    <>
      {splitHighlight(text, tokens).map((segment, i) =>
        segment.hit ? (
          <mark key={i} className="rounded bg-warn-300/25 text-warn-100">
            {segment.text}
          </mark>
        ) : (
          <Fragment key={i}>{segment.text}</Fragment>
        ),
      )}
    </>
  );
}

/**
 * The Help dialog's contents rail: the search box, then either the results or
 * the page list with the current page's headings under it.
 *
 * Draws only. Which page is open, the heading the frame has reached and the
 * search state all come from the dialog's hooks, and `activeRow` stays owned by
 * useHelpContents so its scroll follows the frame, not the rail mounting.
 */
export function HelpRail({
  search,
  pages,
  headings,
  slug,
  activeHash,
  activeRow,
  pick,
}: {
  search: ReturnType<typeof useHelpSearch>;
  pages: HelpEntry[];
  headings: HelpHeading[];
  slug: string;
  activeHash: string;
  activeRow: RefObject<HTMLButtonElement | null>;
  pick: (next: string) => void;
}) {
  const { t } = useTranslation();
  const { query, setQuery, trimmed, resultsId, results, searching, hitTokens, openHit, clearSearch, onSearchKey } =
    search;

  const pageRows = pages.map((entry, i) =>
    entry.page === null ? (
      <p
        key={`group-${i}`}
        className="mt-3 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-ink-faint first:mt-0"
      >
        {entry.label}
      </p>
    ) : (
      <Fragment key={entry.page}>
        <button
          onClick={() => pick(entry.page!)}
          aria-current={entry.page === slug ? 'page' : undefined}
          className={`${railRow} ${entry.page === slug ? 'bg-raised font-semibold text-accent-300' : ''}`}
        >
          {entry.label}
        </button>
        {/* The page you are on opens into its own headings, so the rail answers
            both "what else is there" and "where in this page". Picking one goes
            through the same same-slug-scroll path a heading link inside the
            frame takes. */}
        {entry.page === slug &&
          headings.map((h) => (
            <button
              key={h.hash}
              ref={h.hash === activeHash ? activeRow : undefined}
              onClick={() => pick(`${slug}${h.hash}`)}
              aria-current={h.hash === activeHash ? 'location' : undefined}
              className={`${railRow} ${h.level > 1 ? 'pl-8' : 'pl-5'} ${
                h.hash === activeHash ? 'bg-raised text-accent-300' : 'text-ink-muted'
              }`}
            >
              {h.label}
            </button>
          ))}
      </Fragment>
    ),
  );

  return (
    <nav
      aria-label={t('help.contents')}
      className="absolute inset-y-0 left-0 z-10 w-56 shrink-0 overflow-y-auto border-r border-line/10 bg-surface p-2 md:static md:z-auto"
    >
      {/* Search the whole guide, not this page: the index is every page
          the rail lists. It sits in the rail because that is where the
          question "where is this?" is already answered, and because the
          dialog header carries four controls at phone width already. */}
      <div className="mb-2 flex items-center gap-1">
        <input
          // Not type="search": the browsers that draw their own clear
          // glyph for it draw a second one beside the button below.
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onSearchKey}
          placeholder={t('help.search')}
          aria-label={t('help.search')}
          enterKeyHint="search"
          className="min-w-0 flex-1 rounded bg-raised px-2 py-1 text-xs text-ink ring-1 ring-line/10 placeholder:text-ink-faint focus:outline-none focus:ring-accent-500"
        />
        {query !== '' && (
          <button
            onClick={clearSearch}
            aria-label={t('help.searchClear')}
            title={t('help.searchClear')}
            className="shrink-0 rounded px-1.5 py-1 text-xs text-ink-muted hover:bg-raised hover:text-ink"
          >
            ✕
          </button>
        )}
      </div>

      {results !== null ? (
        results.length === 0 ? (
          <p className="px-2 py-3 text-xs text-ink-muted">{t('help.searchNone', { query: trimmed })}</p>
        ) : (
          // Grouped, and named by its own count line: the rail holds two
          // lists that look alike, and this is what says which one is on
          // screen to a screen reader and to a test.
          <div role="group" aria-labelledby={resultsId}>
            <p id={resultsId} className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
              {t('help.searchMatches', { n: results.length })}
            </p>
            {results.map((hit) => (
              <button
                key={hit.page}
                onClick={() => openHit(hit)}
                className="mb-1 block w-full rounded px-2 py-1 text-left hover:bg-raised"
              >
                {/* The section, then the page it is in: a result is a
                    place in the guide, and the section is the part of that
                    you were looking for. A page's lead text has no heading
                    of its own, so the page name stands in. */}
                <span className="block truncate text-xs font-semibold text-ink">
                  <Marked text={hit.heading || hit.label} tokens={hitTokens} />
                </span>
                {hit.heading !== '' && <span className="block truncate text-[10px] text-ink-faint">{hit.label}</span>}
                <span className="mt-0.5 block text-[10px] leading-snug text-ink-muted">
                  <Marked text={hit.snippet} tokens={hitTokens} />
                </span>
              </button>
            ))}
          </div>
        )
      ) : searching ? (
        <p className="px-2 py-3 text-xs text-ink-faint">{t('help.searchBusy')}</p>
      ) : (
        pageRows
      )}
    </nav>
  );
}
