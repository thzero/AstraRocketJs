/**
 * Every component that renders a dialog shell (`<Dialog>` or `<AlertDialog>`),
 * with how many shells it renders. tests/dialogSurfaces.test.ts holds this list
 * to the source, and a11y.spec.ts keys its dialog scans on it, so a dialog the
 * app gains fails a gate until axe scans it.
 */
export const DIALOG_SURFACES = {
  AboutDialog: 1,
  ComponentDialog: 1,
  ComponentPicker: 1,
  ConfirmDialog: 1,
  DesignLibraryDialog: 1,
  DesignPropertiesDialog: 1,
  ExamplesDialog: 1,
  // The report, and its print settings over it.
  ExportDialog: 2,
  FlightCsvDialog: 1,
  FlightPathExport: 1,
  HelpDialog: 1,
  LocationsDialog: 1,
  MotorDashboard: 1,
  MotorDialog: 1,
  MotorSpecDialog: 1,
  PlaceSearchDialog: 1,
  PrintExportDialog: 1,
  PrivacyDialog: 1,
  RecoverySizingReadout: 1,
  RocketConfigDialog: 1,
  SavePartButton: 1,
  SavedPartsDialog: 1,
  ScaleDialog: 1,
  SettingsDialog: 1,
  SiteMapDialog: 1,
  StageColorDialog: 1,
  UpdateCheckDialog: 1,
  WeatherDialog: 1,
  WindProfileDialog: 1,
  WorkInProgressDialog: 1,
} as const;

export type DialogSurface = keyof typeof DIALOG_SURFACES;
