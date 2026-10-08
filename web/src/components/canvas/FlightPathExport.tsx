import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useWorkspaceStore, selectActive, selectConfig, selectDesignName } from '../../state/store';
import { primaryMotor } from '../../services/flight/flightConfigs';
import { download as saveDownload, exportFilename } from '../../services/files/saveFile';
import {
  buildFlightPathModel,
  exportBranchNames,
  hasLaunchPosition,
  renderUserTemplate,
  mimeForExtension,
  WAYPOINT_KINDS,
  WAYPOINT_LABEL_KEY,
  type Translate,
  type WaypointKind,
  type StageTrackStart,
} from '../../services/exports/flightPathExport';
import { Dialog } from '../common/Dialog';
import { LANGUAGES } from '../../i18n';
import { AltitudeRefSelect, Section, UnitRow } from './PathExportControls';
import { ExportFormatPicker } from './ExportFormatPicker';
import { StageColorDialog } from './StageColorDialog';
import { EXPORT_PRESETS, matchingPreset } from './pathExportPresets';
import { useExportOptions } from './useExportOptions';
import { useExportTemplates } from './useExportTemplates';
import { Check } from '../common/Check';
import { DialogButton } from '../common/DialogButton';
import { NumberInput } from '../common/NumberInput';

/**
 * "Export flight path" - a port of OpenRocket's 3D-path export dialog. Renders a
 * button that opens a modal to pick the format (built-in KML / GPX / waypoint
 * CSV, or an imported Mustache template) and the options (which waypoints,
 * flight-path/ground-track lines, path stride, altitude/distance units), then
 * downloads the rendered file. Self-sources the active simulation's result,
 * launch site, and design metadata from the store.
 *
 * User templates are imported `.mustache` files persisted in the template store,
 * the browser equivalent of OpenRocket's desktop `ExportTemplates` folder.
 */

export function FlightPathExport({ variant = 'chip' }: { variant?: 'chip' | 'overlay' }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const result = useWorkspaceStore((s) => selectActive(s).result);
  const launch = useWorkspaceStore((s) => selectActive(s).launch);
  const simName = useWorkspaceStore((s) => selectActive(s).name);
  const motor = useWorkspaceStore((s) => primaryMotor(s.tree, selectConfig(s)));
  const rocketName = useWorkspaceStore(selectDesignName);

  if (!result) return null;

  const btnClass =
    variant === 'overlay'
      ? 'rounded-md bg-surface/80 px-2 py-1 text-[11px] font-medium text-ink ring-1 ring-line/10 hover:bg-raised'
      : 'rounded-md bg-raised px-2 py-1 text-[11px] font-medium text-ink ring-1 ring-line/10 hover:bg-elevated';

  return (
    <>
      <button onClick={() => setOpen(true)} title={t('pathExport.open')} className={btnClass}>
        ⬇ {t('pathExport.short')}
      </button>
      {open && (
        <ExportDialog
          onClose={() => setOpen(false)}
          meta={{ simName, rocketName, motorName: motor?.designation ?? '' }}
          launch={launch}
          result={result}
        />
      )}
    </>
  );
}

/**
 * Exported for `FlightPathExport.test.tsx`. The button that opens it lives only
 * in the 3D path view, which needs WebGL - headless Chromium crashes rendering
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
  launch: import('../../services/design/orkTree').LaunchConditions;
  result: import('../../engine/openRocketEngine').FlightResult;
}) {
  const { t, i18n } = useTranslation();
  const { opts, patchOpts, change, setUnit } = useExportOptions();
  const [colorsOpen, setColorsOpen] = useState(false);
  // Where a stage's track begins only means something once there is more than
  // one stage, so the control stays out of the way of a single-stage flight.
  const staged = (result.branches?.length ?? 0) > 1;
  // The stages that will actually get a track, in the order the model numbers
  // them - so a swatch always lines up with the branch it colors.
  const branchNames = useMemo(() => exportBranchNames(result, meta), [result, meta]);
  // Which preset the controls currently spell out, or none. Derived every
  // render rather than remembered from the last click: a preset only SETS the
  // controls, so a remembered selection would go on claiming a shape the
  // dialog had since been adjusted out of.
  const activePreset = useMemo(() => matchingPreset(opts), [opts]);
  // The `t` the FILE is written with. Every locale is bundled at startup, so
  // `getFixedT` resolves without loading anything; falling back to the app's
  // own `t` is what makes '' mean "follow the app" with no second code path.
  const exportT: Translate = useMemo(
    () => (opts.language ? (i18n.getFixedT(opts.language) as unknown as Translate) : (t as Translate)),
    [opts.language, i18n, t],
  );

  const {
    selected,
    setSelected,
    templates,
    resolved,
    selectedUser,
    error,
    setError,
    onImport,
    deleteSelected,
    downloadTemplate,
  } = useExportTemplates();

  // The built-in waypoint CSV ignores the path/geometry options; everything else
  // (KML, GPX, and any user template) may use them.
  const showPath = !(resolved.kind === 'builtin' && resolved.format.id === 'waypoints-csv');
  const noPosition = !hasLaunchPosition(launch);

  const toggleWaypoint = (k: WaypointKind) => {
    const waypoints = new Set(opts.waypoints);
    if (waypoints.has(k)) waypoints.delete(k);
    else waypoints.add(k);
    change({ waypoints });
  };

  const download = () => {
    try {
      // Building the model is part of the render that can fail (a result with
      // no usable samples, a waypoint the branch never reached), so it belongs
      // under the same catch as the template render rather than in front of it.
      const model = buildFlightPathModel(result, launch, meta, opts, exportT);
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
      saveDownload(exportFilename([meta.rocketName, meta.simName, 'flight-path'], ext, 'flight'), text, mime);
      onClose();
    } catch {
      setError(t('pathExport.renderError'));
    }
  };

  return (
    <>
      <Dialog
        id="pathExport"
        title={t('pathExport.title')}
        onClose={onClose}
        size="md"
        // A form of sections, read top to bottom. A rule under the heading would
        // be one more line in something that already has plenty.
        layout="pad"
        // A column of labeled fields at a readable measure. Widening it would
        // stretch the rows, not show more of anything.
        expandable={false}
      >
        <div className="space-y-4">
          {/* Format */}
          <ExportFormatPicker
            selected={selected}
            templates={templates}
            canDelete={selectedUser !== null}
            onSelect={(value) => {
              setSelected(value);
              setError(null);
            }}
            onImport={onImport}
            onDownloadTemplate={downloadTemplate}
            onDelete={deleteSelected}
          />

          {/* Presets sit ABOVE the three sections because they reach into all
              three - which waypoints, whether the lines are drawn, and how it is
              all placed. They only set the controls below, never act behind
              them, so what the file will contain is always what the dialog
              shows and any one of them is a starting point you can adjust. */}
          <Section title={t('pathExport.presets')}>
            <div role="group" aria-label={t('pathExport.presets')} className="flex flex-wrap gap-1.5">
              {EXPORT_PRESETS.map((preset) => {
                const active = activePreset === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    // A toggle, not a plain button: which shape the dialog is
                    // in is knowable, so it is announced - see `matchingPreset`.
                    aria-pressed={active}
                    // The set is cloned on the way in, so the module-level one a
                    // preset carries is never the object the dialog then mutates.
                    onClick={() => change({ ...preset.options, waypoints: new Set(preset.options.waypoints) })}
                    title={t(`pathExport.preset.${preset.id}Note`)}
                    className={`rounded-md px-2 py-1 text-xs font-medium ring-1 ${
                      active
                        ? 'bg-accent-600 text-on-accent ring-accent-400/40'
                        : 'bg-raised text-ink ring-line/10 hover:bg-elevated'
                    }`}
                  >
                    {t(`pathExport.preset.${preset.id}`)}
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] leading-snug text-ink-faint">{t('pathExport.presetsNote')}</p>
          </Section>

          {/* Waypoints */}
          <Section title={t('pathExport.waypoints')}>
            <div className="grid grid-cols-2 gap-1.5">
              {WAYPOINT_KINDS.map((k) => (
                <Check
                  key={k}
                  checked={opts.waypoints.has(k)}
                  onChange={() => toggleWaypoint(k)}
                  label={t(WAYPOINT_LABEL_KEY[k])}
                />
              ))}
            </div>
          </Section>

          {/* Path geometry - irrelevant to the built-in waypoint CSV. */}
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
                <span className="text-xs text-ink-muted">{t('pathExport.stride')}</span>
                <NumberInput
                  min={1}
                  step={1}
                  value={opts.pathStride}
                  ariaLabel={t('pathExport.stride')}
                  // Whole samples, at least one. NumberInput refuses a non-finite
                  // entry, and an emptied box keeps the stride it had.
                  onChange={(v) => v !== null && change({ pathStride: Math.max(1, Math.floor(v)) })}
                  className="w-20 rounded-md bg-raised px-2 py-1 text-right text-sm text-ink-strong ring-1 ring-line/10 focus:outline-none focus:ring-accent-500"
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
                    <span className="text-xs text-ink-muted">{t('pathExport.stageTrackStart')}</span>
                    <select
                      aria-label={t('pathExport.stageTrackStart')}
                      value={opts.stageTrackStart}
                      onChange={(e) => change({ stageTrackStart: e.target.value as StageTrackStart })}
                      className="rounded-md bg-raised px-2 py-1 text-sm text-ink-strong ring-1 ring-line/10 focus:outline-none focus:ring-accent-500"
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
                  // text-sm to match the stage-track-start select beside it:
                  // the two are halves of one row.
                  className="rounded-md bg-raised px-3 py-1.5 text-sm font-medium text-ink ring-1 ring-line/10 hover:bg-elevated"
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
            <p className="text-[11px] leading-snug text-ink-faint">{t('pathExport.altitudeReferenceNote')}</p>
            <Check
              checked={opts.drawShadow}
              disabled={opts.altitudeReference === 'clamped' && opts.waypointAltitudeReference === 'clamped'}
              onChange={(v) => change({ drawShadow: v })}
              label={t('pathExport.drawShadow')}
            />
            <p className="text-[11px] leading-snug text-ink-faint">{t('pathExport.shadowNote')}</p>
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
            <p className="text-[11px] leading-snug text-ink-faint">{t('pathExport.pinsNote')}</p>
          </Section>

          {/* What the file SAYS, rather than where it sits - so it is neither
              Placement nor Flight path, and no preset touches it. */}
          <Section title={t('pathExport.balloons')}>
            <Check
              checked={opts.includeDescriptions}
              onChange={(v) => change({ includeDescriptions: v })}
              label={t('pathExport.includeDescriptions')}
            />
            <p className="text-[11px] leading-snug text-ink-faint">{t('pathExport.descriptionsNote')}</p>
          </Section>

          {/* Units */}
          <Section title={t('pathExport.units')}>
            <UnitRow
              label={t('pathExport.altitude')}
              value={opts.altitudeUnit}
              onChange={(u) => setUnit('altitude', u)}
            />
            <UnitRow
              label={t('pathExport.distance')}
              value={opts.distanceUnit}
              onChange={(u) => setUnit('distance', u)}
            />
            <label className="flex items-center justify-between gap-3">
              <span className="text-xs text-ink-muted">{t('pathExport.language')}</span>
              <select
                aria-label={t('pathExport.language')}
                value={opts.language}
                onChange={(e) => change({ language: e.target.value })}
                className="w-40 rounded-md bg-raised px-2 py-1 text-sm text-ink-strong ring-1 ring-line/10 focus:outline-none focus:ring-accent-500"
              >
                <option value="">{t('pathExport.languageSameAsApp')}</option>
                {LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
            <p className="text-[11px] leading-snug text-ink-faint">{t('pathExport.languageNote')}</p>
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
              // typing it must not write the settings (see `useExportOptions`).
              onChange={(e) => patchOpts({ missionName: e.target.value })}
              className="w-full rounded-md bg-raised px-2 py-1.5 text-sm text-ink-strong ring-1 ring-line/10 placeholder:text-ink-dim focus:outline-none focus:ring-accent-500"
            />
            <p className="text-[11px] leading-snug text-ink-faint">{t('pathExport.missionNote')}</p>
            <Check
              checked={opts.labelWaypointsWithMission}
              onChange={(v) => change({ labelWaypointsWithMission: v })}
              label={t('pathExport.labelWaypointsWithMission')}
            />
            <p className="text-[11px] leading-snug text-ink-faint">{t('pathExport.missionMarkersNote')}</p>
          </Section>

          {noPosition && (
            <p className="rounded-lg bg-warn-500/10 px-3 py-2 text-xs leading-relaxed text-warn-300 ring-1 ring-warn-400/30">
              {t('pathExport.noPosition')}
            </p>
          )}
          {error && (
            <p className="rounded-lg bg-error-500/10 px-3 py-2 text-xs leading-relaxed text-error-300 ring-1 ring-error-400/30">
              {error}
            </p>
          )}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <DialogButton onClick={onClose} variant="secondary">
            {t('pathExport.cancel')}
          </DialogButton>
          <DialogButton onClick={download} variant="primary">
            {t('pathExport.download')}
          </DialogButton>
        </div>
      </Dialog>

      {/* Outside the Dialog, not inside its panel: it is its own surface on its
          own layer, and rendered within the panel it would inherit the panel's
          clipping. */}
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
    </>
  );
}
