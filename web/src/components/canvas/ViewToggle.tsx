import { useTranslation } from 'react-i18next';

import { DESIGN_VIEWS, RESULT_VIEWS, type ViewMode } from '../../state/tabs';
import { Segmented } from '../common/Segmented';

/**
 * Center-pane view switch, showing one family: 2D · 3D · Aero on the Design tab,
 * Flight · 3D path · Ground track · Environment on Results.
 *
 * The tab picks the family and this only switches within it. Rendering all five
 * together would offer "3D path" from Sketch, which jumps to another tab.
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
  return <Segmented size="sm" options={views} value={view} onChange={onChange} fmt={(v) => t(`view.${v}`)} />;
}
