import { useTranslation } from 'react-i18next';
import { useEngineStore } from '../../state/engineStore';

/**
 * The header's engine-backend badge: which physics backend actually loaded
 * (WASM-GC or the JS fallback), shown once it is known.
 *
 * Nothing while the engine is still loading or has failed: which backend did not
 * load is not a fact, and EngineNotice is already saying the useful thing.
 */
export function EngineBadge() {
  const { t } = useTranslation();
  const backend = useEngineStore((s) => s.backend);

  if (!backend) return null;
  return (
    <span
      title={t(backend === 'wasm' ? 'engine.wasmTip' : 'engine.jsTip')}
      // `hidden` under xl with the header's other two static badges: at 1024
      // the row does not fit in six of the ten languages. See AppHeader.
      className={`hidden rounded px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide ring-1 xl:inline ${
        backend === 'wasm'
          ? 'bg-emerald-500/10 text-emerald-300 ring-emerald-400/30'
          : 'bg-slate-500/10 text-slate-400 ring-white/15'
      }`}
    >
      {backend}
    </span>
  );
}
