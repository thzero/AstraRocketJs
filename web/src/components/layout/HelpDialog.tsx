import { useTranslation } from 'react-i18next';
import { docPageUrl, helpUrlFor } from '../../services/app/appInfo';
import { Dialog } from '../common/Dialog';
import { HelpPageFrame } from './HelpPageFrame';
import { HelpRail } from './HelpRail';
import { useFrameHighlight } from './useFrameHighlight';
import { useHelpContents } from './useHelpContents';
import { useHelpFrame } from './useHelpFrame';
import { useHelpNavigation } from './useHelpNavigation';
import { useHelpPage } from './useHelpPage';
import { useHelpSearch } from './useHelpSearch';

/**
 * Help, read WITHOUT leaving the design you are holding.
 *
 * This is a second RENDERER over the Docusaurus site, never a copy of it. The
 * deploy builds that site into `web/public/docs` before the app build, so the
 * pages shown here are byte for byte the pages published at the docs URL; what
 * this adds is a frame around them. The docs stay one source, and the external
 * link stays in the menu too, because a docs site you can send someone is not
 * replaceable by a dialog.
 *
 * WHY AN IFRAME of the built HTML, rather than rendering the source markdown:
 * the markdown route needs Docusaurus to emit its sources (it does not), a
 * markdown renderer in the bundle, MDX and admonition handling, a generated
 * slug index, and the translated sources as well. That is a second rendering
 * pipeline, which is the drift the "one source" rule exists to prevent. The
 * built HTML is same-origin, so the site's own chrome is stripped by an embed
 * stylesheet that ships WITH the docs (website/src/css/custom.css), and code
 * highlighting, admonitions and images are simply already right.
 *
 * WHY IT WORKS OFFLINE: it loads `docs/<slug>/index.html`, which is the exact
 * key the service worker precaches each page under. Navigating to
 * `docs/<slug>/` is the form that does NOT resolve from the precache (see
 * docPageFileUrl), so every link inside the frame is intercepted (useHelpFrame)
 * and re-opened as a file instead of being followed.
 */
export function HelpDialog({ page, onClose }: { page: string; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const { target, canGoBack, open, goBack } = useHelpNavigation(page, i18n.language);
  const { frameRef, ready, activeHash, navigate, onFrameLoad } = useHelpFrame(target, i18n.language, open);
  const { contentsOpen, toggleContents, pick, activeRow } = useHelpContents(navigate, activeHash);
  const { probed, pages } = useHelpPage(target);
  const search = useHelpSearch(pages, i18n.language, pick);
  useFrameHighlight(frameRef, ready, search.highlight, target);

  const status = probed === null ? 'probing' : !probed.page ? 'missing' : ready ? 'ready' : 'rendering';

  // The same page on the published site: what you send someone, and the way out
  // of the dialog for anything it renders badly. Empty when the build has no
  // docs URL at all (see docPageUrl).
  const siteHref = docPageUrl(helpUrlFor(i18n.language), target.slug);
  const heading = probed?.page?.title || t('help.title');
  // Headings belong to the page they were read from; the page list does not.
  const headings = probed?.page?.contents.headings ?? [];

  return (
    <Dialog
      id="help"
      // The PAGE's title, not the word Help: the dialog is a reader and which
      // page you are on is the thing worth saying. It is also the accessible
      // name, so a screen reader announces the same.
      title={heading}
      // The dialog stays "Help" to assistive tech while the heading above moves
      // with the page: this is the one dialog you navigate WITHIN, and a name
      // that changed under you as you followed a link would be worse than one
      // naming the frame.
      name={t('help.title')}
      // Only once a real page title is showing. Before one loads the heading IS
      // "Help", and an eyebrow saying so again just prints the word twice.
      eyebrow={probed?.page?.title ? t('help.title') : undefined}
      onClose={onClose}
      // Reachable from a dialog's own help link, so it has to sit above one.
      layer="over"
      size="4xl"
      // An iframe cannot usefully be scrolled by its container: it takes the
      // height and scrolls its own document.
      layout="fill"
      leading={
        <>
          {/* Rendered only once a page has loaded and brought its contents with
              it: with nothing to list, this would be a control that looks
              clickable and does nothing. */}
          {pages.length > 0 && (
            <button
              onClick={toggleContents}
              aria-expanded={contentsOpen}
              aria-label={t('help.contents')}
              title={t('help.contents')}
              className="shrink-0 rounded-lg bg-raised px-2 py-1 text-sm text-ink-soft ring-1 ring-line/10 hover:bg-elevated"
            >
              ☰
            </button>
          )}
          <button
            onClick={goBack}
            disabled={!canGoBack}
            aria-label={t('help.back')}
            title={t('help.back')}
            className="shrink-0 rounded-lg bg-raised px-2 py-1 text-sm text-ink-soft ring-1 ring-line/10 hover:bg-elevated disabled:cursor-not-allowed disabled:text-ink-dim disabled:hover:bg-raised"
          >
            &lsaquo;
          </button>
        </>
      }
      actions={
        siteHref && (
          <a
            href={siteHref}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t('help.openOnSite')}
            title={t('help.openOnSite')}
            className="shrink-0 rounded-lg bg-raised px-2 py-1 text-xs text-ink-soft ring-1 ring-line/10 hover:bg-elevated"
          >
            {/* The label costs about 130px, and at phone width the header
                already carries four controls; below `sm` the glyph stands in
                for it, with the same accessible name either way. */}
            <span className="hidden sm:inline">{t('help.openOnSite')}</span>
            <span className="sm:hidden" aria-hidden>
              ↗
            </span>
          </a>
        )
      }
    >
      <div className="relative flex min-h-0 flex-1">
        {/* The contents rail. In the flex row from `md` up; below it, an
              overlay over the page, because at phone width there is no room
              for both and the phone is where finding a topic matters most.
              (The docs site's own sidebar is display:none below 997px, which is
              the reason the dialog draws its own instead of revealing that one.) */}
        {pages.length > 0 && contentsOpen && (
          <HelpRail
            search={search}
            pages={pages}
            headings={headings}
            slug={target.slug}
            activeHash={activeHash}
            activeRow={activeRow}
            pick={pick}
          />
        )}

        <HelpPageFrame status={status} src={target.src} siteHref={siteHref} frameRef={frameRef} onLoad={onFrameLoad} />
      </div>
    </Dialog>
  );
}
