/**
 * Every component that renders a disclosure or a popup (a control carrying
 * `aria-expanded`, or a native `<details>`), with how many such controls it
 * renders. a11y.spec.ts holds at least that many scans per component.
 * tests/popupSurfaces.test.ts holds this list to the source, and a11y.spec.ts
 * keys its popup scans on it, so a popup the app gains fails a gate until axe
 * scans it in the state the page does not open in.
 */
export const POPUP_SURFACES = {
  // The checkbox dropdown behind the motor filters and the dashboard columns.
  CheckMenu: 1,
  // The per-part export menu in the component tree.
  ComponentExportButton: 1,
  // A tree row's own fold, and the fold of the whole list.
  ComponentTree: 2,
  // A submenu row, and the menu button itself.
  FileMenu: 2,
  // The drift sweep panel over the ground track.
  GroundTrack: 1,
  // The contents list beside the help pages.
  HelpDialog: 1,
  // The image export menu on the 2D and 3D views.
  ImageExportMenu: 1,
  // The import notes list under the loaded design's name.
  LoadedBanner: 1,
  // Off the rail's wind from a forecast.
  OffTheRail: 1,
  // The flight picker in the results heading.
  ResultPicker: 1,
  // The safety card's fold.
  SimSummary: 1,
  // The statistics strip's fold.
  StabilityBadge: 1,
} as const;

export type PopupSurface = keyof typeof POPUP_SURFACES;
