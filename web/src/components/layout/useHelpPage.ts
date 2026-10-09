import { useEffect, useState } from 'react';
import { type HelpEntry, type HelpPage, type HelpTarget, loadHelpPage } from '../../services/app/helpDocs';

/**
 * The Help page read out of the served HTML: whether it is there at all, its
 * heading, and the contents rail. Nothing here touches the frame.
 *
 * The probe is tagged with the src it describes rather than being reset when
 * the page changes. A stale tag simply stops matching, so `probed` falls back
 * to null (the dialog's 'probing') on its own, and nothing has to set state
 * from inside an effect to clear it.
 */
export function useHelpPage(target: HelpTarget): {
  probed: { src: string; page: HelpPage | null } | null;
  pages: HelpEntry[];
} {
  const [probe, setProbe] = useState<{ src: string; page: HelpPage | null } | null>(null);
  // The page list, kept across a page change unlike everything else here: it is
  // identical on every page, so clearing it would blink the rail out and back
  // on every click inside it.
  const [pages, setPages] = useState<HelpEntry[]>([]);

  // Ask whether the page is there before mounting the frame. On a deployed
  // build this is a service-worker cache hit, so it costs milliseconds; on a
  // dev build with no `web/public/docs` (it is gitignored and written by the
  // deploy job, or locally by `npm run docs:build`) it is what keeps the app
  // from being loaded inside its own Help dialog, because Vite answers the
  // missing path with the app's shell and a 200.
  useEffect(() => {
    let canceled = false;
    void loadHelpPage(target).then((page) => {
      if (canceled) return;
      setProbe({ src: target.src, page });
      if (page && page.contents.pages.length) setPages(page.contents.pages);
    });
    return () => {
      canceled = true;
    };
  }, [target]);

  return { probed: probe?.src === target.src ? probe : null, pages };
}
