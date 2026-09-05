import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { APP_VERSION, HELP_URL, isPreRelease } from '../../services/appInfo';
import { initEngine } from '../../engine/openRocketEngine';
import { useWorkspaceStore } from '../../state/store';
import { LanguageSwitcher } from './LanguageSwitcher';
import { AboutDialog } from './AboutDialog';
import { PrivacyDialog } from './PrivacyDialog';
import { SettingsDialog } from './SettingsDialog';
import { MotorDashboard } from '../sim/MotorDashboard';

/** Top bar: title + version, language, and a collapsible menu holding the
 *  New / Open .ork / Save .ork / About actions. Owns the hidden file input. */
export function AppHeader() {
  const { t } = useTranslation();
  const canSave = useWorkspaceStore((s) => !!s.info);
  const onNew = useWorkspaceStore((s) => s.newWorkspace);
  const onOpenFile = useWorkspaceStore((s) => s.openOrkFile);
  const onSave = useWorkspaceStore((s) => s.saveOrk);
  const onSaveRasaero = useWorkspaceStore((s) => s.saveRasaero);
  const onUndo = useWorkspaceStore((s) => s.undo);
  const onRedo = useWorkspaceStore((s) => s.redo);
  const canUndo = useWorkspaceStore((s) => s.past.length > 0);
  const canRedo = useWorkspaceStore((s) => s.future.length > 0);
  const orkRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [motorsOpen, setMotorsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // "Export ▸" reveals its format sub-items inline (a flyout would be clipped by
  // the menu's overflow-hidden). Collapsed whenever the menu itself closes.
  const [exportOpen, setExportOpen] = useState(false);
  useEffect(() => {
    if (!menuOpen) setExportOpen(false);
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
  // Same row style, indented for the Export flyout's format entries.
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
              role="menu"
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
                  orkRef.current?.click();
                }}
              >
                {t('file.open')}
              </button>
              <button
                role="menuitem"
                className={item}
                disabled={!canSave}
                onClick={() => {
                  setMenuOpen(false);
                  onSave();
                }}
              >
                {t('file.save')}
              </button>
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
                    onSaveRasaero();
                  }}
                >
                  {t('file.rasaero')}
                </button>
              )}
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
      <AboutDialog open={aboutOpen} onClose={() => setAboutOpen(false)} />
      <PrivacyDialog open={privacyOpen} onClose={() => setPrivacyOpen(false)} />
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </header>
  );
}
