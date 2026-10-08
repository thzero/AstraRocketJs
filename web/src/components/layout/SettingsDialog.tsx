import { useId, useState } from 'react';
import { useTabs } from '../common/useTabs';
import { useTranslation } from 'react-i18next';
import { useSettings } from '../../state/SettingsProvider';
import { DEFAULT_SETTINGS, SIM_BOUNDS, type SimulationSettings } from '../../services/storage/settings';
import { PART_KEYS, mergePalette } from '../../services/design/partColors';
import { NumberInput } from '../common/NumberInput';
import { Dialog } from '../common/Dialog';
import { DefaultMaterials } from './DefaultMaterials';
import { LaunchPanel } from '../sim/LaunchPanel';
import { withRequiredFrom } from '../../services/flight/requiredLaunch';
import { IMPERIAL_UNITS, METRIC_UNITS, QUANTITIES, UNITS, unitScope } from '../../prefs/units';
import { useUnits } from '../../prefs/useUnits';
import { onSi } from '../../prefs/entryValue';
import { Check } from '../common/Check';
import { ColorInput } from '../common/ColorInput';
import { DialogButton } from '../common/DialogButton';
import { canAskWhereToSave } from '../../services/files/saveFile';
import { SPEED_WARNINGS } from '../sim/speedWarnings';
import { THEME_PREFS, type ThemePref } from '../../services/app/theme';

const SPEEDS = [0.25, 0.5, 1, 2, 4];
const speedLabel = (s: number) => (s === 0.25 ? '¼×' : s === 0.5 ? '½×' : `${s}×`);

type TabKey = 'general' | 'units' | 'colors' | 'materials' | 'playback' | 'sketch' | 'sim' | 'launch';
const TABS: { key: TabKey; label: string }[] = [
  { key: 'general', label: 'settings.tabGeneral' },
  { key: 'units', label: 'settings.tabUnits' },
  { key: 'colors', label: 'settings.tabColors' },
  { key: 'materials', label: 'settings.tabMaterials' },
  { key: 'playback', label: 'settings.tabPlayback' },
  { key: 'sketch', label: 'settings.tabSketch' },
  { key: 'sim', label: 'settings.tabSim' },
  { key: 'launch', label: 'settings.tabLaunch' },
];

const RULER_SIDES = ['top', 'bottom', 'left', 'right'] as const;

/** Settings panel, tabbed: 3D part colors, flight-path phase colors, and the
 *  default playback speed. Persisted via the SettingsProvider.
 *  Mounted only while open (`{open && <SettingsDialog />}`). */
export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const { settings, update, reset } = useSettings();
  const u = useUnits();
  const [tab, setTab] = useState<TabKey>('general');
  const tabs = useTabs(
    TABS.map((x) => x.key),
    tab,
    setTab,
  );
  // Stored in radians like the kernel's field; edited in the user's angle
  // unit through the same FieldUnit the property panel's angle fields use,
  // rather than an inline `* 180 / Math.PI`.
  const angle = u.at(unitScope('settings', 'maxAngleStep'), 'angle');
  const palette = mergePalette(settings.partColors);
  const setPart = (key: string, color: string) => update({ partColors: { ...settings.partColors, [key]: color } });
  const resetPart = (key: string) => {
    const p = { ...settings.partColors };
    delete p[key as keyof typeof p];
    update({ partColors: p });
  };
  const setPhase = (k: 'boost' | 'coast' | 'descent', c: string) =>
    update({ phaseColors: { ...settings.phaseColors, [k]: c } });
  const setSim = (patch: Partial<SimulationSettings>) => update({ simulation: { ...settings.simulation, ...patch } });
  const overriddenFields = Object.keys(settings.unitOverrides).length;

  const resetSection = () => {
    if (tab === 'general')
      update({
        saveDesignInfo: DEFAULT_SETTINGS.saveDesignInfo,
        askWhereToSave: DEFAULT_SETTINGS.askWhereToSave,
        theme: DEFAULT_SETTINGS.theme,
        themeBeforeDaylight: DEFAULT_SETTINGS.themeBeforeDaylight,
      });
    else if (tab === 'units') update({ units: DEFAULT_SETTINGS.units, unitOverrides: {} });
    else if (tab === 'colors') update({ partColors: {}, phaseColors: DEFAULT_SETTINGS.phaseColors });
    else if (tab === 'materials') update({ defaultMaterials: DEFAULT_SETTINGS.defaultMaterials });
    else if (tab === 'playback') update({ playbackSpeed: DEFAULT_SETTINGS.playbackSpeed });
    else if (tab === 'sketch') update({ showMarkers: DEFAULT_SETTINGS.showMarkers, rulers: DEFAULT_SETTINGS.rulers });
    else if (tab === 'sim') update({ simulation: DEFAULT_SETTINGS.simulation });
    else update({ launchDefaults: DEFAULT_SETTINGS.launchDefaults });
  };

  return (
    <Dialog
      id="settings"
      title={t('settings.title')}
      onClose={onClose}
      size="lg"
      // A fixed height, because eight tabs holding between two rows and thirty
      // would otherwise resize and re-center the dialog every time you moved
      // between them.
      height={560}
      toolbar={
        // Tabs. A real tablist, so which section is open is announced rather
        // than shown by background color alone. In the toolbar band so it stays
        // put while a long tab scrolls.
        <div role="tablist" aria-label={t('settings.title')} className="flex flex-wrap gap-1 p-3">
          {TABS.map((tb) => (
            <button
              key={tb.key}
              {...tabs.tab(tb.key)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium ${tab === tb.key ? 'bg-accent-600 text-on-accent' : 'bg-raised text-ink-soft hover:bg-elevated'}`}
            >
              {t(tb.label)}
            </button>
          ))}
        </div>
      }
      footer={
        <div className="flex items-center justify-between gap-2 p-4">
          <div className="flex gap-2">
            <button
              onClick={resetSection}
              className="rounded-lg bg-raised px-3 py-2 text-xs font-medium text-ink-soft ring-1 ring-line/10 hover:bg-elevated"
            >
              {t('settings.resetTab', { name: t(TABS.find((x) => x.key === tab)!.label) })}
            </button>
            <button
              onClick={reset}
              className="rounded-lg bg-raised px-3 py-2 text-xs font-medium text-ink-soft ring-1 ring-line/10 hover:bg-elevated"
            >
              {t('settings.resetAll')}
            </button>
          </div>
          <DialogButton onClick={onClose} variant="primary">
            {t('settings.close')}
          </DialogButton>
        </div>
      }
    >
      <div {...tabs.panel} className="space-y-2 p-4">
        {tab === 'materials' && (
          <DefaultMaterials
            defaults={settings.defaultMaterials}
            onChange={(defaultMaterials) => update({ defaultMaterials })}
          />
        )}

        {tab === 'colors' && (
          <>
            {/* Part colors apply to the 3D model, which a phone reaches
                  through the Sketch tab just as a desktop reaches it through the
                  view switch, so this is not gated on width. */}
            <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
              {t('settings.parts')}
            </div>
            {PART_KEYS.map((key) => (
              <ColorRow
                key={key}
                label={t(`settings.part.${key}`)}
                value={palette[key]}
                overridden={key in settings.partColors}
                onChange={(c) => setPart(key, c)}
                onReset={() => resetPart(key)}
                resetTitle={t('settings.resetOne')}
              />
            ))}
            {/* Taste, not correctness: the default is a magnitude ramp, and
                  OpenRocket's green-to-red is here for anyone who reads that
                  faster because they already know it from the desktop. */}
            <div className="pt-1 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
              {t('settings.aeroHeat')}
            </div>
            <label className="flex items-center justify-between gap-3 text-sm text-ink-soft">
              {t('settings.aeroHeatLabel')}
              <select
                value={settings.aeroHeat}
                onChange={(e) => update({ aeroHeat: e.target.value as 'sky' | 'openrocket' })}
                className="w-44 rounded-md bg-raised px-2 py-1 text-sm text-ink-strong ring-1 ring-line/10 focus:outline-none focus:ring-accent-500"
              >
                <option value="sky">{t('settings.aeroHeatSky')}</option>
                <option value="openrocket">{t('settings.aeroHeatOr')}</option>
              </select>
            </label>
            <p className="text-[11px] leading-snug text-ink-faint">{t('settings.aeroHeatNote')}</p>

            <div className="pt-1 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
              {t('settings.phases')}
            </div>
            <ColorRow
              label={t('flight.boost')}
              value={settings.phaseColors.boost}
              onChange={(c) => setPhase('boost', c)}
            />
            <ColorRow
              label={t('flight.coast')}
              value={settings.phaseColors.coast}
              onChange={(c) => setPhase('coast', c)}
            />
            <ColorRow
              label={t('flight.descent')}
              value={settings.phaseColors.descent}
              onChange={(c) => setPhase('descent', c)}
            />
          </>
        )}

        {tab === 'general' && (
          <>
            <p className="text-[11px] leading-snug text-ink-faint">{t('settings.generalNote')}</p>
            <label className="flex items-center justify-between gap-3 text-sm text-ink">
              <span>{t('settings.theme')}</span>
              <select
                value={settings.theme}
                onChange={(e) => update({ theme: e.target.value as ThemePref })}
                className="rounded-md bg-raised px-2 py-1 text-sm text-ink ring-1 ring-line/10 focus:outline-none focus:ring-accent-500"
              >
                {THEME_PREFS.map((p) => (
                  <option key={p} value={p}>
                    {t(`settings.themeOption.${p}`)}
                  </option>
                ))}
              </select>
            </label>
            <p className="-mt-1 text-[11px] leading-snug text-ink-faint">{t('settings.themeHint')}</p>
            <Check
              label={t('settings.saveDesignInfo')}
              checked={settings.saveDesignInfo}
              onChange={(v) => update({ saveDesignInfo: v })}
            />
            {/* Only where the browser has a save dialog to offer: a box that
                changes nothing in Firefox or Safari would be a control that
                does nothing. */}
            {canAskWhereToSave() && (
              <Check
                label={t('settings.askWhereToSave')}
                hint={t('settings.askWhereToSaveHint')}
                checked={settings.askWhereToSave}
                onChange={(v) => update({ askWhereToSave: v })}
              />
            )}
          </>
        )}

        {tab === 'units' && (
          <>
            <p className="text-[11px] leading-snug text-ink-faint">{t('settings.unitsNote')}</p>
            {/* Whole-system presets first: most people want "imperial" and are
                  done, and only then reach in to change one quantity. A preset
                  is a clean slate, so it also drops every per-field override;
                  otherwise "Imperial defaults" would leave a field a chip had
                  touched still showing its old unit. */}
            <div className="flex gap-2 pb-1">
              <button
                onClick={() => update({ units: METRIC_UNITS, unitOverrides: {} })}
                className="rounded-lg bg-raised px-3 py-1.5 text-xs font-medium text-ink ring-1 ring-line/10 hover:bg-elevated"
              >
                {t('settings.unitsMetric')}
              </button>
              <button
                onClick={() => update({ units: IMPERIAL_UNITS, unitOverrides: {} })}
                className="rounded-lg bg-raised px-3 py-1.5 text-xs font-medium text-ink ring-1 ring-line/10 hover:bg-elevated"
              >
                {t('settings.unitsImperial')}
              </button>
            </div>
            {QUANTITIES.map((q) => (
              <label key={q} className="flex items-center justify-between gap-3">
                <span className="text-sm text-ink-soft">{t(`units.q.${q}`)}</span>
                <select
                  aria-label={t(`units.q.${q}`)}
                  value={settings.units[q]}
                  onChange={(e) => update({ units: { ...settings.units, [q]: e.target.value } })}
                  className="w-28 rounded-md bg-raised px-2 py-1 text-sm text-ink-strong ring-1 ring-line/10 focus:outline-none focus:ring-accent-500"
                >
                  {UNITS[q].map((u) => (
                    <option key={u.symbol} value={u.symbol}>
                      {u.symbol}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            {/* A unit set from a chip lives on one field, which makes it easy
                  to forget where it was: a field showing inches while this tab
                  says cm looks like a bug unless you remember changing it. This
                  is the one place that can say how many there are and undo them
                  all, hidden when there are none, so it is never noise. */}
            {overriddenFields > 0 && (
              <button
                onClick={() => update({ unitOverrides: {} })}
                className="mt-1 w-full rounded-lg bg-raised px-3 py-1.5 text-xs font-medium text-warn-300 ring-1 ring-line/10 hover:bg-elevated"
              >
                {t('settings.unitsClearFields', { count: overriddenFields })}
              </button>
            )}
          </>
        )}

        {tab === 'playback' && (
          <label className="flex items-center justify-between gap-3">
            <span className="text-sm text-ink-soft">{t('settings.defaultSpeed')}</span>
            <select
              value={settings.playbackSpeed}
              onChange={(e) => update({ playbackSpeed: parseFloat(e.target.value) })}
              className="rounded-md bg-raised px-2 py-1 text-sm text-ink-strong ring-1 ring-line/10 focus:outline-none focus:ring-accent-500"
            >
              {SPEEDS.map((s) => (
                <option key={s} value={s}>
                  {speedLabel(s)}
                </option>
              ))}
            </select>
          </label>
        )}

        {tab === 'sketch' && (
          <>
            <p className="text-[11px] leading-snug text-ink-faint">{t('settings.sketchNote')}</p>
            <Check
              label={t('settings.sketchMarkers')}
              checked={settings.showMarkers}
              onChange={(v) => update({ showMarkers: v })}
            />
            <div className="pt-1 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
              {t('settings.sketchRulers')}
            </div>
            {RULER_SIDES.map((side) => (
              <Check
                key={side}
                label={t(`view.ruler_${side}`)}
                checked={settings.rulers[side]}
                onChange={(v) => update({ rulers: { ...settings.rulers, [side]: v } })}
              />
            ))}
          </>
        )}

        {tab === 'sim' && (
          <>
            <Check
              label={t('settings.confirmDelete')}
              checked={settings.simulation.confirmDelete}
              onChange={(v) => setSim({ confirmDelete: v })}
            />
            <Check
              label={t('settings.autoRunOutdated')}
              checked={settings.simulation.autoRunOutdated}
              onChange={(v) => setSim({ autoRunOutdated: v })}
            />
            <div className="pt-1 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
              {t('settings.simOptions')}
            </div>
            <InfoRow label={t('settings.calcMethod')} value="Extended Barrowman" />
            <InfoRow label={t('settings.simMethod')} value="6-DOF Runge-Kutta 4" />
            <NumRow
              label={t('settings.timeStep')}
              unit="s"
              step={0.01}
              min={SIM_BOUNDS.timeStep.min}
              // maxTime / timeStep is the solver's iteration count, so both
              // ends are bounded. 1000000 s (a plausible slip for 1000) at the
              // default 0.01 s step would ask for 100 M integration steps, with
              // no way to interrupt the run.
              max={SIM_BOUNDS.timeStep.max}
              value={settings.simulation.timeStep}
              onChange={(v) => setSim({ timeStep: v ?? DEFAULT_SETTINGS.simulation.timeStep })}
            />
            <NumRow
              label={t('settings.maxTime')}
              unit="s"
              step={60}
              min={SIM_BOUNDS.maxTime.min}
              max={SIM_BOUNDS.maxTime.max}
              value={settings.simulation.maxTime}
              onChange={(v) => setSim({ maxTime: v ?? DEFAULT_SETTINGS.simulation.maxTime })}
            />
            <NumRow
              label={t('settings.maxAngleStep')}
              unit={angle.sym}
              step={angle.step((0.5 * Math.PI) / 180)}
              min={angle.toUi(SIM_BOUNDS.maxAngleStep.min)}
              max={angle.toUi(SIM_BOUNDS.maxAngleStep.max)}
              value={angle.toUi(settings.simulation.maxAngleStep)}
              onChange={onSi(angle, (si) => setSim({ maxAngleStep: si ?? DEFAULT_SETTINGS.simulation.maxAngleStep }))}
            />
            <NumRow
              label={t('settings.randomSeed')}
              step={1}
              placeholder={t('settings.seedAuto')}
              value={settings.simulation.randomSeed}
              onChange={(v) => setSim({ randomSeed: v })}
            />
            <div className="pt-1 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
              {t('settings.warnings')}
            </div>
            <NumRow
              label={t('settings.railExitMin')}
              hint={t('settings.railExitMinHint')}
              unit={u.sym('velocity')}
              step={u.step('velocity', 1)}
              min={0}
              value={u.toUi('velocity', settings.simulation.railExitVelocityMin)}
              onChange={onSi(u.plain('velocity'), (si) =>
                setSim({ railExitVelocityMin: si ?? DEFAULT_SETTINGS.simulation.railExitVelocityMin }),
              )}
            />
            {/* The deployment thresholds. Which one a flight uses depends on the
                  stage's recovery layout: no drogue is single-deployment and uses
                  the first alone; a drogue makes it dual-deployment, and the main
                  is then judged against the next two while the drogue is judged
                  against the last. All of them reach the kernel, not just the
                  tiles. The last three apply only to a stage carrying a device
                  marked as a drogue. */}
            {SPEED_WARNINGS.map((w) => (
              <NumRow
                key={w.key}
                label={t(w.label)}
                hint={t(w.hint)}
                unit={u.sym('velocity')}
                step={u.step('velocity', 1)}
                min={0}
                value={u.toUi('velocity', settings.simulation[w.key])}
                onChange={onSi(u.plain('velocity'), (si) =>
                  setSim({ [w.key]: si ?? DEFAULT_SETTINGS.simulation[w.key] }),
                )}
              />
            ))}
            {/* Everything above this heading decides when a flight warns. What
                  follows changes what the flight does, so it is separated and
                  its hint says which way the number moves. */}
            <div className="pt-1 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
              {t('settings.simModel')}
            </div>
            <Check
              label={t('settings.guideAwareRodClearance')}
              hint={t('settings.guideAwareRodClearanceHint')}
              checked={settings.simulation.guideAwareRodClearance}
              onChange={(v) => setSim({ guideAwareRodClearance: v })}
            />
          </>
        )}

        {tab === 'launch' && (
          <>
            <p className="text-[11px] leading-snug text-ink-faint">{t('settings.launchNote')}</p>
            {/* These are the values a new simulation is seeded from, so a
                  blank one would hand every future simulation a hole. Clearing
                  a required field here keeps what it had rather than storing
                  the blank, which is why no red marker ever shows up in this
                  copy of the panel. */}
            <LaunchPanel
              weatherKey
              launch={settings.launchDefaults}
              onChange={(patch) =>
                update({
                  launchDefaults: withRequiredFrom(
                    { ...settings.launchDefaults, ...patch },
                    DEFAULT_SETTINGS.launchDefaults,
                  ),
                })
              }
            />
          </>
        )}
      </div>
    </Dialog>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-ink-muted">{label}</span>
      <span className="text-sm text-ink-soft">{value}</span>
    </div>
  );
}

interface NumRowProps {
  label: string;
  unit?: string;
  value: number | null;
  step: number;
  min?: number;
  max?: number;
  placeholder?: string;
  /** What the number is for. A threshold with no explanation is only usable by
   *  someone who already knows what it does. */
  hint?: string;
  /** Fires on blur with the typed value, or null for an emptied field. */
  onChange: (v: number | null) => void;
}

/** The field with its hint underneath, when it has one. */
function NumRow(props: NumRowProps) {
  if (!props.hint) return <NumField {...props} />;
  return (
    <div>
      <NumField {...props} />
      <p className="mt-0.5 pr-28 text-[11px] leading-snug text-ink-faint">{props.hint}</p>
    </div>
  );
}

/**
 * One numeric setting. The value is held as a draft while the field has focus and
 * written on blur. Persisted per keystroke it would write the caller's default
 * mid-edit, since every caller substitutes one for an empty field, so backspacing
 * "0.01" to retype it refills the box under the cursor.
 */
function NumField({ label, unit, value, step, min, max, placeholder, onChange }: NumRowProps) {
  return (
    <label className="flex items-center justify-between gap-3">
      <span className="text-sm text-ink-soft">{label}</span>
      <span className="flex items-center gap-1">
        <NumberInput
          value={value}
          onChange={onChange}
          // Written once, on blur: a settings write hits storage.
          commitOnBlur
          step={step}
          min={min}
          max={max}
          placeholder={placeholder}
          ariaLabel={label}
          className="w-24 rounded-md bg-raised px-2 py-1 text-right text-sm text-ink-strong ring-1 ring-line/10 focus:outline-none focus:ring-accent-500"
        />
        {unit && <span className="min-w-8 text-xs text-ink-faint">{unit}</span>}
      </span>
    </label>
  );
}

function ColorRow({
  label,
  value,
  overridden,
  onChange,
  onReset,
  resetTitle,
}: {
  label: string;
  value: string;
  overridden?: boolean;
  onChange: (c: string) => void;
  onReset?: () => void;
  resetTitle?: string;
}) {
  const id = useId();
  return (
    // A row, not one big <label>: the reset button is a second control, and a
    // label may only bind to one.
    <div className="flex items-center justify-between gap-3">
      <label htmlFor={id} className="text-sm text-ink-soft">
        {label}
      </label>
      <span className="flex items-center gap-2">
        <ColorInput
          id={id}
          value={value}
          onCommit={onChange}
          className="h-7 w-10 cursor-pointer rounded-md border border-line/10 bg-raised p-0.5"
        />
        {overridden && onReset && (
          <button
            onClick={onReset}
            title={resetTitle}
            aria-label={resetTitle}
            className="rounded-md bg-raised px-2 py-1 text-xs text-ink-muted ring-1 ring-line/10 hover:bg-elevated"
          >
            ↺
          </button>
        )}
      </span>
    </div>
  );
}
