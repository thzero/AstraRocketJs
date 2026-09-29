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
      // No pill and no width gate of its own: it is one item inside the
      // header's badge group, which carries both. See AppHeader.
      className={`text-[9px] font-semibold uppercase tracking-wide ${
        backend === 'wasm' ? 'text-emerald-300' : 'text-slate-400'
      }`}
    >
      {backend}
    </span>
  );
}
