import { useSettings } from '../../state/SettingsProvider';
import { useIsDesktop } from '../common/useMediaQuery';

/**
 * Whether this window offers the component TREE: the surface for adding,
 * reordering, deleting and scaling parts, and so the answer to "can a design be
 * built here, or only read, edited part by part, and flown?".
 *
 * Two things take the tree away from a window. Under `lg` it is not rendered at
 * all, because a phone has no room for a column beside the drawing. And the
 * maximize mode deliberately puts both side columns aside to give the drawing
 * the window.
 *
 * Deliberately NOT the current tab. The tree is not on screen on Simulations or
 * Configurations either, but the design is still buildable from there, and a
 * menu entry that came and went as you moved between tabs would be churn rather
 * than a rule.
 *
 * What hangs off this is the design-authoring chrome that has nowhere to land
 * without the tree: the My Parts library in the file menu (a saved part is
 * applied through a component, and adding the component it belongs on is the
 * thing that cannot be done here), and the rocket's own name and configuration
 * on the design banner.
 */
export function useCanBuildDesign(): boolean {
  const desktop = useIsDesktop();
  const { settings } = useSettings();
  return desktop && !settings.maximizeCenter;
}
