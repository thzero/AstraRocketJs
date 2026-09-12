import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { APP_VERSION, HELP_URL, isPreRelease } from '../../services/appInfo';
import { initEngine } from '../../engine/openRocketEngine';
import { useWorkspaceStore } from '../../state/store';
import { DesignLibraryDialog } from './DesignLibraryDialog';
import { DesignPropertiesDialog } from './DesignPropertiesDialog';
import { defaultDesignName } from '../../services/appInfo';
import { LanguageSwitcher } from './LanguageSwitcher';
import { AboutDialog } from './AboutDialog';
import { ExportDialog } from '../report/ExportDialog';
import { PrivacyDialog } from './PrivacyDialog';
import { SettingsDialog } from './SettingsDialog';
import { MotorDashboard } from '../sim/MotorDashboard';

/** Top bar: title + version, language, and a collapsible menu holding the
 *  New / Open (library) / Save / Save As / Import / Export / About actions.
 *  Owns the hidden .ork file input that Import triggers. */
export function AppHeader() {
  const { t } = useTranslation();
  const canSave = useWorkspaceStore((s) => !!s.info);
  const onNew = useWorkspaceStore((s) => s.newWorkspace);
  const onOpenFile = useWorkspaceStore((s) => s.openOrkFile);
  const onSave = useWorkspaceStore((s) => s.saveOrk);
  const saveDesignAs = useWorkspaceStore((s) => s.saveDesignAs);
  const saveDesign = useWorkspaceStore((s) => s.saveDesign);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [saveAsOpen, setSaveAsOpen] = useState(false);
  const designs = useWorkspaceStore((s) => s.designs);
  const refreshDesigns = useWorkspaceStore((s) => s.refreshDesigns);
  // Pre-fill Save As with the imported .ork's name when there is one.
  const loadedName = useWorkspaceStore((s) => s.loadedMeta?.name);
  const onSaveRasaero = useWorkspaceStore((s) => s.saveRasaero);
  const onUndo = useWorkspaceStore((s) => s.undo);
  const onRedo = useWorkspaceStore((s) => s.redo);
  const canUndo = useWorkspaceStore((s) => s.past.length > 0);
  const canRedo = useWorkspaceStore((s) => s.future.length > 0);
  const orkRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const menuElRef = useRef<HTMLDivElement>(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [motorsOpen, setMotorsOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // "Import ▸" and "Export ▸" reveal their format sub-items inline (a flyout
  // would be clipped by the menu's overflow-hidden). Both collapse whenever the
  // menu itself closes.
  const [exportOpen, setExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  // Collapse both submenus when the menu closes, so it reopens in a known state.
  useEffect(() => {
    if (!menuOpen) {
      setExportOpen(false);
      setImportOpen(false);
    }
  }, [menuOpen]);
  // Which physics backend actually loaded (WASM-GC or the JS fallback). initEngine
  // is idempotent and already resolved before mount (main.tsx awaits it), so this
  // settles on the first tick.
  const [backend, setBackend] = useState<'wasm' | 'js' | null>(null);
  useEffect(() => {
    let ok = true;
    initEngine().then((b) => {
      if (ok) setBackend(b);
    });
    return () => {
      ok = false;
    };
  }, []);

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

  // Fulfil the menu role (WAI-ARIA menu-button pattern): on open, pull focus to
  // the first item and take every item out of the Tab sequence so ↑/↓ drive
  // navigation and Tab leaves the menu. Re-runs when the Export sub-item shows /
  // hides (Import or Export) or Save enables, but only steals focus on the initial open (guarded by
  // "is focus already inside the menu?").
  useEffect(() => {
    if (!menuOpen) return;
    const menu = menuElRef.current;
    if (!menu) return;
    const items = Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]'));
    items.forEach((el) => (el.tabIndex = -1));
    if (!menu.contains(document.activeElement)) {
      items.find((el) => !el.hasAttribute('disabled'))?.focus();
    }
  }, [menuOpen, exportOpen, importOpen, canSave]);

  // Arrow-key roving among the enabled, visible menu items; Escape closes and
  // returns focus to the trigger; Tab closes and lets focus move on naturally.
  const onMenuKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const menu = menuElRef.current;
    if (!menu) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      setMenuOpen(false);
      menuBtnRef.current?.focus();
      return;
    }
    if (e.key === 'Tab') {
      setMenuOpen(false); // no preventDefault — focus proceeds out of the menu
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

  // Keyboard: Ctrl/⌘+Z undoes, Ctrl+Shift+Z / Ctrl+Y redoes — globally, including
  // while a field is focused (edits commit on blur, so the field just re-renders
  // to the restored value). The store actions flush any in-flight edit and no-op
  // on an empty stack, so this is safe to call unconditionally; go through
  // getState to stay independent of render timing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        useWorkspaceStore.getState().undo();
      } else if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault();
        useWorkspaceStore.getState().redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const item =
    'flex w-full items-center px-3 py-2 text-left text-xs font-medium text-slate-200 hover:bg-slate-700 disabled:cursor-not-allowed disabled:text-slate-600 disabled:hover:bg-transparent';
  // Indented row style for the Import / Export format entries.
  const subItem =
    'flex w-full items-center py-2 pl-8 pr-3 text-left text-xs font-medium text-slate-200 hover:bg-slate-700 disabled:cursor-not-allowed disabled:text-slate-600 disabled:hover:bg-transparent';
  const iconBtn =
    'rounded-lg bg-slate-800 px-2.5 py-1.5 text-sm leading-none text-slate-200 ring-1 ring-white/10 hover:bg-slate-700 disabled:cursor-not-allowed disabled:text-slate-600 disabled:hover:bg-slate-800';

  return (
    <header className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
      <span className="text-xl">🚀</span>
      <h1 className="text-base font-semibold tracking-tight">{t('app.title')}</h1>
      <button
        onClick={() => setAboutOpen(true)}
        title={t('about.open')}
        className="rounded text-[10px] font-medium tabular-nums text-slate-500 hover:text-sky-400"
      >
        v{APP_VERSION}
      </button>
      {isPreRelease() && (
        <span
          title={t('about.wip')}
          className="rounded bg-amber-500/10 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-300 ring-1 ring-amber-400/30"
        >
          {t('wip.badge')}
        </span>
      )}
      {backend && (
        <span
          title={t(backend === 'wasm' ? 'engine.wasmTip' : 'engine.jsTip')}
          className={`rounded px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide ring-1 ${
            backend === 'wasm'
              ? 'bg-emerald-500/10 text-emerald-300 ring-emerald-400/30'
              : 'bg-slate-500/10 text-slate-400 ring-white/15'
          }`}
        >
          {backend}
        </span>
      )}

      <div className="ml-auto flex items-center gap-2">
        <div className="flex items-center gap-1">
          <button
            onClick={onUndo}
            disabled={!canUndo}
            title={`${t('edit.undo')} (Ctrl+Z)`}
            aria-label={t('edit.undo')}
            className={iconBtn}
          >
            ↶
          </button>
          <button
            onClick={onRedo}
            disabled={!canRedo}
            title={`${t('edit.redo')} (Ctrl+Shift+Z)`}
            aria-label={t('edit.redo')}
            className={iconBtn}
          >
            ↷
          </button>
        </div>
        <LanguageSwitcher />
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
            <div
              ref={menuElRef}
              role="menu"
              onKeyDown={onMenuKey}
              className="absolute right-0 z-50 mt-1 w-44 overflow-hidden rounded-lg bg-slate-800 py-1 shadow-xl ring-1 ring-white/10"
            >
              <button
                role="menuitem"
                className={item}
                onClick={() => {
                  setMenuOpen(false);
                  onNew();
                }}
              >
                {t('file.new')}
              </button>
              <button
                role="menuitem"
                className={item}
                onClick={() => {
                  setMenuOpen(false);
                  setLibraryOpen(true);
                }}
              >
                {t('file.openLibrary')}
              </button>
              <button
                role="menuitem"
                className={item}
                disabled={!canSave}
                onClick={() => {
                  setMenuOpen(false);
                  void (async () => {
                    // A design that has never been named has nowhere to save to,
                    // so Save becomes Save As — the usual desktop behaviour.
                    if (!(await saveDesign())) {
                      await refreshDesigns();
                      setSaveAsOpen(true);
                    }
                  })();
                }}
              >
                {t('file.save')}
              </button>
              <button
                role="menuitem"
                className={item}
                disabled={!canSave}
                onClick={() => {
                  setMenuOpen(false);
                  // Names of existing designs drive the duplicate warning.
                  void refreshDesigns();
                  setSaveAsOpen(true);
                }}
              >
                {t('file.saveAs')}
              </button>
              <div className="my-1 border-t border-white/10" />
              <button
                role="menuitem"
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
                  className={subItem}
                  onClick={() => {
                    setMenuOpen(false);
                    orkRef.current?.click();
                  }}
                >
                  {t('file.ork')}
                </button>
              )}
              <button
                role="menuitem"
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
                  className={subItem}
                  disabled={!canSave}
                  onClick={() => {
                    setMenuOpen(false);
                    onSave();
                  }}
                >
                  {t('file.ork')}
                </button>
              )}
              {exportOpen && (
                <button
                  role="menuitem"
                  className={subItem}
                  disabled={!canSave}
                  onClick={() => {
                    setMenuOpen(false);
                    onSaveRasaero();
                  }}
                >
                  {t('file.rasaero')}
                </button>
              )}
              <button
                role="menuitem"
                className={item}
                disabled={!canSave}
                onClick={() => {
                  setMenuOpen(false);
                  setReportOpen(true);
                }}
              >
                {t('file.report')}
              </button>
              <div className="my-1 border-t border-white/10" />
              <button
                role="menuitem"
                className={item}
                onClick={() => {
                  setMenuOpen(false);
                  setMotorsOpen(true);
                }}
              >
                {t('dash.menu')}
              </button>
              <div className="my-1 border-t border-white/10" />
              <button
                role="menuitem"
                className={item}
                onClick={() => {
                  setMenuOpen(false);
                  setSettingsOpen(true);
                }}
              >
                {t('settings.title')}
              </button>
              <a
                role="menuitem"
                className={item}
                href={HELP_URL}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setMenuOpen(false)}
              >
                {t('menu.help')}
              </a>
              <div className="my-1 border-t border-white/10" />
              <button
                role="menuitem"
                className={item}
                onClick={() => {
                  setMenuOpen(false);
                  setPrivacyOpen(true);
                }}
              >
                {t('about.privacy')}
              </button>
              <button
                role="menuitem"
                className={item}
                onClick={() => {
                  setMenuOpen(false);
                  setAboutOpen(true);
                }}
              >
                {t('about.open')}
              </button>
            </div>
          )}
        </div>
      </div>

      <input
        ref={orkRef}
        type="file"
        accept=".ork"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) onOpenFile(f);
        }}
      />
      <MotorDashboard open={motorsOpen} onClose={() => setMotorsOpen(false)} />
      <ExportDialog open={reportOpen} onClose={() => setReportOpen(false)} />
      <AboutDialog open={aboutOpen} onClose={() => setAboutOpen(false)} />
      <PrivacyDialog open={privacyOpen} onClose={() => setPrivacyOpen(false)} />
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <DesignLibraryDialog open={libraryOpen} onClose={() => setLibraryOpen(false)} />
      <DesignPropertiesDialog
        open={saveAsOpen}
        title={t('file.saveAs')}
        confirmLabel={t('common.save')}
        initialName={loadedName ?? defaultDesignName()}
        takenNames={designs.map((d) => d.name)}
        onCancel={() => setSaveAsOpen(false)}
        onConfirm={(name) => {
          setSaveAsOpen(false);
          void saveDesignAs(name);
        }}
      />
    </header>
  );
}
