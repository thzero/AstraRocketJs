import { useEffect } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import { appName, APP_VERSION, isPreRelease } from '../../services/appInfo';

// Credited open-source projects → homepage.
const LINKS: [string, string][] = [
  ['OpenRocket', 'https://openrocket.info'],
  ['TeaVM', 'https://teavm.org'],
  ['React', 'https://react.dev'],
  ['three.js', 'https://threejs.org'],
  ['react-three-fiber', 'https://r3f.docs.pmnd.rs'],
  ['Tailwind CSS', 'https://tailwindcss.com'],
  ['i18next', 'https://www.i18next.com'],
  ['fflate', 'https://github.com/101arrowz/fflate'],
  ['Vite', 'https://vite.dev'],
];

/** "About {app}" modal — what the app is (a light web UI over the OpenRocket
 *  engine, full .ork support), version, and credits. Copy lives in i18n. */
export function AboutDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-2xl bg-slate-900 p-6 ring-1 ring-white/10"
        role="dialog"
        aria-modal="true"
        aria-label={t('about.open')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="text-3xl">🚀</span>
            <div>
              <h2 className="text-lg font-semibold text-slate-100">{appName()}</h2>
              <p className="text-xs text-slate-400">
                {t('about.tagline')} · v{APP_VERSION}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label={t('about.close')}
            className="shrink-0 rounded-lg bg-slate-800 px-2 py-1 text-sm text-slate-300 ring-1 ring-white/10 hover:bg-slate-700"
          >
            ✕
          </button>
        </div>

        <div className="mt-4 space-y-3 text-sm leading-relaxed text-slate-300">
          {isPreRelease() && (
            <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-amber-300 ring-1 ring-amber-400/30">
              {t('about.wip')}
            </p>
          )}
          <p>{t('about.body', { name: appName() })}</p>
          <p>{t('about.ork')}</p>
          <p>
            <Trans
              i18nKey="about.scope"
              components={{
                orLink: (
                  <a
                    href="https://openrocket.info"
                    target="_blank"
                    rel="noreferrer"
                    className="text-sky-400 hover:underline"
                  />
                ),
              }}
            />
          </p>
        </div>

        <div className="mt-4 border-t border-white/10 pt-3 text-xs leading-relaxed text-slate-500">
          <p>{t('about.credits')}</p>
          <p className="mt-2 flex flex-wrap gap-x-2 gap-y-1">
            {LINKS.map(([name, href], i) => (
              <span key={name}>
                {i > 0 && <span className="text-slate-600">· </span>}
                <a href={href} target="_blank" rel="noreferrer" className="text-sky-400 hover:underline">
                  {name}
                </a>
              </span>
            ))}
          </p>
        </div>

        <div className="mt-5 flex justify-end">
          <button
            onClick={onClose}
            className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500"
          >
            {t('about.close')}
          </button>
        </div>
      </div>
    </div>
  );
}
