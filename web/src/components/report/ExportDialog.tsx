import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useWorkspaceStore } from '../../state/store';
import { useSettings } from '../../state/SettingsProvider';
import { DEFAULT_REPORT } from '../../services/settings';
import { assembleReport, type ReportModel } from '../../services/reportModel';
import type { ComponentNode } from '../../engine/openRocketEngine';

interface StageSel {
  include: boolean;
  parts: boolean;
  finTemplates: boolean;
  hasFins: boolean;
  label: string;
}
interface Sel {
  designReport: boolean;
  includeMotors: boolean;
  updateSimData: boolean;
  showByStage: boolean;
  noseTemplates: boolean;
  transitionTemplates: boolean;
  stages: StageSel[];
}

const hasType = (nodes: ComponentNode[], pred: (t: string) => boolean): boolean => {
  for (const n of nodes) {
    if (pred(n.type)) return true;
    if (n.children && hasType(n.children, pred)) return true;
  }
  return false;
};

/** The "Print or export" dialog: pick what to include, tweak output settings, Save as PDF. */
export function ExportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const { settings, update } = useSettings();
  const tree = useWorkspaceStore((s) => s.tree);
  const info = useWorkspaceStore((s) => s.info);
  const rocket = useWorkspaceStore((s) => s.rocket);
  const runSim = useWorkspaceStore((s) => s.runSim);
  const [model, setModel] = useState<ReportModel | null>(null);
  const [sel, setSel] = useState<Sel | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [busy, setBusy] = useState(false);

  const hasNoses = useMemo(() => hasType(tree.components, (ty) => ty === 'nosecone'), [tree]);
  const hasTransitions = useMemo(() => hasType(tree.components, (ty) => ty === 'transition'), [tree]);

  useEffect(() => {
    if (!open) {
      setModel(null);
      setSel(null);
      return;
    }
    // Wait until the live design is ready, then assemble once (keep the user's
    // selections stable for the rest of the dialog's life).
    if (model || !info || !rocket) return;
    const m = assembleReport();
    setModel(m);
    if (m) {
      setSel({
        designReport: true,
        includeMotors: true,
        updateSimData: true,
        showByStage: m.stages.length > 1,
        noseTemplates: hasNoses,
        transitionTemplates: hasTransitions,
        stages: m.stages.map((st, i) => ({
          include: true,
          parts: true,
          finTemplates: true,
          hasFins: hasType(st.children ?? [], (ty) => ty.endsWith('finset')),
          label: (st.name as string) || m.partsByStage[i]?.stage || `Stage ${i + 1}`,
        })),
      });
    }
  }, [open, model, info, rocket, hasNoses, hasTransitions]);

  if (!open) return null;

  const patch = (p: Partial<Sel>) => setSel((s) => (s ? { ...s, ...p } : s));
  const patchStage = (i: number, p: Partial<StageSel>) =>
    setSel((s) => (s ? { ...s, stages: s.stages.map((st, j) => (j === i ? { ...st, ...p } : st)) } : s));

  const allOn = !!sel && sel.designReport && sel.includeMotors && sel.noseTemplates === hasNoses && sel.transitionTemplates === hasTransitions && sel.stages.every((st) => st.parts && (!st.hasFins || st.finTemplates));
  const setAll = (on: boolean) =>
    setSel((s) =>
      s
        ? {
            ...s,
            designReport: on,
            includeMotors: on,
            noseTemplates: on && hasNoses,
            transitionTemplates: on && hasTransitions,
            stages: s.stages.map((st) => ({ ...st, include: on, parts: on, finTemplates: on && st.hasFins })),
          }
        : s,
    );

  const save = async () => {
    if (!sel || !model) return;
    setBusy(true);
    try {
      if (sel.updateSimData) {
        // runSim flips the view to Flight on completion; the report is a
        // background refresh, so put the view back where the user had it.
        const prevView = useWorkspaceStore.getState().view;
        await runSim(settings.simulation).catch(() => {});
        useWorkspaceStore.getState().setView(prevView);
      }
      const fresh = assembleReport() ?? model;
      const { downloadReportPdf } = await import('../../services/reportPdf');
      await downloadReportPdf(fresh, tree, t, {
        designReport: sel.designReport,
        includeMotors: sel.includeMotors,
        showByStage: sel.showByStage,
        noseTemplates: sel.noseTemplates,
        transitionTemplates: sel.transitionTemplates,
        stages: sel.stages.map((st) => ({ include: st.include, parts: st.parts, finTemplates: st.finTemplates })),
        paper: settings.report.paper,
        orientation: settings.report.orientation,
        templateFill: settings.report.templateFill,
        templateStroke: settings.report.templateStroke,
      });
      onClose();
    } catch (e) {
      useWorkspaceStore.getState().setErr(`Could not export PDF: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const saveCsv = async () => {
    if (!model) return;
    try {
      const { downloadDesignCsv } = await import('../../services/reportCsv');
      downloadDesignCsv(assembleReport() ?? model);
      onClose();
    } catch (e) {
      useWorkspaceStore.getState().setErr(`Could not export CSV: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const check = 'accent-sky-500';
  const row = 'flex items-center gap-2 py-0.5 text-sm text-slate-200';

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-md flex-col rounded-2xl bg-slate-900 ring-1 ring-white/10"
        role="dialog"
        aria-modal="true"
        aria-label={t('export.title')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-white/10 p-4">
          <h2 className="text-lg font-semibold text-slate-100">{t('export.title')}</h2>
          <button onClick={onClose} className="rounded-md px-2 text-slate-400 hover:text-slate-200">✕</button>
        </div>

        {sel && model ? (
          <>
            <div className="min-h-0 flex-1 overflow-auto p-4">
              <p className="mb-2 text-xs uppercase tracking-wide text-slate-400">{t('export.select')}</p>
              <div className="rounded-lg bg-slate-800/50 p-2 ring-1 ring-white/5">
                <label className={`${row} font-semibold text-sky-300`}>
                  <input type="checkbox" className={check} checked={allOn} onChange={(e) => setAll(e.target.checked)} />
                  {model.name}
                </label>
                {sel.stages.map((st, i) => (
                  <div key={i} className="pl-4">
                    <div className={`${row} text-slate-300`}>{st.label}</div>
                    <label className={`${row} pl-4`}>
                      <input type="checkbox" className={check} checked={st.parts} onChange={(e) => patchStage(i, { parts: e.target.checked })} />
                      {t('report.partsDetail')}
                    </label>
                    {st.hasFins && (
                      <label className={`${row} pl-4`}>
                        <input type="checkbox" className={check} checked={st.finTemplates} onChange={(e) => patchStage(i, { finTemplates: e.target.checked })} />
                        {t('export.finTemplates')}
                      </label>
                    )}
                  </div>
                ))}
                <label className={`${row} pl-4`}>
                  <input type="checkbox" className={check} checked={sel.designReport} onChange={(e) => patch({ designReport: e.target.checked })} />
                  {t('export.designReport')}
                </label>
                <label className={`${row} pl-4 ${hasNoses ? '' : 'opacity-40'}`}>
                  <input type="checkbox" className={check} disabled={!hasNoses} checked={sel.noseTemplates} onChange={(e) => patch({ noseTemplates: e.target.checked })} />
                  {t('export.noseTemplates')}
                </label>
                <label className={`${row} pl-4 ${hasTransitions ? '' : 'opacity-40'}`}>
                  <input type="checkbox" className={check} disabled={!hasTransitions} checked={sel.transitionTemplates} onChange={(e) => patch({ transitionTemplates: e.target.checked })} />
                  {t('export.transitionTemplates')}
                </label>
              </div>

              <div className="mt-3 space-y-1">
                <label className={row}>
                  <input type="checkbox" className={check} checked={sel.includeMotors} onChange={(e) => patch({ includeMotors: e.target.checked })} />
                  {t('export.includeMotors')}
                </label>
                <label className={row}>
                  <input type="checkbox" className={check} checked={sel.updateSimData} onChange={(e) => patch({ updateSimData: e.target.checked })} />
                  {t('export.updateSim')}
                </label>
                <label className={row}>
                  <input type="checkbox" className={check} checked={sel.showByStage} onChange={(e) => patch({ showByStage: e.target.checked })} />
                  {t('export.showByStage')}
                </label>
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-white/10 p-4">
              <button onClick={() => setShowSettings(true)} className="rounded-md bg-slate-800 px-3 py-2 text-sm text-slate-200 ring-1 ring-white/10 hover:bg-slate-700">
                {t('export.settings')}
              </button>
              <div className="flex gap-2">
                <button onClick={onClose} className="rounded-md bg-slate-800 px-3 py-2 text-sm text-slate-300 ring-1 ring-white/10 hover:bg-slate-700">
                  {t('common.cancel')}
                </button>
                <button onClick={saveCsv} disabled={busy} className="rounded-md bg-slate-800 px-3 py-2 text-sm text-slate-200 ring-1 ring-white/10 hover:bg-slate-700 disabled:opacity-50">
                  {t('export.saveCsv')}
                </button>
                <button onClick={save} disabled={busy} className="rounded-md bg-sky-500 px-4 py-2 text-sm font-medium text-white hover:bg-sky-400 disabled:opacity-50">
                  {busy ? t('common.loading') : t('export.savePdf')}
                </button>
              </div>
            </div>
          </>
        ) : (
          <p className="p-6 text-sm text-slate-500">{t('report.noDesign')}</p>
        )}
      </div>

      {showSettings && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-black/50 p-4" onClick={() => setShowSettings(false)}>
          <div className="w-full max-w-xs rounded-2xl bg-slate-900 p-4 ring-1 ring-white/10" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-3 text-base font-semibold text-slate-100">{t('export.printSettings')}</h3>
            <div className="space-y-3">
              <label className="flex items-center justify-between gap-3 text-sm text-slate-300">
                {t('export.fill')}
                <span className="flex items-center gap-2">
                  <input type="checkbox" className={check} checked={!!settings.report.templateFill} onChange={(e) => update({ report: { ...settings.report, templateFill: e.target.checked ? settings.report.templateFill || '#e5e7eb' : '' } })} />
                  <input type="color" disabled={!settings.report.templateFill} value={settings.report.templateFill || '#e5e7eb'} onChange={(e) => update({ report: { ...settings.report, templateFill: e.target.value } })} className="h-7 w-10 cursor-pointer rounded-md border border-white/10 bg-slate-800 p-0.5 disabled:opacity-40" />
                </span>
              </label>
              <label className="flex items-center justify-between gap-3 text-sm text-slate-300">
                {t('export.border')}
                <input type="color" value={settings.report.templateStroke} onChange={(e) => update({ report: { ...settings.report, templateStroke: e.target.value } })} className="h-7 w-10 cursor-pointer rounded-md border border-white/10 bg-slate-800 p-0.5" />
              </label>
              <label className="flex items-center justify-between gap-3 text-sm text-slate-300">
                {t('export.paper')}
                <select value={settings.report.paper} onChange={(e) => update({ report: { ...settings.report, paper: e.target.value as 'letter' | 'a4' } })} className="rounded-md bg-slate-800 px-2 py-1 text-sm text-slate-100 ring-1 ring-white/10">
                  <option value="letter">Letter</option>
                  <option value="a4">A4</option>
                </select>
              </label>
              <label className="flex items-center justify-between gap-3 text-sm text-slate-300">
                {t('export.orientation')}
                <select value={settings.report.orientation} onChange={(e) => update({ report: { ...settings.report, orientation: e.target.value as 'portrait' | 'landscape' } })} className="rounded-md bg-slate-800 px-2 py-1 text-sm text-slate-100 ring-1 ring-white/10">
                  <option value="portrait">{t('export.portrait')}</option>
                  <option value="landscape">{t('export.landscape')}</option>
                </select>
              </label>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => update({ report: DEFAULT_REPORT })} className="rounded-md bg-slate-800 px-3 py-1.5 text-sm text-slate-300 ring-1 ring-white/10 hover:bg-slate-700">{t('export.reset')}</button>
              <button onClick={() => setShowSettings(false)} className="rounded-md bg-sky-500 px-4 py-1.5 text-sm font-medium text-white hover:bg-sky-400">{t('common.close')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
