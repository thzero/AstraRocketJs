import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../../i18n';
import { useWorkspaceStore } from '../../state/store';
import { useSettings } from '../../state/SettingsProvider';
import { useUnits } from '../../prefs/useUnits';
import { resolveUnitChoice, UNIT_CHOICES, type UnitChoice } from '../../prefs/units';
import { Dialog } from '../common/Dialog';
import { DEFAULT_REPORT } from '../../services/storage/settings';
import { assembleReport, type ReportBuild, type ReportModel } from '../../services/report/reportModel';
import { isPlanarFinSet } from '../../tree/tubefins';
import { markingGuides } from '../../services/report/markingGuide';
import type { ComponentNode } from '../../engine/openRocketEngine';
import { stageLabel } from '../../i18n/format';
import { errorText } from '../../i18n/keyedError';
import { Check } from '../common/Check';
import { ColorInput } from '../common/ColorInput';
import { DialogButton } from '../common/DialogButton';

interface StageSel {
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

/**
 * The "Print or export" dialog: pick what to include, tweak output settings,
 * Save as PDF.
 *
 * Mounted only while open (`{open && <ExportDialog />}`). The report model is
 * assembled once and the include/exclude selection is derived from it in the
 * same pass; both then hold still for the dialog's life, so a re-render (the
 * print-settings popover opening or closing) never resets what was picked.
 *
 * Assembling a report builds rockets of its own (each stage of a multi-stage
 * design, each motor configuration other than the one flown), which resets the
 * shared engine, so the whole rocket is rebuilt afterward. Installing that
 * rebuild is a store write, and this dialog cannot make it from the initializer
 * without updating every other store subscriber mid-render, so it takes the
 * build back from `assembleReport` and installs it in a layout effect instead.
 */
export function ExportDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const { settings, update } = useSettings();
  const units = useUnits();
  // The print-settings popover: a second Dialog on its own layer, with its own focus trap.
  const [showSettings, setShowSettings] = useState(false);
  const [busy, setBusy] = useState(false);
  // One resolution for both outputs: the PDF and the CSV must never disagree
  // about what the document is written in.
  const exportUnits = resolveUnitChoice(settings.report.units, units.all);
  const tree = useWorkspaceStore((s) => s.tree);
  const runSim = useWorkspaceStore((s) => s.runSim);

  // Set once the dialog is dismissed. A save in flight checks it after every
  // await and writes nothing once it is set; closing also stops the run it is
  // waiting on, so the dialog going away is the end of the export.
  const canceled = useRef(false);
  const running = useRef(false);
  useEffect(() => {
    canceled.current = false;
    return () => {
      canceled.current = true;
    };
  }, []);
  const close = () => {
    canceled.current = true;
    if (running.current) useWorkspaceStore.getState().cancelRun();
    onClose();
  };

  const hasNoses = useMemo(() => hasType(tree.components, (ty) => ty === 'nosecone'), [tree]);
  const hasTransitions = useMemo(() => hasType(tree.components, (ty) => ty === 'transition'), [tree]);
  // The real rule, not a re-derived one: a marking guide needs a body tube
  // carrying at least one fin set, which is exactly what markingGuides finds.
  // Asking it means the checkbox cannot offer a guide the report would not draw.
  const hasMarkingGuides = useMemo(() => markingGuides(tree).guides.length > 0, [tree]);

  // The report's own builds run the real engine; a design it fails on must
  // leave the dialog standing with its "no design" message, not take the app
  // down. The failure is remembered here and reported below, so the initializer
  // stays a pure computation.
  //
  // `rebuilt` is the whole-rocket build the report's own builds leave behind,
  // for the layout effect below to install (see the component's doc comment).
  const [initial] = useState<{ model: ReportModel | null; error: string | null; rebuilt: ReportBuild | null }>(() => {
    const { info, rocket } = useWorkspaceStore.getState();
    if (!info || !rocket) return { model: null, error: null, rebuilt: null };
    let rebuilt: ReportBuild | null = null;
    try {
      return { model: assembleReport((built) => (rebuilt = built)), error: null, rebuilt };
    } catch (e) {
      return { model: null, error: errorText(e, t), rebuilt };
    }
  });
  const model = initial.model;

  // Before the browser paints, so the window is never shown against an engine
  // left on the last stage that was built. The engine itself is already whole
  // by here; this is only the store catching up to the new handle.
  useLayoutEffect(() => {
    if (initial.rebuilt) useWorkspaceStore.getState().applyBuild(initial.rebuilt.info, initial.rebuilt.handle);
  }, [initial.rebuilt]);
  useEffect(() => {
    if (!initial.error) return;
    // `i18n.t`, not the hook's `t`: this must not depend on a value that
    // changes identity on every language switch.
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
            parts: true,
            finTemplates: true,
            // isPlanarFinSet: this gates the fin templates checkbox, and tube
            // fins produce no template, so a stage finned only with tubes must
            // not offer one.
            hasFins: hasType(st.children ?? [], isPlanarFinSet),
            label: stageLabel(t, i, st.name),
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
            stages: s.stages.map((st) => ({ ...st, parts: on, finTemplates: on && st.hasFins })),
          }
        : s,
    );

  const save = async () => {
    if (!sel || !model) return;
    setBusy(true);
    try {
      if (sel.updateSimData) {
        // runSim flips the view to Flight and the tab to Results on completion;
        // the report is a background refresh, so put both back where the user
        // had them, with the design pane the view switch would otherwise move.
        const { view: prevView, tab: prevTab, designPane: prevPane } = useWorkspaceStore.getState();
        try {
          // The run resolves rather than rejects on a failure, a refusal, a
          // timeout or a cancel, and leaves the previous numbers in place. Only a
          // landed run means the report has fresh data; anything else writes
          // nothing. A failure, a refusal and a busy pool say why in the error
          // banner and a cancel is the user's own doing, but a flight dropped
          // because the design changed under it says nothing, so it is said here.
          running.current = true;
          const outcome = await runSim();
          if (outcome === 'dropped') useWorkspaceStore.getState().setErr(t('export.simDropped'));
          if (outcome !== 'landed') return;
        } catch (e) {
          // Reported, not swallowed: swallowing writes the PDF with the
          // previous run's numbers, unmarked. The user asked for fresh data, so
          // say why there is none and write nothing.
          useWorkspaceStore.getState().setErr(t('export.simFailed', { message: errorText(e, t) }));
          return;
        } finally {
          running.current = false;
          useWorkspaceStore.setState({ view: prevView, tab: prevTab, designPane: prevPane });
        }
      }
      if (canceled.current) return;
      const fresh = assembleReport() ?? model;
      // jsPDF is loaded here rather than first inside the writer, so the last
      // check below comes after every wait: from there to the download is
      // synchronous work that a close cannot interleave with.
      const [{ downloadReportPdf }] = await Promise.all([import('../../services/report/reportPdf'), import('jspdf')]);
      if (canceled.current) return;
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
          stages: sel.stages.map((st) => ({ parts: st.parts, finTemplates: st.finTemplates })),
          paper: settings.report.paper,
          orientation: settings.report.orientation,
          templateFill: settings.report.templateFill,
          templateStroke: settings.report.templateStroke,
        },
        exportUnits,
        // The font fetch is a wait of its own; a close during it saves nothing.
        { canceled: () => canceled.current },
      );
      onClose();
    } catch (e) {
      if (canceled.current) return;
      useWorkspaceStore.getState().setErr(t('export.pdfFailed', { message: errorText(e, t) }));
    } finally {
      setBusy(false);
    }
  };

  // One row per part, in the export's units (services/report/reportCsv).
  const savePartsCsv = async () => {
    if (!model) return;
    try {
      const { downloadComponentCsv } = await import('../../services/report/reportCsv');
      downloadComponentCsv(assembleReport() ?? model, exportUnits, (type) => t(`part.${type}`));
      onClose();
    } catch (e) {
      useWorkspaceStore.getState().setErr(t('export.csvFailed', { message: errorText(e, t) }));
    }
  };

  const saveCsv = async () => {
    if (!model) return;
    try {
      const { downloadDesignCsv } = await import('../../services/report/reportCsv');
      downloadDesignCsv(assembleReport() ?? model, exportUnits);
      onClose();
    } catch (e) {
      useWorkspaceStore.getState().setErr(t('export.csvFailed', { message: errorText(e, t) }));
    }
  };

  // The pinned row of actions, declared here because it is the shell's `footer`
  // and so has to be named before the body it is passed with.
  const actionRow = (
    <div className="flex items-center justify-between gap-2 border-t border-line/10 p-4">
      <button
        onClick={() => setShowSettings(true)}
        className="rounded-md bg-raised px-3 py-2 text-sm text-ink ring-1 ring-line/10 hover:bg-elevated"
      >
        {t('export.settings')}
      </button>
      <div className="flex gap-2">
        <button
          onClick={close}
          className="rounded-md bg-raised px-3 py-2 text-sm text-ink-soft ring-1 ring-line/10 hover:bg-elevated"
        >
          {t('common.cancel')}
        </button>
        <button
          onClick={saveCsv}
          disabled={busy}
          className="rounded-md bg-raised px-3 py-2 text-sm text-ink ring-1 ring-line/10 hover:bg-elevated disabled:opacity-50"
        >
          {t('export.saveCsv')}
        </button>
        <button
          onClick={savePartsCsv}
          disabled={busy}
          className="rounded-md bg-raised px-3 py-2 text-sm text-ink ring-1 ring-line/10 hover:bg-elevated disabled:opacity-50"
        >
          {t('export.savePartsCsv')}
        </button>
        <DialogButton onClick={save} disabled={busy} variant="primary">
          {busy ? t('common.loading') : t('export.savePdf')}
        </DialogButton>
      </div>
    </div>
  );

  const check = 'accent-accent-500';
  const fillId = useId();
  const row = 'flex items-center gap-2 py-0.5 text-sm text-ink';

  return (
    <>
      <Dialog
        id="reportExport"
        title={t('export.title')}
        onClose={close}
        size="md"
        // The overlay and Escape do not dismiss this while the PDF is being
        // written, so a stray click cannot end the export. Cancel and the ✕
        // still work, and they stop it: the run is canceled and nothing is
        // downloaded.
        dismissible={!busy}
        footer={sel && model ? actionRow : undefined}
      >
        {sel && model ? (
          <div className="p-4">
            <p className="mb-2 text-xs uppercase tracking-wide text-ink-muted">{t('export.select')}</p>
            <div className="rounded-lg bg-raised/50 p-2 ring-1 ring-line/5">
              <Check
                className={`${row} font-semibold text-accent-300`}
                checked={allOn}
                onChange={setAll}
                label={model.name}
              />
              {sel.stages.map((st, i) => (
                <div key={i} className="pl-4">
                  <div className={`${row} text-ink-soft`}>{st.label}</div>
                  <Check
                    className={`${row} pl-4`}
                    checked={st.parts}
                    onChange={(v) => patchStage(i, { parts: v })}
                    label={t('report.partsDetail')}
                  />
                  {st.hasFins && (
                    <Check
                      className={`${row} pl-4`}
                      checked={st.finTemplates}
                      onChange={(v) => patchStage(i, { finTemplates: v })}
                      label={t('export.finTemplates')}
                    />
                  )}
                </div>
              ))}
              <Check
                className={`${row} pl-4`}
                checked={sel.designReport}
                onChange={(v) => patch({ designReport: v })}
                label={t('export.designReport')}
              />
              <Check
                className={`${row} pl-4`}
                disabled={!hasNoses}
                checked={sel.noseTemplates}
                onChange={(v) => patch({ noseTemplates: v })}
                label={t('export.noseTemplates')}
              />
              <Check
                className={`${row} pl-4`}
                disabled={!hasTransitions}
                checked={sel.transitionTemplates}
                onChange={(v) => patch({ transitionTemplates: v })}
                label={t('export.transitionTemplates')}
              />
              <Check
                className={`${row} pl-4`}
                disabled={!hasMarkingGuides}
                checked={sel.finMarkingGuide}
                onChange={(v) => patch({ finMarkingGuide: v })}
                label={t('export.finMarkingGuide')}
              />
            </div>

            <div className="mt-3 space-y-1">
              <Check
                className={row}
                checked={sel.includeMotors}
                onChange={(v) => patch({ includeMotors: v })}
                label={t('export.includeMotors')}
              />
              <Check
                className={row}
                checked={sel.updateSimData}
                onChange={(v) => patch({ updateSimData: v })}
                label={t('export.updateSim')}
              />
              <Check
                className={row}
                checked={sel.showByStage}
                onChange={(v) => patch({ showByStage: v })}
                label={t('export.showByStage')}
              />
              <label className="flex items-center justify-between gap-3 pt-1 text-sm text-ink">
                <span>{t('export.units')}</span>
                <select
                  aria-label={t('export.units')}
                  value={settings.report.units}
                  onChange={(e) => update({ report: { ...settings.report, units: e.target.value as UnitChoice } })}
                  className="rounded-md bg-raised px-2 py-1 text-sm text-ink-strong ring-1 ring-line/10 focus:outline-none focus:ring-accent-500"
                >
                  {UNIT_CHOICES.map((c) => (
                    <option key={c} value={c}>
                      {t(`export.units_${c}`)}
                    </option>
                  ))}
                </select>
              </label>
              <p className="text-[11px] leading-snug text-ink-faint">{t('export.unitsNote')}</p>
            </div>
          </div>
        ) : (
          <p className="p-6 text-sm text-ink-faint">{t('report.noDesign')}</p>
        )}
      </Dialog>

      {/* Its own surface on its own layer, outside the dialog rather than a
          sibling of its panel inside the shared overlay: a trap anchored on the
          dialog's panel cannot reach controls outside it, so the fill color,
          paper size and orientation would be unreachable by keyboard. Two
          dialogs, each with its own trap. */}
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
              {/* A row, not one big <label>: the color is a second control, and a
                  label may only bind to one. */}
              <div className="flex items-center justify-between gap-3 text-sm text-ink-soft">
                <label htmlFor={fillId}>{t('export.fill')}</label>
                <span className="flex items-center gap-2">
                  <input
                    id={fillId}
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
                  <ColorInput
                    disabled={!settings.report.templateFill}
                    value={settings.report.templateFill || '#e5e7eb'}
                    onCommit={(c) => update({ report: { ...settings.report, templateFill: c } })}
                    ariaLabel={t('export.fillColor')}
                    className="h-7 w-10 cursor-pointer rounded-md border border-line/10 bg-raised p-0.5 disabled:opacity-40"
                  />
                </span>
              </div>
              <label className="flex items-center justify-between gap-3 text-sm text-ink-soft">
                {t('export.border')}
                <ColorInput
                  value={settings.report.templateStroke}
                  onCommit={(c) => update({ report: { ...settings.report, templateStroke: c } })}
                  className="h-7 w-10 cursor-pointer rounded-md border border-line/10 bg-raised p-0.5"
                />
              </label>
              <label className="flex items-center justify-between gap-3 text-sm text-ink-soft">
                {t('export.paper')}
                <select
                  value={settings.report.paper}
                  onChange={(e) => update({ report: { ...settings.report, paper: e.target.value as 'letter' | 'a4' } })}
                  className="rounded-md bg-raised px-2 py-1 text-sm text-ink-strong ring-1 ring-line/10"
                >
                  <option value="letter">{t('export.paperLetter')}</option>
                  <option value="a4">{t('export.paperA4')}</option>
                </select>
              </label>
              <label className="flex items-center justify-between gap-3 text-sm text-ink-soft">
                {t('export.orientation')}
                <select
                  value={settings.report.orientation}
                  onChange={(e) =>
                    update({ report: { ...settings.report, orientation: e.target.value as 'portrait' | 'landscape' } })
                  }
                  className="rounded-md bg-raised px-2 py-1 text-sm text-ink-strong ring-1 ring-line/10"
                >
                  <option value="portrait">{t('export.portrait')}</option>
                  <option value="landscape">{t('export.landscape')}</option>
                </select>
              </label>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                // Only what this popover shows. The report units are chosen in
                // the dialog behind it, and a reset of the colors must not move
                // them.
                onClick={() => update({ report: { ...DEFAULT_REPORT, units: settings.report.units } })}
                className="rounded-md bg-raised px-3 py-1.5 text-sm text-ink-soft ring-1 ring-line/10 hover:bg-elevated"
              >
                {t('export.reset')}
              </button>
              <button
                onClick={() => setShowSettings(false)}
                className="rounded-md bg-accent-600 px-4 py-1.5 text-sm font-medium text-on-accent hover:bg-accent-700"
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
