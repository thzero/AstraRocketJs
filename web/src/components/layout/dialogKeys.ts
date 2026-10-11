/**
 * The keys of the header's dialogs and of the tabs inside the tabbed ones.
 *
 * In a module of their own, with no imports, so the end-to-end specs can key
 * their scans on them without pulling the components (and the build-time
 * globals those read) into the specs' typecheck.
 */

/** Every dialog the header and its menu can raise. */
export type HeaderDialog =
  | 'motors'
  | 'report'
  | 'about'
  | 'updates'
  | 'privacy'
  | 'settings'
  | 'library'
  | 'examples'
  | 'print'
  | 'locations'
  | 'parts'
  | 'saveAs';

/** The Settings dialog's tabs. */
export type SettingsTab = 'general' | 'units' | 'colors' | 'materials' | 'playback' | 'sketch' | 'sim' | 'launch';

/** The design library's tabs. */
export const LIBRARY_TABS = ['mine', 'examples'] as const;
export type LibraryTab = (typeof LIBRARY_TABS)[number];
