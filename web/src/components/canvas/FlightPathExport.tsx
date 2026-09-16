import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useWorkspaceStore, selectActive } from '../../state/store';
import { download as saveDownload, safeFilename } from '../../services/saveFile';
import { useUnits } from '../../prefs/useUnits';
import {
  buildFlightPathModel,
  defaultExportOptions,
  hasLaunchPosition,
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
 * it, so the dialog's own behaviour is covered as a component instead.
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
  const store = useMemo(() => getTemplateStore(), []);
  const [selected, setSelected] = useState<string>(EXPORT_FORMATS[0]!.id);
  const units = useUnits();
  const [opts, setOpts] = useState<FlightPathExportOptions>(() => defaultExportOptions(units.sym('distance')));
  const [templates, setTemplates] = useState<UserTemplate[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Where a stage's track begins only means something once there is more than
  // one stage, so the control stays out of the way of a single-stage flight.
  const staged = (result.branches?.length ?? 0) > 1;

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

  const toggleWaypoint = (k: WaypointKind) =>
    setOpts((o) => {
      const waypoints = new Set(o.waypoints);
      if (waypoints.has(k)) waypoints.delete(k);
      else waypoints.add(k);
      return { ...o, waypoints };
    });

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
    await store.remove(selectedUser.id);
    setTemplates(await store.list());
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
    const model = buildFlightPathModel(result, launch, meta, opts, (k) => t(WP_LABEL_KEY[k]));
    try {
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
                  onClick={() => setOpts((o) => ({ ...o, ...preset.options }))}
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
                onChange={(v) => setOpts((o) => ({ ...o, includeFlightPath: v }))}
                label={t('pathExport.includeFlightPath')}
              />
              <Check
                checked={opts.includeGroundTrack}
                onChange={(v) => setOpts((o) => ({ ...o, includeGroundTrack: v }))}
                label={t('pathExport.includeGroundTrack')}
              />
              <label className="mt-1 flex items-center justify-between gap-3">
                <span className="text-xs text-slate-400">{t('pathExport.stride')}</span>
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={opts.pathStride}
                  onChange={(e) =>
                    setOpts((o) => ({ ...o, pathStride: Math.max(1, Math.floor(Number(e.target.value) || 1)) }))
                  }
                  className="w-20 rounded-md bg-slate-800 px-2 py-1 text-right text-sm text-slate-100 ring-1 ring-white/10 focus:outline-none focus:ring-sky-500"
                />
              </label>
            </Section>
          )}

          {/* How the track is placed on the map, and how much of it is drawn. */}
          <Section title={t('pathExport.placement')}>
            <AltitudeRefSelect
              label={t('pathExport.trackAltitude')}
              value={opts.altitudeReference}
              onChange={(v) => setOpts((o) => ({ ...o, altitudeReference: v }))}
            />
            <AltitudeRefSelect
              label={t('pathExport.waypointAltitude')}
              value={opts.waypointAltitudeReference}
              onChange={(v) => setOpts((o) => ({ ...o, waypointAltitudeReference: v }))}
            />
            <p className="text-[11px] leading-snug text-slate-500">{t('pathExport.altitudeReferenceNote')}</p>
            <Check
              checked={opts.drawShadow}
              disabled={opts.altitudeReference === 'clamped' && opts.waypointAltitudeReference === 'clamped'}
              onChange={(v) => setOpts((o) => ({ ...o, drawShadow: v }))}
              label={t('pathExport.drawShadow')}
            />
            <p className="text-[11px] leading-snug text-slate-500">{t('pathExport.shadowNote')}</p>
            {staged && (
              <label className="mt-1 flex items-center justify-between gap-3">
                <span className="text-xs text-slate-400">{t('pathExport.stageTrackStart')}</span>
                <select
                  aria-label={t('pathExport.stageTrackStart')}
                  value={opts.stageTrackStart}
                  onChange={(e) => setOpts((o) => ({ ...o, stageTrackStart: e.target.value as StageTrackStart }))}
                  className="w-40 rounded-md bg-slate-800 px-2 py-1 text-sm text-slate-100 ring-1 ring-white/10 focus:outline-none focus:ring-sky-500"
                >
                  <option value="separation">{t('pathExport.trackStart.separation')}</option>
                  <option value="pad">{t('pathExport.trackStart.pad')}</option>
                </select>
              </label>
            )}
            <Check
              checked={opts.showWaypointLabels}
              onChange={(v) => setOpts((o) => ({ ...o, showWaypointLabels: v }))}
              label={t('pathExport.showWaypointLabels')}
            />
            <Check
              checked={opts.colorWaypointPins}
              onChange={(v) => setOpts((o) => ({ ...o, colorWaypointPins: v }))}
              label={t('pathExport.colorWaypointPins')}
            />
            <p className="text-[11px] leading-snug text-slate-500">{t('pathExport.pinsNote')}</p>
          </Section>

          {/* Units */}
          <Section title={t('pathExport.units')}>
            <UnitRow
              label={t('pathExport.altitude')}
              value={opts.altitudeUnit}
              onChange={(u) => setOpts((o) => ({ ...o, altitudeUnit: u }))}
            />
            <UnitRow
              label={t('pathExport.distance')}
              value={opts.distanceUnit}
              onChange={(u) => setOpts((o) => ({ ...o, distanceUnit: u }))}
            />
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
 */
const EXPORT_PRESETS: { id: string; options: Partial<FlightPathExportOptions> }[] = [
  {
    // What the rocket drifts OVER: everything flat on the terrain, and the 3D
    // line dropped because clamped it would only trace the ground track again.
    id: 'driftCast',
    options: {
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
