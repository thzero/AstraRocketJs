import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { initEngine } from '../../engine/openRocketEngine';

/**
 * The header's engine-backend badge: which physics backend actually loaded
 * (WASM-GC or the JS fallback), shown once it is known.
 */
export function EngineBadge() {
  const { t } = useTranslation();
  // Which physics backend actually loaded (WASM-GC or the JS fallback). initEngine
  // is idempotent and already resolved before mount (main.tsx awaits it), so this
  // settles on the first tick.
  const [backend, setBackend] = useState<'wasm' | 'js' | null>(null);
  useEffect(() => {
    let ok = true;
    initEngine().then((b) => {
      if (ok) setBackend(b);
    });
    return () => {
      ok = false;
    };
  }, []);

  if (!backend) return null;
  return (
    <span
      title={t(backend === 'wasm' ? 'engine.wasmTip' : 'engine.jsTip')}
      className={`rounded px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide ring-1 ${
        backend === 'wasm'
          ? 'bg-emerald-500/10 text-emerald-300 ring-emerald-400/30'
          : 'bg-slate-500/10 text-slate-400 ring-white/15'
      }`}
    >
      {backend}
    </span>
  );
}
