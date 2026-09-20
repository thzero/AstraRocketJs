import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useWorkspaceStore, selectActive } from '../../state/store';
import { download as saveDownload, safeFilename } from '../../services/saveFile';
import { useUnits } from '../../prefs/useUnits';
import {
  buildFlightPathModel,
  asAltitudeReference,
  asDistanceUnit,
  asStageTrackStart,
  asWaypointKinds,
  defaultBranchColor,
  defaultGroundColor,
  defaultPinColor,
  defaultExportOptions,
  exportBranchNames,
  hasLaunchPosition,
  hexToRgbInt,
  rgbToHex,
  renderUserTemplate,
  mimeForExtension,
  EXPORT_FORMATS,
  WAYPOINT_KINDS,
  type FlightPathExportOptions,
  type WaypointKind,
  type AltitudeReference,
  type DistanceUnit,
  type StageTrackStart,
} from '../../services/flightPathExport';
import { getTemplateStore, parseTemplateFilename, type UserTemplate } from '../../services/templateStore';
import { useFocusTrap } from '../common/useFocusTrap';
import { decodeStageColors, encodeStageColors } from '../../services/settings';
import { useSettings } from '../../state/SettingsProvider';

/**
 * "Export flight path" — a port of OpenRocket's 3D-path export dialog. Renders a
 * button that opens a modal to pick the format (built-in KML / GPX / waypoint
 * CSV, or an imported Mustache template) and the options (which waypoints,
 * flight-path/ground-track lines, path stride, altitude/distance units), then
 * downloads the rendered file. Self-sources the active simulation's result,
 * launch site, and design metadata from the store.
 *
 * User templates are imported `.mustache` files persisted in the template store
 * — the browser equivalent of OpenRocket's desktop `ExportTemplates` folder.
 */

const WP_LABEL_KEY: Record<WaypointKind, string> = {
  pad: 'pathExport.wp.pad',
  liftoff: 'pathExport.wp.liftoff',
  burnout: 'pathExport.wp.burnout',
  apogee: 'pathExport.wp.apogee',
  recovery: 'pathExport.wp.recovery',
  landing: 'pathExport.wp.landing',
  maxvelocity: 'pathExport.wp.maxVelocity',
  maxacceleration: 'pathExport.wp.maxAcceleration',
};

const UNITS: DistanceUnit[] = ['m', 'ft', 'km', 'mi'];
const USER_PREFIX = 'user:';

export function FlightPathExport({ variant = 'chip' }: { variant?: 'chip' | 'overlay' }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const result = useWorkspaceStore((s) => selectActive(s).result);
  const launch = useWorkspaceStore((s) => selectActive(s).launch);
  const simName = useWorkspaceStore((s) => selectActive(s).name);
  const motor = useWorkspaceStore((s) => selectActive(s).motor);
  const tree = useWorkspaceStore((s) => s.tree);

  if (!result) return null;

  const btnClass =
    variant === 'overlay'
      ? 'rounded-md bg-slate-900/80 px-2 py-1 text-[11px] font-medium text-slate-200 ring-1 ring-white/10 hover:bg-slate-800'
      : 'rounded-md bg-slate-800 px-2 py-1 text-[11px] font-medium text-slate-200 ring-1 ring-white/10 hover:bg-slate-700';

  return (
    <>
      <button onClick={() => setOpen(true)} title={t('pathExport.open')} className={btnClass}>
        ⬇ {t('pathExport.short')}
      </button>
      {open && (
        <ExportDialog
          onClose={() => setOpen(false)}
          meta={{ simName, rocketName: tree.name ?? '', motorName: motor?.designation ?? '' }}
          launch={launch}
          result={result}
        />
      )}
    </>
  );
}

/**
 * Exported for `FlightPathExport.test.tsx`. The button that opens it lives only
 * in the 3D path view, which needs WebGL — headless Chromium crashes rendering
 * it, so the dialog's own behavior is covered as a component instead.
 */
export function ExportDialog({
  onClose,
  meta,
  launch,
  result,
}: {
  onClose: () => void;
  meta: { simName: string; rocketName: string; motorName: string };
  launch: import('../../services/orkTree').LaunchConditions;
  result: import('../../engine/openRocketEngine').FlightResult;
}) {
  const { t } = useTranslation();
  // Tab stays inside the modal, and focus returns to the trigger on close.
  // Seven dialogs declared aria-modal and had neither, so Tab walked straight
  // out into the page behind the overlay — the exact gap useFocusTrap exists
  // to close, already used by seven of their siblings.
  const panelRef = useFocusTrap<HTMLDivElement>(true);
  const store = useMemo(() => getTemplateStore(), []);
  const [selected, setSelected] = useState<string>(EXPORT_FORMATS[0]!.id);
  const units = useUnits();
  const { settings, update } = useSettings();
  // Carried in from last time, except the mission name - see
  // PathExportSettings for why that one still starts fresh every export.
  //
  // Each field falls back independently: a stored value that this build does
  // not recognize (an older store, a newer one, a hand edit) costs that field
  // and nothing else. The units are the interesting case - ABSENT means follow
  // the app's distance preference, which is what a fresh install does, while a
  // stored value is an explicit dialog choice and outranks it.
  const [opts, setOpts] = useState<FlightPathExportOptions>(() => {
    const base = defaultExportOptions(units.sym('distance'));
    const p = settings.pathExport;
    // A saved EMPTY selection is a selection (the user unchecked every marker),
    // not an absence; only a missing or unreadable list falls back.
    const waypoints = asWaypointKinds(p.waypoints);
    return {
      ...base,
      waypoints: waypoints ?? base.waypoints,
      includeFlightPath: p.includeFlightPath ?? base.includeFlightPath,
      includeGroundTrack: p.includeGroundTrack ?? base.includeGroundTrack,
      pathStride: p.pathStride ?? base.pathStride,
      altitudeUnit: asDistanceUnit(p.altitudeUnit) ?? base.altitudeUnit,
      distanceUnit: asDistanceUnit(p.distanceUnit) ?? base.distanceUnit,
      altitudeReference: asAltitudeReference(p.altitudeReference) ?? base.altitudeReference,
      waypointAltitudeReference: asAltitudeReference(p.waypointAltitudeReference) ?? base.waypointAltitudeReference,
      drawShadow: p.drawShadow ?? base.drawShadow,
      stageTrackStart: asStageTrackStart(p.stageTrackStart) ?? base.stageTrackStart,
      showWaypointLabels: p.showWaypointLabels ?? base.showWaypointLabels,
      colorWaypointPins: p.colorWaypointPins ?? base.colorWaypointPins,
      labelWaypointsWithMission: p.labelWaypointsWithMission,
      branchColors: decodeStageColors(p.branchColors),
      branchGroundColors: decodeStageColors(p.branchGroundColors),
      branchPinColors: decodeStageColors(p.branchPinColors),
    };
  });
  const [colorsOpen, setColorsOpen] = useState(false);
  // Which of the two unit fields is an explicit dialog choice. A stored unit
  // is one; so is any pick made here. Anything else stays ABSENT in the store,
  // so the next open still follows the app's distance preference rather than
  // whatever unit the app happened to show the first time this dialog opened.
  const explicitUnits = useRef({
    altitude: asDistanceUnit(settings.pathExport.altitudeUnit) !== undefined,
    distance: asDistanceUnit(settings.pathExport.distanceUnit) !== undefined,
  });
  // Write the preference-shaped fields back from the handlers that change
  // them, and nowhere else. An effect keyed on `opts` used to do this, and it
  // ran on mount (opening the dialog rewrote the settings) and on every
  // keystroke in the mission field (the one field that is deliberately NOT
  // persisted, but it lives in `opts` too). Each write recreates the settings
  // context and hits localStorage, so that was a settings save per keystroke.
  // The mission name is excluded at the source (it is not in
  // PathExportSettings), so it cannot leak into the store.
  const persist = (next: FlightPathExportOptions) => {
    const explicit = explicitUnits.current;
    update({
      pathExport: {
        labelWaypointsWithMission: next.labelWaypointsWithMission,
        waypoints: [...next.waypoints],
        includeFlightPath: next.includeFlightPath,
        includeGroundTrack: next.includeGroundTrack,
        pathStride: next.pathStride,
        ...(explicit.altitude ? { altitudeUnit: next.altitudeUnit } : {}),
        ...(explicit.distance ? { distanceUnit: next.distanceUnit } : {}),
        altitudeReference: next.altitudeReference,
        waypointAltitudeReference: next.waypointAltitudeReference,
        drawShadow: next.drawShadow,
        stageTrackStart: next.stageTrackStart,
        showWaypointLabels: next.showWaypointLabels,
        colorWaypointPins: next.colorWaypointPins,
        branchColors: encodeStageColors(next.branchColors),
        branchGroundColors: encodeStageColors(next.branchGroundColors),
        branchPinColors: encodeStageColors(next.branchPinColors),
      },
    });
  };
  // The latest options, for handlers. `change` used to spread the render's
  // closed-over `opts`, so two changes committed in one tick (or a change
  // landing before a re-render) built the second patch on a stale copy and
  // dropped the first. A ref that every writer updates gives the handlers the
  // current value without a side effect inside a state updater.
  const optsRef = useRef(opts);
  const patchOpts = (patch: Partial<FlightPathExportOptions>): FlightPathExportOptions => {
    const next = { ...optsRef.current, ...patch };
    optsRef.current = next;
    setOpts(next);
    return next;
  };
  /** Change persisted option(s): the dialog AND the store. Every handler
   *  below except the mission field's goes through this. */
  const change = (patch: Partial<FlightPathExportOptions>) => persist(patchOpts(patch));
  const [templates, setTemplates] = useState<UserTemplate[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Where a stage's track begins only means something once there is more than
  // one stage, so the control stays out of the way of a single-stage flight.
  const staged = (result.branches?.length ?? 0) > 1;
  // The stages that will actually get a track, in the order the model numbers
  // them — so a swatch always lines up with the branch it colors.
  const branchNames = useMemo(() => exportBranchNames(result, meta), [result, meta]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    store
      .list()
      .then(setTemplates)
      .catch(() => setTemplates([]));
  }, [store]);

  // Resolve the current selection to either a built-in format or a user template.
  const resolved = useMemo(() => {
    if (selected.startsWith(USER_PREFIX)) {
      const id = selected.slice(USER_PREFIX.length);
      const template = templates.find((tp) => tp.id === id);
      if (template) return { kind: 'user' as const, template };
    }
    const format = EXPORT_FORMATS.find((f) => f.id === selected) ?? EXPORT_FORMATS[0]!;
    return { kind: 'builtin' as const, format };
  }, [selected, templates]);

  // The built-in waypoint CSV ignores the path/geometry options; everything else
  // (KML, GPX, and any user template) may use them.
  const showPath = !(resolved.kind === 'builtin' && resolved.format.id === 'waypoints-csv');
  const noPosition = !hasLaunchPosition(launch);
  const selectedUser = resolved.kind === 'user' ? resolved.template : null;

  const toggleWaypoint = (k: WaypointKind) => {
    const waypoints = new Set(opts.waypoints);
    if (waypoints.has(k)) waypoints.delete(k);
    else waypoints.add(k);
    change({ waypoints });
  };

  const onImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // let the same file be re-imported after edits
    if (!file) return;
    try {
      const source = await file.text();
      if (!source.trim()) {
        setError(t('pathExport.importEmpty'));
        return;
      }
      const { id, name, ext } = parseTemplateFilename(file.name);
      await store.add({ id, name, ext, source });
      setTemplates(await store.list());
      setSelected(`${USER_PREFIX}${id}`);
      setError(null);
    } catch {
      setError(t('pathExport.importError'));
    }
  };

  const deleteSelected = async () => {
    if (!selectedUser) return;
    try {
      await store.remove(selectedUser.id);
      // Inside the try as well: a listing that fails after the delete used to
      // reject out of the handler, so the row vanished from the store but the
      // dialog kept showing it and no error was reported.
      setTemplates(await store.list());
    } catch {
      // The template store now reports a refused write rather than resolving
      // cleanly on one, so this can throw where it never used to.
      setError(t('storage.full'));
      return;
    }
    setSelected(EXPORT_FORMATS[0]!.id);
    setError(null);
  };

  // Download the selected template's Mustache source — a built-in as a starting
  // point for a custom template, or a user template to edit and re-import.
  const downloadTemplate = () => {
    if (resolved.kind === 'user') {
      const tp = resolved.template;
      saveDownload(`${safeFilename(tp.name, 'flight')}.${tp.ext}.mustache`, tp.source);
    } else {
      saveDownload(resolved.format.templateFilename, resolved.format.source);
    }
  };

  const download = () => {
    try {
      // Building the model is part of the render that can fail (a result with
      // no usable samples, a waypoint the branch never reached), so it belongs
      // under the same catch as the template render rather than in front of it.
      const model = buildFlightPathModel(result, launch, meta, opts, (k) => t(WP_LABEL_KEY[k]));
      let text: string;
      let ext: string;
      let mime: string;
      if (resolved.kind === 'user') {
        text = renderUserTemplate(resolved.template.source, resolved.template.ext, model);
        ext = resolved.template.ext;
        mime = mimeForExtension(ext);
      } else {
        text = resolved.format.render(model);
        ext = resolved.format.extension;
        mime = resolved.format.mime;
      }
      saveDownload(`${safeFilename(meta.simName, 'flight')}.${ext}`, text, mime);
      onClose();
    } catch {
      setError(t('pathExport.renderError'));
    }
  };

  return (
    <div className="dialog-overlay fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div
        ref={panelRef}
        className="dialog-panel max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-slate-900 p-5 ring-1 ring-white/10"
        role="dialog"
        aria-modal="true"
        aria-label={t('pathExport.title')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-base font-semibold text-slate-100">{t('pathExport.title')}</h2>
          <button
            onClick={onClose}
            aria-label={t('pathExport.cancel')}
            className="shrink-0 rounded-lg bg-slate-800 px-2 py-1 text-sm text-slate-300 ring-1 ring-white/10 hover:bg-slate-700"
          >
            ✕
          </button>
        </div>

        <div className="mt-4 space-y-4">
          {/* Format */}
          <div className="space-y-2">
            <label className="flex items-center justify-between gap-3">
              <span className="text-xs font-medium uppercase tracking-wide text-slate-400">
                {t('pathExport.format')}
              </span>
              <select
                value={selected}
                onChange={(e) => {
                  setSelected(e.target.value);
                  setError(null);
                }}
                className="flex-1 rounded-md bg-slate-800 px-2 py-1.5 text-sm text-slate-100 ring-1 ring-white/10 focus:outline-none focus:ring-sky-500"
              >
                <optgroup label={t('pathExport.builtIns')}>
                  {EXPORT_FORMATS.map((f) => (
                    <option key={f.id} value={f.id}>
                      {t(`pathExport.fmt.${f.id}`)}
                    </option>
                  ))}
                </optgroup>
                {templates.length > 0 && (
                  <optgroup label={t('pathExport.custom')}>
                    {templates.map((tp) => (
                      <option key={tp.id} value={`${USER_PREFIX}${tp.id}`}>
                        {tp.name} (.{tp.ext})
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </label>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap gap-2">
                <label className="cursor-pointer rounded-md bg-slate-800 px-2 py-1 text-[11px] font-medium text-slate-200 ring-1 ring-white/10 hover:bg-slate-700">
                  {t('pathExport.import')}
                  <input type="file" accept=".mustache" className="hidden" onChange={onImport} />
                </label>
                <button
                  onClick={downloadTemplate}
                  title={t('pathExport.downloadTemplateTitle')}
                  className="rounded-md bg-slate-800 px-2 py-1 text-[11px] font-medium text-slate-200 ring-1 ring-white/10 hover:bg-slate-700"
                >
                  {t('pathExport.downloadTemplate')}
                </button>
              </div>
              {selectedUser && (
                <button
                  onClick={deleteSelected}
                  className="rounded-md bg-rose-600/80 px-2 py-1 text-[11px] font-medium text-white ring-1 ring-rose-400/30 hover:bg-rose-600"
                >
                  {t('pathExport.delete')}
                </button>
              )}
            </div>
          </div>

          {/* Presets sit ABOVE the three sections because they reach into all
              three — which waypoints, whether the lines are drawn, and how it is
              all placed. They only set the controls below, never act behind
              them, so what the file will contain is always what the dialog
              shows and any one of them is a starting point you can adjust. */}
          <Section title={t('pathExport.presets')}>
            <div className="flex flex-wrap gap-1.5">
              {EXPORT_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  // The set is cloned on the way in, so the module-level one a
                  // preset carries is never the object the dialog then mutates.
                  onClick={() => change({ ...preset.options, waypoints: new Set(preset.options.waypoints) })}
                  title={t(`pathExport.preset.${preset.id}Note`)}
                  className="rounded-md bg-slate-800 px-2 py-1 text-xs font-medium text-slate-200 ring-1 ring-white/10 hover:bg-slate-700"
                >
                  {t(`pathExport.preset.${preset.id}`)}
                </button>
              ))}
            </div>
            <p className="text-[11px] leading-snug text-slate-500">{t('pathExport.presetsNote')}</p>
          </Section>

          {/* Waypoints */}
          <Section title={t('pathExport.waypoints')}>
            <div className="grid grid-cols-2 gap-1.5">
              {WAYPOINT_KINDS.map((k) => (
                <Check
                  key={k}
                  checked={opts.waypoints.has(k)}
                  onChange={() => toggleWaypoint(k)}
                  label={t(WP_LABEL_KEY[k])}
                />
              ))}
            </div>
          </Section>

          {/* Path geometry — irrelevant to the built-in waypoint CSV. */}
          {showPath && (
            <Section title={t('pathExport.path')}>
              <Check
                checked={opts.includeFlightPath}
                onChange={(v) => change({ includeFlightPath: v })}
                label={t('pathExport.includeFlightPath')}
              />
              <Check
                checked={opts.includeGroundTrack}
                onChange={(v) => change({ includeGroundTrack: v })}
                label={t('pathExport.includeGroundTrack')}
              />
              <label className="mt-1 flex items-center justify-between gap-3">
                <span className="text-xs text-slate-400">{t('pathExport.stride')}</span>
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={opts.pathStride}
                  onChange={(e) => change({ pathStride: Math.max(1, Math.floor(Number(e.target.value) || 1)) })}
                  className="w-20 rounded-md bg-slate-800 px-2 py-1 text-right text-sm text-slate-100 ring-1 ring-white/10 focus:outline-none focus:ring-sky-500"
                />
              </label>
              {/* Where a stage's track begins, and what color it is drawn in,
                  both describe the lines this box controls, so they sit with
                  them rather than under Placement, which is about where the
                  drawing lands on the map. Which stage a track BEGINS at only
                  means something once there is more than one. */}
              <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                {staged ? (
                  <label className="flex items-center gap-2">
                    <span className="text-xs text-slate-400">{t('pathExport.stageTrackStart')}</span>
                    <select
                      aria-label={t('pathExport.stageTrackStart')}
                      value={opts.stageTrackStart}
                      onChange={(e) => change({ stageTrackStart: e.target.value as StageTrackStart })}
                      className="rounded-md bg-slate-800 px-2 py-1 text-sm text-slate-100 ring-1 ring-white/10 focus:outline-none focus:ring-sky-500"
                    >
                      <option value="separation">{t('pathExport.trackStart.separation')}</option>
                      <option value="pad">{t('pathExport.trackStart.pad')}</option>
                    </select>
                  </label>
                ) : (
                  <span />
                )}
                <button
                  type="button"
                  onClick={() => setColorsOpen(true)}
                  title={t('pathExport.stageColorsTitle')}
                  // Sized to the stage-track-start select beside it. It used to
                  // be text-[11px] next to that control's text-sm, which read
                  // as an afterthought rather than the other half of the row.
                  className="rounded-md bg-slate-800 px-3 py-1.5 text-sm font-medium text-slate-200 ring-1 ring-white/10 hover:bg-slate-700"
                >
                  {t('pathExport.stageColors')}
                </button>
              </div>
            </Section>
          )}

          {/* How the track is placed on the map, and how much of it is drawn. */}
          <Section title={t('pathExport.placement')}>
            <AltitudeRefSelect
              label={t('pathExport.trackAltitude')}
              value={opts.altitudeReference}
              onChange={(v) => change({ altitudeReference: v })}
            />
            <AltitudeRefSelect
              label={t('pathExport.waypointAltitude')}
              value={opts.waypointAltitudeReference}
              onChange={(v) => change({ waypointAltitudeReference: v })}
            />
            <p className="text-[11px] leading-snug text-slate-500">{t('pathExport.altitudeReferenceNote')}</p>
            <Check
              checked={opts.drawShadow}
              disabled={opts.altitudeReference === 'clamped' && opts.waypointAltitudeReference === 'clamped'}
              onChange={(v) => change({ drawShadow: v })}
              label={t('pathExport.drawShadow')}
            />
            <p className="text-[11px] leading-snug text-slate-500">{t('pathExport.shadowNote')}</p>
            <Check
              checked={opts.showWaypointLabels}
              onChange={(v) => change({ showWaypointLabels: v })}
              label={t('pathExport.showWaypointLabels')}
            />
            <Check
              checked={opts.colorWaypointPins}
              onChange={(v) => change({ colorWaypointPins: v })}
              label={t('pathExport.colorWaypointPins')}
            />
            <p className="text-[11px] leading-snug text-slate-500">{t('pathExport.pinsNote')}</p>
          </Section>

          {/* Units */}
          <Section title={t('pathExport.units')}>
            <UnitRow
              label={t('pathExport.altitude')}
              value={opts.altitudeUnit}
              onChange={(u) => {
                explicitUnits.current.altitude = true; // a dialog choice: stored from now on
                change({ altitudeUnit: u });
              }}
            />
            <UnitRow
              label={t('pathExport.distance')}
              value={opts.distanceUnit}
              onChange={(u) => {
                explicitUnits.current.distance = true;
                change({ distanceUnit: u });
              }}
            />
          </Section>

          {/* Its own group, after Units, because it names the whole document
              rather than any one aspect of the geometry, so it belongs in
              neither Placement nor Flight path. */}
          <Section title={t('pathExport.mission')}>
            <input
              type="text"
              value={opts.missionName}
              aria-label={t('pathExport.mission')}
              placeholder={t('pathExport.missionPlaceholder')}
              // Dialog state only: the mission name is never persisted, and
              // typing it must not write the settings (see `persist`).
              onChange={(e) => patchOpts({ missionName: e.target.value })}
              className="w-full rounded-md bg-slate-800 px-2 py-1.5 text-sm text-slate-100 ring-1 ring-white/10 placeholder:text-slate-600 focus:outline-none focus:ring-sky-500"
            />
            <p className="text-[11px] leading-snug text-slate-500">{t('pathExport.missionNote')}</p>
            <Check
              checked={opts.labelWaypointsWithMission}
              onChange={(v) => change({ labelWaypointsWithMission: v })}
              label={t('pathExport.labelWaypointsWithMission')}
            />
            <p className="text-[11px] leading-snug text-slate-500">{t('pathExport.missionMarkersNote')}</p>
          </Section>

          {noPosition && (
            <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-300 ring-1 ring-amber-400/30">
              {t('pathExport.noPosition')}
            </p>
          )}
          {error && (
            <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-xs leading-relaxed text-rose-300 ring-1 ring-rose-400/30">
              {error}
            </p>
          )}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg bg-slate-800 px-4 py-2 text-sm text-slate-300 ring-1 ring-white/10 hover:bg-slate-700"
          >
            {t('pathExport.cancel')}
          </button>
          <button
            onClick={download}
            className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500"
          >
            {t('pathExport.download')}
          </button>
        </div>
      </div>
      {colorsOpen && (
        <StageColorDialog
          names={branchNames}
          colors={opts.branchColors}
          groundColors={opts.branchGroundColors}
          pinColors={opts.branchPinColors}
          onCancel={() => setColorsOpen(false)}
          onApply={(branchColors, branchGroundColors, branchPinColors) => {
            change({ branchColors, branchGroundColors, branchPinColors });
            setColorsOpen(false);
          }}
        />
      )}
    </div>
  );
}

/** The three independently colorable things the exporter draws per stage. */
const COLOR_ROLES = ['path', 'ground', 'pin'] as const;
type ColorRole = (typeof COLOR_ROLES)[number];

const ROLE_DEFAULT: Record<ColorRole, (index: number) => number> = {
  path: defaultBranchColor,
  ground: defaultGroundColor,
  pin: defaultPinColor,
};

const ROLE_LABEL: Record<ColorRole, string> = {
  path: 'pathExport.colorRolePath',
  ground: 'pathExport.colorRoleGround',
  pin: 'pathExport.colorRolePin',
};

/**
 * A grid of swatches: one row per stage, one column per role.
 *
 * A modal rather than inline pickers because the stage count comes from the
 * design, and a variable-length list needs room the panel does not have.
 *
 * Edits a DRAFT per role, so Cancel leaves the prior selection exactly as it
 * was and only Apply commits. Reset clears the drafts back to the palettes
 * rather than writing each palette color in as an override, so a stage nobody
 * chose a color for keeps following its palette.
 *
 * The three columns are deliberately INDEPENDENT. An earlier design had ground
 * and pin follow the path swatch while they were still on their derived value
 * and stop once moved. It demos well and is bad: two swatches showing the same
 * color behave differently depending on history, nothing on screen says which
 * are still following, and setting a color to exactly the derived value gets
 * you a swatch that silently keeps moving. Changing one column here never
 * moves another.
 */
function StageColorDialog({
  names,
  colors,
  groundColors,
  pinColors,
  onApply,
  onCancel,
}: {
  names: string[];
  colors: Map<number, number>;
  groundColors: Map<number, number>;
  pinColors: Map<number, number>;
  onApply: (colors: Map<number, number>, groundColors: Map<number, number>, pinColors: Map<number, number>) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const panelRef = useFocusTrap<HTMLDivElement>(true);
  const [drafts, setDrafts] = useState<Record<ColorRole, Map<number, number>>>(() => ({
    path: new Map(colors),
    ground: new Map(groundColors),
    pin: new Map(pinColors),
  }));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation(); // the export dialog listens too; close only this one
        onCancel();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onCancel]);

  const setColor = (role: ColorRole, i: number, rgb: number) =>
    setDrafts((d) => {
      const next = new Map(d[role]);
      next.set(i, rgb);
      return { ...d, [role]: next };
    });

  return (
    <div className="dialog-overlay fixed inset-0 z-[60] grid place-items-center bg-black/60 p-4" onClick={onCancel}>
      <div
        ref={panelRef}
        className="dialog-panel max-h-[80vh] w-full max-w-sm overflow-y-auto rounded-2xl bg-slate-900 p-5 ring-1 ring-white/10"
        role="dialog"
        aria-modal="true"
        aria-label={t('pathExport.stageColorsTitle')}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold text-slate-100">{t('pathExport.stageColorsTitle')}</h2>
        <div className="mt-3 space-y-1.5">
          {/* Header row: three columns is past the point where a bare swatch
              says what it paints. */}
          <div className="flex items-center justify-between gap-2 pb-1">
            <span className="flex-1" />
            {COLOR_ROLES.map((role) => (
              <span key={role} className="w-12 shrink-0 text-center text-[10px] uppercase tracking-wide text-slate-400">
                {t(ROLE_LABEL[role])}
              </span>
            ))}
          </div>
          {names.map((name, i) => {
            const stage = name || t('pathExport.stageN', { n: i + 1 });
            return (
              <div key={`${i}-${name}`} className="flex items-center justify-between gap-2">
                <span className="flex-1 truncate text-sm text-slate-300">{stage}</span>
                {COLOR_ROLES.map((role) => (
                  <input
                    key={role}
                    type="color"
                    aria-label={`${stage} ${t(ROLE_LABEL[role])}`}
                    value={rgbToHex(drafts[role].get(i) ?? ROLE_DEFAULT[role](i))}
                    onChange={(e) => setColor(role, i, hexToRgbInt(e.target.value))}
                    className="h-7 w-12 shrink-0 cursor-pointer rounded-md bg-slate-800 ring-1 ring-white/10"
                  />
                ))}
              </div>
            );
          })}
        </div>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={() => setDrafts({ path: new Map(), ground: new Map(), pin: new Map() })}
            className="mr-auto rounded-lg bg-slate-800 px-3 py-2 text-xs text-slate-300 ring-1 ring-white/10 hover:bg-slate-700"
          >
            {t('pathExport.resetColors')}
          </button>
          <button
            onClick={onCancel}
            className="rounded-lg bg-slate-800 px-4 py-2 text-sm text-slate-300 ring-1 ring-white/10 hover:bg-slate-700"
          >
            {t('pathExport.cancel')}
          </button>
          <button
            onClick={() => onApply(drafts.path, drafts.ground, drafts.pin)}
            className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500"
          >
            {t('pathExport.apply')}
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl bg-slate-800/40 p-3 ring-1 ring-white/10">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</h3>
      <div className="space-y-1.5">{children}</div>
    </section>
  );
}

function Check({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <label className={`flex items-center gap-2 text-sm ${disabled ? 'text-slate-600' : 'text-slate-300'}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-sky-500 disabled:opacity-40"
      />
      {label}
    </label>
  );
}

/** One of the two altitude-reference dropdowns: the track's, and the pins'. */
function AltitudeRefSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: AltitudeReference;
  onChange: (v: AltitudeReference) => void;
}) {
  const { t } = useTranslation();
  return (
    <label className="flex items-center justify-between gap-3">
      <span className="text-xs text-slate-400">{label}</span>
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value as AltitudeReference)}
        className="w-40 rounded-md bg-slate-800 px-2 py-1 text-sm text-slate-100 ring-1 ring-white/10 focus:outline-none focus:ring-sky-500"
      >
        <option value="automatic">{t('pathExport.altRef.automatic')}</option>
        <option value="ground">{t('pathExport.altRef.ground')}</option>
        <option value="sealevel">{t('pathExport.altRef.sealevel')}</option>
        <option value="clamped">{t('pathExport.altRef.clamped')}</option>
      </select>
    </label>
  );
}

/**
 * One-click export shapes, after the three export buttons GPS DC offers. Each
 * spans all three sections of the dialog — which waypoints, whether the lines
 * are drawn, and how the result is placed — because those are the three things
 * that have to agree for a file to answer one question well.
 *
 * They set the controls and nothing else. Nothing is inferred at render time, so
 * the dialog always shows what the file will contain.
 *
 * Each states its selection IN FULL, waypoints included, never a subset. A
 * preset that sets only some of the controls is a one-way door: Landing plots
 * narrows the waypoints to the landing, and if Drift cast then leaves the
 * waypoints alone there is no way back to the other two presets as they are
 * described. Stating all of it keeps every preset reachable from every other.
 */
// `waypoints` is required rather than optional, so the rule that a preset
// states its whole selection is enforced by the compiler and not by memory.
const EXPORT_PRESETS: {
  id: string;
  options: Partial<FlightPathExportOptions> & { waypoints: Set<WaypointKind> };
}[] = [
  {
    // What the rocket drifts OVER: everything flat on the terrain, and the 3D
    // line dropped because clamped it would only trace the ground track again.
    id: 'driftCast',
    options: {
      waypoints: new Set<WaypointKind>(WAYPOINT_KINDS),
      altitudeReference: 'clamped',
      waypointAltitudeReference: 'clamped',
      includeFlightPath: false,
      includeGroundTrack: true,
      drawShadow: false,
    },
  },
  {
    // How high it went: suspended in the air where it belongs, with shadows so
    // you can still read where each point sits on the map.
    id: 'flightPath',
    options: {
      waypoints: new Set<WaypointKind>(WAYPOINT_KINDS),
      altitudeReference: 'automatic',
      waypointAltitudeReference: 'automatic',
      includeFlightPath: true,
      includeGroundTrack: true,
      drawShadow: true,
    },
  },
  {
    // Where it comes down, and nothing else.
    id: 'landing',
    options: {
      waypoints: new Set<WaypointKind>(['landing']),
      altitudeReference: 'clamped',
      waypointAltitudeReference: 'clamped',
      includeFlightPath: false,
      includeGroundTrack: false,
      drawShadow: false,
    },
  },
];

function UnitRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: DistanceUnit;
  onChange: (u: DistanceUnit) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3">
      <span className="text-xs text-slate-400">{label}</span>
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value as DistanceUnit)}
        className="w-24 rounded-md bg-slate-800 px-2 py-1 text-sm text-slate-100 ring-1 ring-white/10 focus:outline-none focus:ring-sky-500"
      >
        {UNITS.map((u) => (
          <option key={u} value={u}>
            {u}
          </option>
        ))}
      </select>
    </label>
  );
}
