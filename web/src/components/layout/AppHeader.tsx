import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { LanguageSwitcher } from './LanguageSwitcher';

/** Top bar: title, language, and the New / Open .ork / Save .ork actions.
 *  Owns the hidden file input; hands the picked File up via onOpenFile. */
export function AppHeader({ canSave, onNew, onOpenFile, onSave }: {
  canSave: boolean;
  onNew: () => void;
  onOpenFile: (file: File) => void;
  onSave: () => void;
}) {
  const { t } = useTranslation();
  const orkRef = useRef<HTMLInputElement>(null);
  return (
    <header className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
      <span className="text-xl">🚀</span>
      <h1 className="text-base font-semibold tracking-tight">{t('app.title')}</h1>
      <span className="text-[10px] font-medium tabular-nums text-slate-500" title={t('app.version', { version: __APP_VERSION__ })}>
        v{__APP_VERSION__}
      </span>
      <div className="ml-auto flex items-center gap-2">
        <LanguageSwitcher />
        <button onClick={onNew} className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200">
          {t('file.new')}
        </button>
        <button onClick={() => orkRef.current?.click()} className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200">
          {t('file.open')}
        </button>
        <button onClick={onSave} disabled={!canSave} className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 disabled:opacity-40">
          {t('file.save')}
        </button>
      </div>
      <input
        ref={orkRef} type="file" accept=".ork" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onOpenFile(f); }}
      />
    </header>
  );
}
