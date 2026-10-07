import { useTranslation, Trans } from 'react-i18next';
import { appName, APP_VERSION, CONTRIBUTORS_URL, isPreRelease, UPSTREAM } from '../../services/app/appInfo';
import { useUpdateStore } from '../../state/updateStore';
import { fetchCatalog } from '../../services/app/remoteData';
import { Dialog } from '../common/Dialog';
import { DialogButton } from '../common/DialogButton';
import { useAsyncLoad } from '../common/useAsyncLoad';
import { useOnline } from '../common/useOnline';

interface Contributor {
  login: string;
  url: string;
  avatar?: string;
}

// GitHub contributors, written at build time by scripts/sync-contributors.mjs
// (avatars inlined as data URIs) and served from our own origin like the other
// catalogs, so opening this dialog makes no call to github.com.
const isContributors = (v: unknown): v is { contributors: Contributor[] } =>
  !!v &&
  Array.isArray((v as { contributors?: unknown }).contributors) &&
  (v as { contributors: unknown[] }).contributors.every(
    (c) => !!c && typeof (c as Contributor).login === 'string' && typeof (c as Contributor).url === 'string',
  );

/** The credits list, fetched on mount. The dialog is only mounted while open
 *  (`{open && <AboutDialog />}`), so nothing is fetched until it is asked for,
 *  and an unreachable file just means the section is not drawn. */
function useContributors(): Contributor[] {
  const { data } = useAsyncLoad(
    () => fetchCatalog<{ contributors: Contributor[] }>('contributors', isContributors),
    'contributors',
  );
  return data?.contributors ?? [];
}

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

/** "About {app}" modal: what the app is (a light web UI over the OpenRocket
 *  engine, full .ork support), version, and credits. Copy lives in i18n.
 *  Mounted only while open (`{open && <AboutDialog />}`). */
export function AboutDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const CONTRIBUTORS = useContributors();
  return (
    <Dialog id="about" title={appName()} onClose={onClose} layout="pad" size="lg">
      {/* The rocket, the tagline and the version used to be part of a bespoke
          header. The header is shared now and has one shape, and these read as
          content rather than chrome, so they open the body instead. */}
      <div className="mb-4 flex items-center gap-3">
        <span className="text-3xl">🚀</span>
        <p className="text-xs text-slate-400">
          {t('about.tagline')} · v{APP_VERSION}
        </p>
      </div>
      <UpdateCheck />

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

      {CONTRIBUTORS.length > 0 && (
        <div className="mt-4 border-t border-white/10 pt-3 text-xs leading-relaxed text-slate-500">
          <p>
            {/* The heading links to the full contributor graph when one is
                  configured — the list here is a build-time snapshot. */}
            {CONTRIBUTORS_URL ? (
              <a
                href={CONTRIBUTORS_URL}
                target="_blank"
                rel="noreferrer"
                title={t('about.contributorsAll')}
                className="text-sky-400 hover:underline"
              >
                {t('about.contributors')}
              </a>
            ) : (
              t('about.contributors')
            )}
          </p>
          <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-2">
            {CONTRIBUTORS.map((c) => (
              <li key={c.login}>
                <a
                  href={c.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 text-sky-400 hover:underline"
                >
                  {c.avatar ? (
                    <img src={c.avatar} alt="" aria-hidden className="size-5 rounded-full ring-1 ring-white/10" />
                  ) : (
                    <span
                      aria-hidden
                      className="grid size-5 place-items-center rounded-full bg-slate-800 text-[10px] font-medium text-slate-300 ring-1 ring-white/10"
                    >
                      {c.login.charAt(0).toUpperCase()}
                    </span>
                  )}
                  {c.login}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-4 border-t border-white/10 pt-3 text-xs leading-relaxed text-slate-500">
        <p>{t('about.credits')}</p>
        {/* WHICH OpenRocket. "The same physics core" is not checkable on its
              own: comparing a number against the desktop app, or asking whether
              a feature from some release is in here, needs the commit. Read from
              engine-java/extract/UPSTREAM at build time, never typed here. */}
        <p className="mt-1">
          <Trans
            i18nKey="about.enginePin"
            values={{ ref: UPSTREAM.shortRef, date: UPSTREAM.date }}
            components={{
              commitLink: (
                <a
                  href={UPSTREAM.commitUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sky-400 hover:underline"
                />
              ),
            }}
          />
        </p>
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
        <DialogButton onClick={onClose} variant="primary">
          {t('about.close')}
        </DialogButton>
      </div>
    </Dialog>
  );
}

/**
 * Check for a new version now and say what came of it, including that this is
 * the latest, which the banner's own timer never says. Disabled where there is
 * no service worker to ask (the dev server), with the reason in its title.
 */
function UpdateCheck() {
  const { t } = useTranslation();
  const checker = useUpdateStore((s) => s.checker);
  const result = useUpdateStore((s) => s.result);
  const checkNow = useUpdateStore((s) => s.checkNow);
  const online = useOnline();
  const message: Partial<Record<typeof result, string>> = {
    checking: t('update.checking'),
    upToDate: t('update.upToDate'),
    available: t('update.foundNew'),
    failed: t('update.checkFailed'),
  };
  return (
    <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      <button
        onClick={() => void checkNow()}
        disabled={!checker || result === 'checking' || !online}
        title={!checker ? t('update.checkUnavailable') : online ? undefined : t('common.needsConnection')}
        className="rounded-md bg-slate-800 px-2.5 py-1 font-medium text-slate-200 ring-1 ring-white/10 hover:bg-slate-700 disabled:opacity-40"
      >
        {t('update.check')}
      </button>
      {/* Mounted always, so the answer is announced when it lands. */}
      <span role="status" aria-live="polite" className={result === 'failed' ? 'text-amber-300' : 'text-slate-400'}>
        {message[result] ?? ''}
      </span>
    </div>
  );
}
