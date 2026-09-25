import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../../i18n';
import { useWorkspaceStore } from '../../state/store';
import { useSettings } from '../../state/SettingsProvider';
import { useUnits } from '../../prefs/useUnits';
import { resolveUnitChoice, UNIT_CHOICES, type UnitChoice } from '../../prefs/units';
import { Dialog } from '../common/Dialog';
import { DEFAULT_REPORT } from '../../services/settings';
import { assembleReport, type ReportModel } from '../../services/reportModel';
import { isPlanarFinSet } from '../../tree/tubefins';
import { markingGuides } from '../../services/report/markingGuide';
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
  finMarkingGuide: boolean;
  stages: StageSel[];
}

const hasType = (nodes: ComponentNode[], pred: (t: string) => boolean): boolean => {
  for (const n of nodes) {
    if (pred(n.type)) return true;
    if (n.children && hasType(n.children, pred)) return true;
  }
  return false;
};

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * The "Print or export" dialog: pick what to include, tweak output settings,
 * Save as PDF.
 *
 * Mounted only while open (`{open && <ExportDialog />}`). The report model is
 * assembled ONCE, in a state initializer, and the include/exclude selection is
 * derived from it there too; both then hold still for the dialog's life. This
 * used to be an effect behind a ref latch that reset whenever `open` went
 * false, which is how dismissing the print-settings popover used to throw the
 * selection away.
 */
export function ExportDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const { settings, update } = useSettings();
  const units = useUnits();
  // Declared up here because the focus traps below branch on it: the popover
  // is a separate keyboard surface, not decoration.
  const [showSettings, setShowSettings] = useState(false);
  const [busy, setBusy] = useState(false);
  // One resolution for both outputs: the PDF and the CSV must never disagree
  // about what the document is written in.
  const exportUnits = resolveUnitChoice(settings.report.units, units.all);
  const tree = useWorkspaceStore((s) => s.tree);
  const runSim = useWorkspaceStore((s) => s.runSim);

  const hasNoses = useMemo(() => hasType(tree.components, (ty) => ty === 'nosecone'), [tree]);
  const hasTransitions = useMemo(() => hasType(tree.components, (ty) => ty === 'transition'), [tree]);
  // The real rule, not a re-derived one: a marking guide needs a BODY TUBE
  // carrying at least one fin set, which is exactly what markingGuides finds.
  // Asking it means the checkbox cannot offer a guide the report would not draw.
  const hasMarkingGuides = useMemo(() => markingGuides(tree).guides.length > 0, [tree]);

  // Per-stage builds run the real engine; a design it chokes on must leave the
  // dialog standing with its "no design" message, not take the app down. The
  // failure is remembered here and reported below, so the initializer stays a
  // pure computation.
  const [initial] = useState<{ model: ReportModel | null; error: string | null }>(() => {
    const { info, rocket } = useWorkspaceStore.getState();
    if (!info || !rocket) return { model: null, error: null };
    try {
      return { model: assembleReport(), error: null };
    } catch (e) {
      return { model: null, error: errorText(e) };
    }
  });
  const model = initial.model;
  useEffect(() => {
    if (!initial.error) return;
    // `i18n.t`, not the hook's `t`: this must not depend on a value that
    // changes identity on every language switch. Same reason store.ts uses
    // the singleton.
    useWorkspaceStore.getState().setErr(i18n.t('export.reportFailed', { message: initial.error }));
  }, [initial.error]);

  const [sel, setSel] = useState<Sel | null>(() =>
    model
      ? {
          designReport: true,
          includeMotors: true,
          updateSimData: true,
          showByStage: model.stages.length > 1,
          noseTemplates: hasNoses,
          transitionTemplates: hasTransitions,
          finMarkingGuide: hasMarkingGuides,
          stages: model.stages.map((st, i) => ({
            include: true,
            parts: true,
            finTemplates: true,
            // isPlanarFinSet: this gates the FIN TEMPLATES checkbox, and tube
            // fins produce no template, so a stage finned only with tubes must
            // not offer one.
            hasFins: hasType(st.children ?? [], isPlanarFinSet),
            label: (st.name as string) || model.partsByStage[i]?.stage || `Stage ${i + 1}`,
          })),
        }
      : null,
  );

  const patch = (p: Partial<Sel>) => setSel((s) => (s ? { ...s, ...p } : s));
  const patchStage = (i: number, p: Partial<StageSel>) =>
    setSel((s) => (s ? { ...s, stages: s.stages.map((st, j) => (j === i ? { ...st, ...p } : st)) } : s));

  const allOn =
    !!sel &&
    sel.designReport &&
    sel.includeMotors &&
    sel.noseTemplates === hasNoses &&
    sel.transitionTemplates === hasTransitions &&
    sel.finMarkingGuide === hasMarkingGuides &&
    sel.stages.every((st) => st.parts && (!st.hasFins || st.finTemplates));
  const setAll = (on: boolean) =>
    setSel((s) =>
      s
        ? {
            ...s,
            designReport: on,
            includeMotors: on,
            noseTemplates: on && hasNoses,
            transitionTemplates: on && hasTransitions,
            finMarkingGuide: on && hasMarkingGuides,
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
        try {
          await runSim(settings.simulation);
        } catch (e) {
          // The rejection used to be swallowed and the PDF written with the
          // PREVIOUS run's numbers, unmarked. The user asked for fresh data;
          // say why there is none and write nothing.
          useWorkspaceStore.getState().setErr(t('export.simFailed', { message: errorText(e) }));
          return;
        } finally {
          useWorkspaceStore.getState().setView(prevView);
        }
      }
      const fresh = assembleReport() ?? model;
      const { downloadReportPdf } = await import('../../services/reportPdf');
      await downloadReportPdf(
        fresh,
        tree,
        t,
        {
          designReport: sel.designReport,
          includeMotors: sel.includeMotors,
          showByStage: sel.showByStage,
          noseTemplates: sel.noseTemplates,
          transitionTemplates: sel.transitionTemplates,
          finMarkingGuide: sel.finMarkingGuide,
          stages: sel.stages.map((st) => ({ include: st.include, parts: st.parts, finTemplates: st.finTemplates })),
          paper: settings.report.paper,
          orientation: settings.report.orientation,
          templateFill: settings.report.templateFill,
          templateStroke: settings.report.templateStroke,
        },
        exportUnits,
      );
      onClose();
    } catch (e) {
      useWorkspaceStore.getState().setErr(t('export.pdfFailed', { message: errorText(e) }));
    } finally {
      setBusy(false);
    }
  };

  const saveCsv = async () => {
    if (!model) return;
    try {
      const { downloadDesignCsv } = await import('../../services/reportCsv');
      downloadDesignCsv(assembleReport() ?? model, exportUnits);
      onClose();
    } catch (e) {
      useWorkspaceStore.getState().setErr(t('export.csvFailed', { message: errorText(e) }));
    }
  };

  // The pinned row of actions, declared here because it is the shell's `footer`
  // and so has to be named before the body that used to follow it.
  const actionRow = (
    <div className="flex items-center justify-between gap-2 border-t border-white/10 p-4">
      <button
        onClick={() => setShowSettings(true)}
        className="rounded-md bg-slate-800 px-3 py-2 text-sm text-slate-200 ring-1 ring-white/10 hover:bg-slate-700"
      >
        {t('export.settings')}
      </button>
      <div className="flex gap-2">
        <button
          onClick={onClose}
          className="rounded-md bg-slate-800 px-3 py-2 text-sm text-slate-300 ring-1 ring-white/10 hover:bg-slate-700"
        >
          {t('common.cancel')}
        </button>
        <button
          onClick={saveCsv}
          disabled={busy}
          className="rounded-md bg-slate-800 px-3 py-2 text-sm text-slate-200 ring-1 ring-white/10 hover:bg-slate-700 disabled:opacity-50"
        >
          {t('export.saveCsv')}
        </button>
        <button
          onClick={save}
          disabled={busy}
          className="rounded-md bg-sky-500 px-4 py-2 text-sm font-medium text-white hover:bg-sky-400 disabled:opacity-50"
        >
          {busy ? t('common.loading') : t('export.savePdf')}
        </button>
      </div>
    </div>
  );

  const check = 'accent-sky-500';
  const row = 'flex items-center gap-2 py-0.5 text-sm text-slate-200';

  return (
    <>
      <Dialog
        id="reportExport"
        title={t('export.title')}
        onClose={onClose}
        size="md"
        // Nothing dismisses this while the PDF is being written: unmounting
        // mid-export drops the run's result and the "Loading" state with it. The
        // ✕ still works, because a close button that stops responding is worse
        // than an interrupted export.
        dismissible={!busy}
        footer={sel && model ? actionRow : undefined}
      >
        {sel && model ? (
          <div className="p-4">
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
                    <input
                      type="checkbox"
                      className={check}
                      checked={st.parts}
                      onChange={(e) => patchStage(i, { parts: e.target.checked })}
                    />
                    {t('report.partsDetail')}
                  </label>
                  {st.hasFins && (
                    <label className={`${row} pl-4`}>
                      <input
                        type="checkbox"
                        className={check}
                        checked={st.finTemplates}
                        onChange={(e) => patchStage(i, { finTemplates: e.target.checked })}
                      />
                      {t('export.finTemplates')}
                    </label>
                  )}
                </div>
              ))}
              <label className={`${row} pl-4`}>
                <input
                  type="checkbox"
                  className={check}
                  checked={sel.designReport}
                  onChange={(e) => patch({ designReport: e.target.checked })}
                />
                {t('export.designReport')}
              </label>
              <label className={`${row} pl-4 ${hasNoses ? '' : 'opacity-40'}`}>
                <input
                  type="checkbox"
                  className={check}
                  disabled={!hasNoses}
                  checked={sel.noseTemplates}
                  onChange={(e) => patch({ noseTemplates: e.target.checked })}
                />
                {t('export.noseTemplates')}
              </label>
              <label className={`${row} pl-4 ${hasTransitions ? '' : 'opacity-40'}`}>
                <input
                  type="checkbox"
                  className={check}
                  disabled={!hasTransitions}
                  checked={sel.transitionTemplates}
                  onChange={(e) => patch({ transitionTemplates: e.target.checked })}
                />
                {t('export.transitionTemplates')}
              </label>
              <label className={`${row} pl-4 ${hasMarkingGuides ? '' : 'opacity-40'}`}>
                <input
                  type="checkbox"
                  className={check}
                  disabled={!hasMarkingGuides}
                  checked={sel.finMarkingGuide}
                  onChange={(e) => patch({ finMarkingGuide: e.target.checked })}
                />
                {t('export.finMarkingGuide')}
              </label>
            </div>

            <div className="mt-3 space-y-1">
              <label className={row}>
                <input
                  type="checkbox"
                  className={check}
                  checked={sel.includeMotors}
                  onChange={(e) => patch({ includeMotors: e.target.checked })}
                />
                {t('export.includeMotors')}
              </label>
              <label className={row}>
                <input
                  type="checkbox"
                  className={check}
                  checked={sel.updateSimData}
                  onChange={(e) => patch({ updateSimData: e.target.checked })}
                />
                {t('export.updateSim')}
              </label>
              <label className={row}>
                <input
                  type="checkbox"
                  className={check}
                  checked={sel.showByStage}
                  onChange={(e) => patch({ showByStage: e.target.checked })}
                />
                {t('export.showByStage')}
              </label>
              <label className="flex items-center justify-between gap-3 pt-1 text-sm text-slate-200">
                <span>{t('export.units')}</span>
                <select
                  aria-label={t('export.units')}
                  value={settings.report.units}
                  onChange={(e) => update({ report: { ...settings.report, units: e.target.value as UnitChoice } })}
                  className="rounded-md bg-slate-800 px-2 py-1 text-sm text-slate-100 ring-1 ring-white/10 focus:outline-none focus:ring-sky-500"
                >
                  {UNIT_CHOICES.map((c) => (
                    <option key={c} value={c}>
                      {t(`export.units_${c}`)}
                    </option>
                  ))}
                </select>
              </label>
              <p className="text-[11px] leading-snug text-slate-500">{t('export.unitsNote')}</p>
            </div>
          </div>
        ) : (
          <p className="p-6 text-sm text-slate-500">{t('report.noDesign')}</p>
        )}
      </Dialog>

      {/* Its own surface on its own layer, outside the dialog rather than a
          sibling of its panel inside the shared overlay. That arrangement is
          what used to need two focus traps here, with this one switching the
          dialog's OFF: anchored on the panel, the trap could not reach controls
          that were not inside it, so the fill color, paper size and orientation
          were unreachable by keyboard. Two dialogs each own their own. */}
      {showSettings && (
        <Dialog
          id="reportPrintSettings"
          title={t('export.printSettings')}
          onClose={() => setShowSettings(false)}
          layer="over"
          size="sm"
          layout="pad"
          expandable={false}
          // Two or three lines and a button, opening on top of a report dialog
          // that is itself already full-screen on a phone: filling the screen
          // here would read as that dialog being replaced rather than as
          // something opening over it.
          fullBleed={false}
        >
          <>
            <div className="space-y-3">
              <label className="flex items-center justify-between gap-3 text-sm text-slate-300">
                {t('export.fill')}
                <span className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className={check}
                    checked={!!settings.report.templateFill}
                    onChange={(e) =>
                      update({
                        report: {
                          ...settings.report,
                          templateFill: e.target.checked ? settings.report.templateFill || '#e5e7eb' : '',
                        },
                      })
                    }
                  />
                  <input
                    type="color"
                    disabled={!settings.report.templateFill}
                    value={settings.report.templateFill || '#e5e7eb'}
                    onChange={(e) => update({ report: { ...settings.report, templateFill: e.target.value } })}
                    className="h-7 w-10 cursor-pointer rounded-md border border-white/10 bg-slate-800 p-0.5 disabled:opacity-40"
                  />
                </span>
              </label>
              <label className="flex items-center justify-between gap-3 text-sm text-slate-300">
                {t('export.border')}
                <input
                  type="color"
                  value={settings.report.templateStroke}
                  onChange={(e) => update({ report: { ...settings.report, templateStroke: e.target.value } })}
                  className="h-7 w-10 cursor-pointer rounded-md border border-white/10 bg-slate-800 p-0.5"
                />
              </label>
              <label className="flex items-center justify-between gap-3 text-sm text-slate-300">
                {t('export.paper')}
                <select
                  value={settings.report.paper}
                  onChange={(e) => update({ report: { ...settings.report, paper: e.target.value as 'letter' | 'a4' } })}
                  className="rounded-md bg-slate-800 px-2 py-1 text-sm text-slate-100 ring-1 ring-white/10"
                >
                  <option value="letter">Letter</option>
                  <option value="a4">A4</option>
                </select>
              </label>
              <label className="flex items-center justify-between gap-3 text-sm text-slate-300">
                {t('export.orientation')}
                <select
                  value={settings.report.orientation}
                  onChange={(e) =>
                    update({ report: { ...settings.report, orientation: e.target.value as 'portrait' | 'landscape' } })
                  }
                  className="rounded-md bg-slate-800 px-2 py-1 text-sm text-slate-100 ring-1 ring-white/10"
                >
                  <option value="portrait">{t('export.portrait')}</option>
                  <option value="landscape">{t('export.landscape')}</option>
                </select>
              </label>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => update({ report: DEFAULT_REPORT })}
                className="rounded-md bg-slate-800 px-3 py-1.5 text-sm text-slate-300 ring-1 ring-white/10 hover:bg-slate-700"
              >
                {t('export.reset')}
              </button>
              <button
                onClick={() => setShowSettings(false)}
                className="rounded-md bg-sky-500 px-4 py-1.5 text-sm font-medium text-white hover:bg-sky-400"
              >
                {t('common.close')}
              </button>
            </div>
          </>
        </Dialog>
      )}
    </>
  );
}
