import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  loadCatalog, filterMotors, allClasses, allManufacturers,
  importCustomMotorFromEng, deleteCustomMotor, type CatalogMotor,
} from '../../services/motorDb';
import { fetchMotorSpec } from '../../services/thrustcurve';
import type { MotorSpec } from '../../engine/openRocketEngine';
import { fmtNum } from '../../i18n/format';

/**
 * Modal motor picker. Filters the catalogue by engine code (text), manufacturer,
 * and impulse class; imports a custom .eng; and resolves the chosen motor's full
 * thrust curve (with the given ejection delay) via `onSelect`.
 */
export function MotorDialog({ open, onClose, onSelect, onError }: {
  open: boolean;
  onClose: () => void;
  onSelect: (m: MotorSpec) => void;
  onError: (msg: string | null) => void;
}) {
  const { t } = useTranslation();
  const [catalog, setCatalog] = useState<CatalogMotor[]>([]);
  const [text, setText] = useState('');
  const [cls, setCls] = useState<string | null>(null);
  const [mfr, setMfr] = useState<string>('');
  const [delay, setDelay] = useState(3);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    loadCatalog().then((c) => { if (live) setCatalog(c); });
    return () => { live = false; };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const classes = useMemo(() => allClasses(catalog), [catalog]);
  const manufacturers = useMemo(() => allManufacturers(catalog), [catalog]);
  const matches = useMemo(
    () => filterMotors(catalog, {
      text,
      classes: cls ? new Set([cls]) : new Set(),
      manufacturers: mfr ? new Set([mfr]) : new Set(),
    }),
    [catalog, text, cls, mfr],
  );
  const shown = matches.slice(0, 300);

  if (!open) return null;

  const pick = async (m: CatalogMotor, rowId: string) => {
    setLoadingId(rowId);
    onError(null);
    try {
      onSelect(await fetchMotorSpec(m, delay));
      onClose();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingId(null);
    }
  };

  const onImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    onError(null);
    try { setCatalog(await importCustomMotorFromEng(await file.text())); }
    catch (err) { onError(err instanceof Error ? err.message : String(err)); }
  };

  const onDelete = async (m: CatalogMotor) => {
    if (!m.id) return;
    onError(null);
    try { setCatalog(await deleteCustomMotor(m.id)); }
    catch (err) { onError(err instanceof Error ? err.message : String(err)); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose} role="dialog" aria-modal="true">
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-xl bg-slate-900 ring-1 ring-white/10" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-2 border-b border-white/10 p-3">
          <h2 className="text-sm font-semibold text-slate-200">{t('motorDlg.title')}</h2>
          <button onClick={onClose} aria-label={t('banner.close')} className="rounded-md bg-slate-800 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700">✕</button>
        </div>

        <div className="space-y-2 p-3">
          <div className="flex gap-2">
            <input
              value={text} onChange={(e) => setText(e.target.value)} autoFocus
              placeholder={t('motorDlg.searchCode')}
              className="min-w-0 flex-1 rounded-lg bg-slate-950 px-3 py-2 text-sm text-slate-100 ring-1 ring-white/10 placeholder:text-slate-500 focus:outline-none focus:ring-sky-500"
            />
            <button onClick={() => fileRef.current?.click()} className="shrink-0 rounded-lg bg-slate-800 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-700">
              {t('motor.importEng')}
            </button>
            <input ref={fileRef} type="file" accept=".eng,.ENG" className="hidden" onChange={onImport} />
          </div>

          <div className="flex gap-2">
            <select
              value={mfr} onChange={(e) => setMfr(e.target.value)}
              className="min-w-0 flex-1 rounded-lg bg-slate-950 px-2 py-2 text-sm text-slate-100 ring-1 ring-white/10 focus:outline-none focus:ring-sky-500"
            >
              <option value="">{t('motorDlg.allManufacturers')}</option>
              {manufacturers.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <label className="flex shrink-0 items-center gap-2 text-sm text-slate-300">
              <span className="text-slate-500">{t('motor.ejectionDelay')}</span>
              <input
                type="number" min={0} max={20} step={0.5} value={delay}
                onChange={(e) => setDelay(Math.max(0, parseFloat(e.target.value) || 0))}
                className="w-16 rounded bg-slate-950 px-2 py-1 text-right tabular-nums ring-1 ring-white/10"
              />
            </label>
          </div>

          <div className="flex flex-wrap gap-1">
            <Chip label={t('motor.all')} active={cls === null} onClick={() => setCls(null)} />
            {classes.map((c) => <Chip key={c} label={c} active={cls === c} onClick={() => setCls(cls === c ? null : c)} />)}
          </div>
        </div>

        <ul className="min-h-0 flex-1 divide-y divide-white/5 overflow-y-auto">
          {shown.map((m, i) => {
            const rowId = `${m.manufacturer}:${m.designation}:${i}`;
            const loading = loadingId === rowId;
            return (
              <li key={rowId} className="flex items-stretch">
                <button
                  onClick={() => pick(m, rowId)} disabled={loadingId !== null}
                  className="flex min-w-0 flex-1 items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-slate-800 disabled:opacity-50"
                >
                  <span className="min-w-0">
                    {m.custom && <span className="mr-1 text-amber-400" title={t('motor.importedTitle')}>★</span>}
                    <span className="font-medium text-slate-100">{m.designation}</span>
                    <span className="ml-2 text-xs text-slate-500">{m.manufacturer}</span>
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-slate-400">
                    {loading ? t('sim.running') : `${fmtNum(m.impulse, m.impulse < 10 ? 1 : 0)} Ns · ${m.diameter} mm`}
                  </span>
                </button>
                {m.custom && (
                  <button onClick={() => onDelete(m)} aria-label={t('motor.deleteTitle', { name: m.designation })} className="shrink-0 px-3 text-red-400 hover:bg-slate-800">✕</button>
                )}
              </li>
            );
          })}
        </ul>

        <div className="border-t border-white/10 p-2 text-center text-[11px] uppercase tracking-wide text-slate-500">
          {t('motor.count', { total: matches.length })}{matches.length > shown.length ? t('motor.showing', { shown: shown.length }) : ''}
        </div>
      </div>
    </div>
  );
}

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`rounded-full px-2.5 py-1 text-xs font-medium ${active ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-300'}`}>
      {label}
    </button>
  );
}
