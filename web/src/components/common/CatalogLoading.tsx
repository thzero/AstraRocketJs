import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { subscribeCatalogProgress, type CatalogProgress } from '../../services/remoteData';

/**
 * Download feedback for the runtime catalogs (see services/remoteData.ts).
 *
 * The motor catalog is ~1.6 MB and the component catalog ~1.0 MB, fetched on
 * first use rather than bundled. A bare "Loading…" leaves the user unable to
 * tell a slow link from a stalled one — which is the common case on mobile,
 * where the transfer can legitimately take tens of seconds.
 */

const MB = 1024 * 1024;
const mb = (bytes: number) => (bytes / MB).toFixed(1);

/** Live progress for one catalog, or null before the first byte is reported. */
export function useCatalogProgress(name: string): CatalogProgress | null {
  const [progress, setProgress] = useState<CatalogProgress | null>(null);
  useEffect(() => subscribeCatalogProgress(name, setProgress), [name]);
  return progress;
}

/** Phase label plus a bar — determinate when the host declared a length, pulsing
 *  when it did not, so we never show a percentage we cannot stand behind. */
export function CatalogLoading({ name, label }: { name: string; label: string }) {
  const { t } = useTranslation();
  const progress = useCatalogProgress(name);
  const pct = progress?.total ? Math.min(100, Math.round((progress.loaded / progress.total) * 100)) : null;
  const bytes =
    !progress || progress.loaded === 0
      ? null
      : progress.total
        ? t('catalog.loadingOf', { done: mb(progress.loaded), total: mb(progress.total) })
        : t('catalog.loadedSoFar', { done: mb(progress.loaded) });

  return (
    <div className="space-y-3 px-3 py-6 text-center text-base text-slate-300">
      <p>
        {label}
        {bytes && <span className="ml-1.5 tabular-nums text-slate-400">{bytes}</span>}
      </p>
      <div
        // Capped against the viewport so the wider bar never overflows on a phone.
        className="mx-auto h-2 w-[min(20rem,72vw)] overflow-hidden rounded-full bg-slate-700/60"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        // Omitted while indeterminate — assistive tech then announces "busy"
        // rather than a made-up percentage.
        aria-valuenow={pct ?? undefined}
      >
        <div
          className={`h-full rounded-full bg-sky-500 transition-[width] duration-150 ${pct == null ? 'animate-pulse' : ''}`}
          style={{ width: pct == null ? '100%' : `${pct}%` }}
        />
      </div>
    </div>
  );
}

/** Failure state: says what failed and offers a retry, instead of an empty list. */
export function CatalogError({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3 px-3 py-6 text-center text-base">
      <p className="text-amber-300">{message}</p>
      <button onClick={onRetry} className="rounded-lg bg-slate-700 px-4 py-2 text-slate-100 hover:bg-slate-600">
        {t('catalog.retry')}
      </button>
    </div>
  );
}
