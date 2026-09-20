import { useTranslation } from 'react-i18next';

import { DESIGN_VIEWS, RESULT_VIEWS, isResultView, type ViewMode } from '../../state/tabs';
// Declared in state/tabs.ts (the store keeps view and tab in step); re-exported
// here so this component's importers are unchanged.
export { isResultView, type ViewMode };

/**
 * Center-pane view switch, showing one family: 2D · 3D · Aero on the Design tab,
 * Flight · 3D path · Ground track on Results.
 *
 * It used to render all five together and take a `mobileFamily` prop whose only
 * job was to hide the other family below `lg` — because on a phone the two
 * families already lived on different tabs, and offering "3D path" from Sketch
 * would have jumped you to another tab. Now that the tabs exist at every width,
 * the tab picks the family and this only switches within it.
 */
export function ViewToggle({
  view,
  onChange,
  family,
}: {
  view: ViewMode;
  onChange: (v: ViewMode) => void;
  family: 'design' | 'result';
}) {
  const { t } = useTranslation();
  const views = family === 'result' ? RESULT_VIEWS : DESIGN_VIEWS;
  return (
    <div className="inline-flex overflow-hidden rounded-lg ring-1 ring-white/10">
      {views.map((v) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          // Which view is open was conveyed by `bg-sky-600` and nothing else:
          // a screen reader could not tell, and neither could anyone who
          // cannot separate the two greys. Every sibling toggle in the app
          // already does this (AeroAnalysis, CenterView, TabBar,
          // SettingsDialog); this was the one that was missed.
          aria-pressed={view === v}
          className={`px-3 py-1 text-xs font-semibold ${view === v ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-300'}`}
        >
          {t(`view.${v}`)}
        </button>
      ))}
    </div>
  );
}
