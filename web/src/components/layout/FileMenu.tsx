import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { docPageUrl } from '../../services/appInfo';

/**
 * The header's file menu: the trigger button that owns the open flag and
 * outside-click / Escape closing (`FileMenuButton`), and the dropdown itself
 * with its keyboard roving and inline Import / Export submenus (`FileMenu`).
 */

const item =
  'flex w-full items-center px-3 py-2 text-left text-xs font-medium text-slate-200 hover:bg-slate-700 disabled:cursor-not-allowed disabled:text-slate-600 disabled:hover:bg-transparent';
// Indented row style for the Import / Export format entries.
const subItem =
  'flex w-full items-center py-2 pl-8 pr-3 text-left text-xs font-medium text-slate-200 hover:bg-slate-700 disabled:cursor-not-allowed disabled:text-slate-600 disabled:hover:bg-transparent';

export interface FileMenuActions {
  onNew: () => void;
  onOpenLibrary: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onImportOrk: () => void;
  onImportRkt: () => void;
  onImportExamples: () => void;
  onExportOrk: () => void;
  onExportRkt: () => void;
  onExportPrint: () => void;
  onExportRasaero: () => void;
  onReport: () => void;
  onMotors: () => void;
  onLaunchLocations: () => void;
  onSettings: () => void;
  onPrivacy: () => void;
  onAbout: () => void;
}

/**
 * The header's dropdown menu (WAI-ARIA menu-button pattern): New / Open /
 * Save / Save As / Import / Export / Report / Motors / Launch locations / Settings /
 * Help /
 * Safety / Privacy / About.
 *
 * Mounted only while open (`{menuOpen && <FileMenu />}`), and it owns the two
 * inline "Import" / "Export" submenus: they reveal their format sub-items in
 * place (a flyout would be clipped by the menu's overflow-hidden) and collapse
 * whenever the menu closes, which unmounting does for free. AppHeader used to
 * hold that state and reset it in an effect on `menuOpen`.
 *
 * Every item is `tabIndex={-1}` in the JSX so the arrow keys drive navigation
 * and Tab leaves the menu; that used to be an imperative
 * `items.forEach((el) => (el.tabIndex = -1))` re-run whenever a sub-item
 * appeared.
 */
function FileMenu({
  canSave,
  helpHref,
  onClose,
  onEscape,
  actions,
}: {
  canSave: boolean;
  helpHref: string;
  /** Close the menu (an item was chosen, or Tab moved on). */
  onClose: () => void;
  /** Escape: close and return focus to the trigger. */
  onEscape: () => void;
  actions: FileMenuActions;
}) {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  // On open, pull focus to the first enabled item, unless focus is already
  // inside (the trigger handed it over). Once, on mount: the menu is a fresh
  // instance per opening.
  useEffect(() => {
    const menu = menuRef.current;
    if (!menu || menu.contains(document.activeElement)) return;
    Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]'))
      .find((el) => !el.hasAttribute('disabled'))
      ?.focus();
  }, []);

  // Arrow-key roving among the enabled, visible menu items; Escape closes and
  // returns focus to the trigger; Tab closes and lets focus move on naturally.
  const onMenuKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const menu = menuRef.current;
    if (!menu) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      onEscape();
      return;
    }
    if (e.key === 'Tab') {
      onClose(); // no preventDefault: focus proceeds out of the menu
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const items = Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])')).filter(
      (el) => el.offsetParent !== null,
    );
    if (items.length === 0) return;
    const i = items.indexOf(document.activeElement as HTMLElement);
    const to =
      e.key === 'Home'
        ? 0
        : e.key === 'End'
          ? items.length - 1
          : e.key === 'ArrowDown'
            ? (i + 1) % items.length
            : (i - 1 + items.length) % items.length;
    items[to]?.focus();
  };

  /** Close the menu, then run the action. */
  const run = (action: () => void) => () => {
    onClose();
    action();
  };

  return (
    <div
      ref={menuRef}
      role="menu"
      onKeyDown={onMenuKey}
      className="absolute right-0 z-50 mt-1 w-44 overflow-hidden rounded-lg bg-slate-800 py-1 shadow-xl ring-1 ring-white/10"
    >
      <button role="menuitem" tabIndex={-1} className={item} onClick={run(actions.onNew)}>
        {t('file.new')}
      </button>
      <button role="menuitem" tabIndex={-1} className={item} onClick={run(actions.onOpenLibrary)}>
        {t('file.openLibrary')}
      </button>
      <button role="menuitem" tabIndex={-1} className={item} disabled={!canSave} onClick={run(actions.onSave)}>
        {t('file.save')}
      </button>
      <button role="menuitem" tabIndex={-1} className={item} disabled={!canSave} onClick={run(actions.onSaveAs)}>
        {t('file.saveAs')}
      </button>
      <div className="my-1 border-t border-white/10" />
      <button
        role="menuitem"
        tabIndex={-1}
        className={item}
        aria-haspopup="true"
        aria-expanded={importOpen}
        onClick={() => setImportOpen((o) => !o)}
      >
        <span className="flex-1">{t('file.import')}</span>
        <span aria-hidden className="text-slate-400">
          {importOpen ? '▾' : '▸'}
        </span>
      </button>
      {importOpen && (
        <button
          role="menuitem"
          tabIndex={-1}
          className={subItem}
          aria-label={t('file.importOrkLabel')}
          onClick={run(actions.onImportOrk)}
        >
          {t('file.importOrk')}
        </button>
      )}
      {importOpen && (
        <button
          role="menuitem"
          tabIndex={-1}
          className={subItem}
          aria-label={t('file.importRktLabel')}
          onClick={run(actions.onImportRkt)}
        >
          {t('file.importRkt')}
        </button>
      )}
      {/* Under Import and not beside New, because that is what opening one is:
          it reads a `.ork` and lands an unsaved copy, exactly as the entry above
          does — the file just happens to ship with the app. */}
      {importOpen && (
        <button
          role="menuitem"
          tabIndex={-1}
          className={subItem}
          aria-label={t('file.importExamplesLabel')}
          onClick={run(actions.onImportExamples)}
        >
          {t('file.importExamples')}
        </button>
      )}
      <button
        role="menuitem"
        tabIndex={-1}
        className={item}
        aria-haspopup="true"
        aria-expanded={exportOpen}
        disabled={!canSave}
        onClick={() => setExportOpen((o) => !o)}
      >
        <span className="flex-1">{t('file.export')}</span>
        <span aria-hidden className="text-slate-400">
          {exportOpen ? '▾' : '▸'}
        </span>
      </button>
      {exportOpen && (
        <button
          role="menuitem"
          tabIndex={-1}
          className={subItem}
          aria-label={t('file.exportOrkLabel')}
          disabled={!canSave}
          onClick={run(actions.onExportOrk)}
        >
          {t('file.exportOrk')}
        </button>
      )}
      {exportOpen && (
        <button
          role="menuitem"
          tabIndex={-1}
          className={subItem}
          aria-label={t('file.exportRktLabel')}
          disabled={!canSave}
          onClick={run(actions.onExportRkt)}
        >
          {t('file.exportRkt')}
        </button>
      )}
      {exportOpen && (
        <button
          role="menuitem"
          tabIndex={-1}
          className={subItem}
          aria-label={t('file.exportPrintLabel')}
          disabled={!canSave}
          onClick={run(actions.onExportPrint)}
        >
          {t('file.exportPrint')}
        </button>
      )}
      {exportOpen && (
        <button
          role="menuitem"
          tabIndex={-1}
          className={subItem}
          disabled={!canSave}
          onClick={run(actions.onExportRasaero)}
        >
          {t('file.rasaero')}
        </button>
      )}
      <button role="menuitem" tabIndex={-1} className={item} disabled={!canSave} onClick={run(actions.onReport)}>
        {t('file.report')}
      </button>
      <div className="my-1 border-t border-white/10" />
      <button role="menuitem" tabIndex={-1} className={item} onClick={run(actions.onMotors)}>
        {t('dash.menu')}
      </button>
      {/* Beside the motor dashboard, which is the same kind of entry: a place
          to see and manage a library of your own that is otherwise only
          reachable from the one panel that happens to use it. */}
      <button role="menuitem" tabIndex={-1} className={item} onClick={run(actions.onLaunchLocations)}>
        {t('location.menu')}
      </button>
      <div className="my-1 border-t border-white/10" />
      <button role="menuitem" tabIndex={-1} className={item} onClick={run(actions.onSettings)}>
        {t('settings.title')}
      </button>
      <a
        role="menuitem"
        tabIndex={-1}
        className={item}
        href={helpHref}
        target="_blank"
        rel="noopener noreferrer"
        onClick={onClose}
      >
        {t('menu.help')}
      </a>
      {/* Its own entry rather than a page buried in Help: what a simulation is
          worth, and what to check on the real rocket, is the one doc a user
          should not have to go looking for. */}
      <a
        role="menuitem"
        tabIndex={-1}
        className={item}
        href={docPageUrl(helpHref, 'safety')}
        target="_blank"
        rel="noopener noreferrer"
        onClick={onClose}
      >
        {t('menu.safety')}
      </a>
      <div className="my-1 border-t border-white/10" />
      <button role="menuitem" tabIndex={-1} className={item} onClick={run(actions.onPrivacy)}>
        {t('about.privacy')}
      </button>
      <button role="menuitem" tabIndex={-1} className={item} onClick={run(actions.onAbout)}>
        {t('about.open')}
      </button>
    </div>
  );
}

/** The menu-button: the trigger plus the menu it opens, closed on outside click. */
export function FileMenuButton({
  canSave,
  helpHref,
  actions,
}: {
  canSave: boolean;
  helpHref: string;
  actions: FileMenuActions;
}) {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  // Close the menu on outside click / Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  return (
    <div className="relative" ref={menuRef}>
      <button
        ref={menuBtnRef}
        onClick={() => setMenuOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        title={t('menu.open')}
        className="flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 ring-1 ring-white/10 hover:bg-slate-700"
      >
        <span aria-hidden>☰</span> {t('menu.open')}
      </button>
      {menuOpen && (
        <FileMenu
          canSave={canSave}
          helpHref={helpHref}
          onClose={() => setMenuOpen(false)}
          onEscape={() => {
            setMenuOpen(false);
            menuBtnRef.current?.focus();
          }}
          actions={actions}
        />
      )}
    </div>
  );
}
