import type { RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { appName } from '../../services/app/appInfo';

/**
 * The page side of the Help dialog: the docs frame, the loading line over it,
 * or, on a build with no docs, the way out to the published site.
 *
 * The frame is mounted only once the probe has found the page, and stays
 * transparent until `status` is 'ready'.
 */
export function HelpPageFrame({
  status,
  src,
  siteHref,
  frameRef,
  onLoad,
}: {
  status: 'probing' | 'missing' | 'rendering' | 'ready';
  src: string;
  siteHref: string;
  frameRef: RefObject<HTMLIFrameElement | null>;
  onLoad: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="relative min-h-0 flex-1">
      {status === 'missing' ? (
        <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
          <p className="text-sm text-ink-soft">{t('help.missing', { name: appName() })}</p>
          {siteHref && (
            <a
              href={siteHref}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-medium text-on-accent hover:bg-accent-500"
            >
              {t('help.openOnSite')}
            </a>
          )}
        </div>
      ) : (
        <>
          {status !== 'ready' && (
            <p className="absolute inset-0 grid place-items-center text-sm text-ink-faint">{t('help.loading')}</p>
          )}
          {status !== 'probing' && (
            <iframe
              ref={frameRef}
              src={src}
              title={t('help.title')}
              onLoad={onLoad}
              // Hidden until the theme and the embed attribute are on,
              // otherwise a light-mode machine shows a white flash of the
              // full site chrome before the first paint of the stripped one.
              // And out of reach until then: the load handler is what keeps a
              // link inside the dialog, so a click on the unseen page before it
              // runs would go to the docs site's own router instead.
              className={`h-full w-full border-0 ${status === 'ready' ? '' : 'pointer-events-none opacity-0'}`}
            />
          )}
        </>
      )}
    </div>
  );
}
