import { useTranslation } from 'react-i18next';

export type ViewMode = '2d' | '3d' | 'flight' | 'path';
const VIEWS: readonly ViewMode[] = ['2d', '3d', 'flight', 'path'];

/** Center-pane view switch: 2D · 3D · Flight profile · 3D path. */
export function ViewToggle({ view, onChange }: { view: ViewMode; onChange: (v: ViewMode) => void }) {
  const { t } = useTranslation();
  return (
    <div className="inline-flex overflow-hidden rounded-lg ring-1 ring-white/10">
      {VIEWS.map((v) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          className={`px-3 py-1 text-xs font-semibold ${view === v ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-300'}`}
        >
          {t(`view.${v}`)}
        </button>
      ))}
    </div>
  );
}
