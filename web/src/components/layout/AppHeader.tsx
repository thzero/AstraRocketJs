import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { APP_VERSION } from '../../services/appInfo';
import { LanguageSwitcher } from './LanguageSwitcher';
import { AboutDialog } from './AboutDialog';
import { PrivacyDialog } from './PrivacyDialog';
import { SettingsDialog } from './SettingsDialog';

/** Top bar: title + version, language, and a collapsible menu holding the
 *  New / Open .ork / Save .ork / About actions. Owns the hidden file input. */
export function AppHeader({ canSave, onNew, onOpenFile, onSave }: {
  canSave: boolean;
  onNew: () => void;
  onOpenFile: (file: File) => void;
  onSave: () => void;
}) {
  const { t } = useTranslation();
  const orkRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  // Close the menu on outside click / Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey); };
  }, [menuOpen]);

  const item = 'flex w-full items-center px-3 py-2 text-left text-xs font-medium text-slate-200 hover:bg-slate-700 disabled:cursor-not-allowed disabled:text-slate-600 disabled:hover:bg-transparent';

  return (
    <header className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
      <span className="text-xl">🚀</span>
      <h1 className="text-base font-semibold tracking-tight">{t('app.title')}</h1>
      <button
        onClick={() => setAboutOpen(true)} title={t('about.open')}
        className="rounded text-[10px] font-medium tabular-nums text-slate-500 hover:text-sky-400"
      >
        v{APP_VERSION}
      </button>

      <div className="ml-auto flex items-center gap-2">
        <LanguageSwitcher />
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen((o) => !o)} aria-haspopup="menu" aria-expanded={menuOpen} title={t('menu.open')}
            className="flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 ring-1 ring-white/10 hover:bg-slate-700"
          >
            <span aria-hidden>☰</span> {t('menu.open')}
          </button>
          {menuOpen && (
            <div role="menu" className="absolute right-0 z-50 mt-1 w-44 overflow-hidden rounded-lg bg-slate-800 py-1 shadow-xl ring-1 ring-white/10">
              <button role="menuitem" className={item} onClick={() => { setMenuOpen(false); onNew(); }}>{t('file.new')}</button>
              <button role="menuitem" className={item} onClick={() => { setMenuOpen(false); orkRef.current?.click(); }}>{t('file.open')}</button>
              <button role="menuitem" className={item} disabled={!canSave} onClick={() => { setMenuOpen(false); onSave(); }}>{t('file.save')}</button>
              <div className="my-1 border-t border-white/10" />
              <button role="menuitem" className={item} onClick={() => { setMenuOpen(false); setSettingsOpen(true); }}>{t('settings.title')}</button>
              <button role="menuitem" className={item} onClick={() => { setMenuOpen(false); setPrivacyOpen(true); }}>{t('about.privacy')}</button>
              <button role="menuitem" className={item} onClick={() => { setMenuOpen(false); setAboutOpen(true); }}>{t('about.open')}</button>
            </div>
          )}
        </div>
      </div>

      <input
        ref={orkRef} type="file" accept=".ork" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onOpenFile(f); }}
      />
      <AboutDialog open={aboutOpen} onClose={() => setAboutOpen(false)} />
      <PrivacyDialog open={privacyOpen} onClose={() => setPrivacyOpen(false)} />
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </header>
  );
}
