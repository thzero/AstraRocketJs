import { useTranslation } from 'react-i18next';

export type ViewMode = '2d' | '3d' | 'drag' | 'flight' | 'path';
/** Always-available design views. */
const DESIGN_VIEWS: readonly ViewMode[] = ['2d', '3d', 'drag'];
/** Flight-output views — only offered once a simulation has produced a result. */
const RESULT_VIEWS: readonly ViewMode[] = ['flight', 'path'];

/** Center-pane view switch: 2D · 3D · Aero, plus Flight · 3D path once a sim has run. */
export function ViewToggle({
  view,
  onChange,
  hasResult,
}: {
  view: ViewMode;
  onChange: (v: ViewMode) => void;
  hasResult: boolean;
}) {
  const { t } = useTranslation();
  const views = hasResult ? [...DESIGN_VIEWS, ...RESULT_VIEWS] : DESIGN_VIEWS;
  return (
    <div className="inline-flex overflow-hidden rounded-lg ring-1 ring-white/10">
      {views.map((v) => (
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
