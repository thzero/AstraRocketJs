import { useTranslation } from 'react-i18next';
import { useEngineStore } from '../../state/engineStore';
import { fmtMb } from '../../i18n/format';

/**
 * The banner that stands in for the numbers while the physics kernel is not
 * there yet.
 *
 * It is shown from inside the mounted app rather than by holding the mount back
 * (see main.tsx), which leaves everything that needs no kernel usable while it
 * loads: the tree, the drawing, the library, import and export.
 *
 * Two states, and the difference matters. A load that is merely slow reports
 * bytes and will finish. A load that has stalled reports nothing at all and
 * never finishes (no error, no progress, no end), so after
 * `engineStore.SLOW_AFTER_MS` the banner offers the retry, which is the only
 * thing that can recover it short of a reload.
 * When the JS build is the only backend a retry cannot recover it, so the
 * banner offers the reload instead.
 */
export function EngineNotice() {
  const { t } = useTranslation();
  const phase = useEngineStore((s) => s.phase);
  const status = useEngineStore((s) => s.status);
  const slow = useEngineStore((s) => s.slow);
  const retry = useEngineStore((s) => s.retry);
  const reload = useEngineStore((s) => s.reload);
  // A retry that cannot recover this load is not offered; a reload is.
  const needsReload = useEngineStore((s) => s.needsReload);

  if (phase === 'ready') return null;

  const stuck = phase === 'failed' || slow;

  // The step, in the `boot.*` strings: already translated, and they say the
  // right thing.
  const step = () => {
    if (!status) return t('boot.downloading');
    if (status.phase === 'starting') return t('boot.starting');
    if (status.total) return t('boot.downloadingOf', { done: fmtMb(status.loaded), total: fmtMb(status.total) });
    return status.loaded > 0 ? t('boot.downloaded', { done: fmtMb(status.loaded) }) : t('boot.downloading');
  };

  const headline = phase === 'failed' ? t('boot.failed') : stuck ? t('engine.slow') : step();
  // What a screen reader hears. The byte count changes every tenth of a
  // megabyte, and a polite region repeats itself on every change, so the live
  // text names the step alone and only changes when the step does.
  const spoken =
    phase === 'failed'
      ? t('boot.failed')
      : stuck
        ? `${t('engine.slow')} ${t('engine.needsIt')}`
        : status?.phase === 'starting'
          ? t('boot.starting')
          : t('boot.downloading');

  return (
    <div
      // Amber once it is stuck, because by then it is a warning rather than a
      // progress line; the app's shared warning tone, as the flight warnings use.
      className={`flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2 text-sm ${
        stuck ? 'border-warn-500/30 bg-warn-950/40 text-warn-200' : 'border-line/10 bg-surface text-ink-soft'
      }`}
    >
      <span role="status" className="sr-only">
        {spoken}
      </span>
      {/* The same words for the eye, with the byte count; hidden from a screen
          reader, which has them from the status line above. */}
      <span className="font-medium" aria-hidden="true">
        {headline}
      </span>
      {/* What still works, said only when the wait has become a problem: during
          an ordinary load it would be noise. */}
      {stuck && (
        <span className="text-xs opacity-90" aria-hidden="true">
          {t('engine.needsIt')}
        </span>
      )}
      {stuck && (
        <button
          type="button"
          onClick={needsReload ? reload : retry}
          className="ml-auto rounded-md bg-warn-500/15 px-2 py-1 text-xs font-medium text-warn-100 ring-1 ring-warn-400/30 hover:bg-warn-500/25"
        >
          {needsReload ? t('engine.reload') : t('engine.retry')}
        </button>
      )}
    </div>
  );
}
