import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useWorkspaceStore, selectActive } from '../../state/store';
import { downloadText } from '../../services/csvExport';
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
  type DistanceUnit,
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
const safeName = (s: string) => (s.trim() || 'flight').replace(/[^\w.-]+/g, '_');

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

function ExportDialog({
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
  const [selected, setSelected] = useState<string>(EXPORT_FORMATS[0].id);
  const [opts, setOpts] = useState<FlightPathExportOptions>(() => defaultExportOptions());
  const [templates, setTemplates] = useState<UserTemplate[]>([]);
  const [error, setError] = useState<string | null>(null);

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
    const format = EXPORT_FORMATS.find((f) => f.id === selected) ?? EXPORT_FORMATS[0];
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
    setSelected(EXPORT_FORMATS[0].id);
    setError(null);
  };

  // Download the selected template's Mustache source — a built-in as a starting
  // point for a custom template, or a user template to edit and re-import.
  const downloadTemplate = () => {
    if (resolved.kind === 'user') {
      const tp = resolved.template;
      downloadText(`${safeName(tp.name)}.${tp.ext}.mustache`, tp.source, 'text/plain;charset=utf-8');
    } else {
      downloadText(resolved.format.templateFilename, resolved.format.source, 'text/plain;charset=utf-8');
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
      downloadText(`${safeName(meta.simName)}.${ext}`, text, mime);
      onClose();
    } catch {
      setError(t('pathExport.renderError'));
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-slate-900 p-5 ring-1 ring-white/10"
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

function Check({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-2 text-sm text-slate-300">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-sky-500"
      />
      {label}
    </label>
  );
}

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
