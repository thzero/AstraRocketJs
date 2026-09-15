import { useTranslation } from 'react-i18next';

export type ViewMode = '2d' | '3d' | 'drag' | 'flight' | 'path';
/** Always-available design views. */
const DESIGN_VIEWS: readonly ViewMode[] = ['2d', '3d', 'drag'];
/** Flight-output views — only offered once a simulation has produced a result. */
const RESULT_VIEWS: readonly ViewMode[] = ['flight', 'path'];

/** True for a view that reads a flight result rather than the design itself. */
export const isResultView = (view: ViewMode): boolean => RESULT_VIEWS.includes(view);

/** Center-pane view switch: 2D · 3D · Aero, plus Flight · 3D path once a sim has run. */
export function ViewToggle({
  view,
  onChange,
  hasResult,
  mobileFamily,
}: {
  view: ViewMode;
  onChange: (v: ViewMode) => void;
  hasResult: boolean;
  /**
   * Which family the phone's current tab shows. Below the desktop breakpoint the
   * other family's buttons are hidden, because on a phone these views live on
   * two different tabs: offering "3D path" from the Sketch tab would jump you to
   * another tab, and offering "2D" from Results would leave the tab you are on.
   * The tab bar switches family; this switches within one.
   *
   * At lg+ there are no tabs and all five show together, as they always have.
   */
  mobileFamily: 'design' | 'result';
}) {
  const { t } = useTranslation();
  const views = hasResult ? [...DESIGN_VIEWS, ...RESULT_VIEWS] : DESIGN_VIEWS;
  return (
    <div className="inline-flex overflow-hidden rounded-lg ring-1 ring-white/10">
      {views.map((v) => {
        const thisTab = isResultView(v) === (mobileFamily === 'result');
        return (
          <button
            key={v}
            onClick={() => onChange(v)}
            className={`${thisTab ? '' : 'max-lg:hidden'} px-3 py-1 text-xs font-semibold ${view === v ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-300'}`}
          >
            {t(`view.${v}`)}
          </button>
        );
      })}
    </div>
  );
}
