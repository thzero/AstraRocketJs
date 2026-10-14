import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettings } from '../../state/SettingsProvider';
import { DEFAULT_SETTINGS, SIM_BOUNDS, type SimulationSettings } from '../../services/storage/settings';
import { PART_KEYS, mergePalette } from '../../services/design/partColors';
import { NumberInput } from '../common/NumberInput';
import { DefaultMaterials } from './DefaultMaterials';
import { LaunchPanel } from '../sim/LaunchPanel';
import { withRequiredFrom, type CompleteLaunch } from '../../services/flight/requiredLaunch';
import { IMPERIAL_UNITS, METRIC_UNITS, QUANTITIES, UNITS, unitScope } from '../../prefs/units';
import { useUnits } from '../../prefs/useUnits';
import { onSi } from '../../prefs/entryValue';
import { Check } from '../common/Check';
import { ColorInput } from '../common/ColorInput';
import { canAskWhereToSave } from '../../services/files/saveFile';
import { SPEED_WARNINGS } from '../sim/speedWarnings';
import { EsriKeyField } from '../sim/EsriKeyField';
import { CardGroup } from '../common/CardGroup';
import { THEME_PREFS, type ThemePref } from '../../services/app/theme';
import { seedFromInput } from '../../services/flight/simulations';

/**
 * The Settings dialog's tabs, one component each, so a tab can be rendered and
 * tested on its own. Each reads and writes the settings through the
 * SettingsProvider; the dialog around them owns the tab strip and the reset
 * buttons.
 */

const SPEEDS = [0.25, 0.5, 1, 2, 4];
const speedLabel = (s: number) => (s === 0.25 ? '¼×' : s === 0.5 ? '½×' : `${s}×`);

const RULER_SIDES = ['top', 'bottom', 'left', 'right'] as const;

export function GeneralTab() {
  const { t } = useTranslation();
  const { settings, update } = useSettings();
  return (
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
  );
}

export function UnitsTab() {
  const { t } = useTranslation();
  const { settings, update } = useSettings();
  const overriddenFields = Object.keys(settings.unitOverrides).length;
  return (
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
  );
}

export function ColorsTab() {
  const { t } = useTranslation();
  const { settings, update } = useSettings();
  const palette = mergePalette(settings.partColors);
  const setPart = (key: string, color: string) => update({ partColors: { ...settings.partColors, [key]: color } });
  const resetPart = (key: string) => {
    const p = { ...settings.partColors };
    delete p[key as keyof typeof p];
    update({ partColors: p });
  };
  const setPhase = (k: 'boost' | 'coast' | 'descent', c: string) =>
    update({ phaseColors: { ...settings.phaseColors, [k]: c } });
  return (
    <>
      {/* Part colors apply to the 3D model, which a phone reaches
          through the Sketch tab just as a desktop reaches it through the
          view switch, so this is not gated on width. */}
      <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{t('settings.parts')}</div>
      {PART_KEYS.map((key) => (
        <ColorRow
          key={key}
          label={t(`settings.part.${key}`)}
          value={palette[key]}
          overridden={key in settings.partColors}
          onChange={(c) => setPart(key, c)}
          onReset={() => resetPart(key)}
          resetTitle={t('settings.resetOneFor', { name: t(`settings.part.${key}`) })}
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
      <ColorRow label={t('flight.boost')} value={settings.phaseColors.boost} onChange={(c) => setPhase('boost', c)} />
      <ColorRow label={t('flight.coast')} value={settings.phaseColors.coast} onChange={(c) => setPhase('coast', c)} />
      <ColorRow
        label={t('flight.descent')}
        value={settings.phaseColors.descent}
        onChange={(c) => setPhase('descent', c)}
      />
    </>
  );
}

export function MaterialsTab() {
  const { settings, update } = useSettings();
  return (
    <DefaultMaterials
      defaults={settings.defaultMaterials}
      onChange={(defaultMaterials) => update({ defaultMaterials })}
    />
  );
}

export function PlaybackTab() {
  const { t } = useTranslation();
  const { settings, update } = useSettings();
  return (
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
  );
}

export function SketchTab() {
  const { t } = useTranslation();
  const { settings, update } = useSettings();
  return (
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
  );
}

export function SimTab() {
  const { t } = useTranslation();
  const { settings, update } = useSettings();
  const u = useUnits();
  // Stored in radians like the kernel's field; edited in the user's angle
  // unit through the same FieldUnit the property panel's angle fields use,
  // rather than an inline `* 180 / Math.PI`.
  const angle = u.at(unitScope('settings', 'maxAngleStep'), 'angle');
  const setSim = (patch: Partial<SimulationSettings>) => update({ simulation: { ...settings.simulation, ...patch } });
  return (
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
      <InfoRow label={t('settings.calcMethod')} value={t('settings.calcMethodValue')} />
      <InfoRow label={t('settings.simMethod')} value={t('settings.simMethodValue')} />
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
        onChange={(v) => setSim({ randomSeed: seedFromInput(v) })}
      />
      <div className="pt-1 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
        {t('settings.warnings')}
      </div>
      {/* Settings applies to every design, so its launcher wording names
          neither guide: no rail or rod variant, unlike the per-design
          launch panel. */}
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
          onChange={onSi(u.plain('velocity'), (si) => setSim({ [w.key]: si ?? DEFAULT_SETTINGS.simulation[w.key] }))}
        />
      ))}
      {/* Everything above this heading decides when a flight warns. What
          follows changes what the flight does, so it is separated and
          its hint says which way the number moves. */}
      <div className="pt-1 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
        {t('settings.simModel')}
      </div>
      {/* Neutral launcher wording, as for the rail exit speed above. */}
      <Check
        label={t('settings.guideAwareRodClearance')}
        hint={t('settings.guideAwareRodClearanceHint')}
        checked={settings.simulation.guideAwareRodClearance}
        onChange={(v) => setSim({ guideAwareRodClearance: v })}
      />
    </>
  );
}

export function LaunchTab() {
  const { t } = useTranslation();
  const { settings, update } = useSettings();
  return (
    <>
      <p className="text-[11px] leading-snug text-ink-faint">{t('settings.launchNote')}</p>
      {/* The launch panel's own gap between cards, so the map card below
          it does not sit closer than they do to each other. */}
      <div className="space-y-4">
        {/* These are the values a new simulation is seeded from, so a
            blank one would hand every future simulation a hole. Clearing
            a required field here keeps what it had rather than storing
            the blank, which is why no red marker ever shows up in this
            copy of the panel. */}
        <LaunchDefaults launch={settings.launchDefaults} onSave={(launchDefaults) => update({ launchDefaults })} />
        <CardGroup title={t('map.cardTitle')}>
          <EsriKeyField />
        </CardGroup>
      </div>
    </>
  );
}

/**
 * The launch defaults, held as a draft while a field is being typed in and
 * written when the panel commits (a field's blur, or at once for a discrete
 * control). A settings write hits storage, and a write per keystroke would also
 * store every intermediate prefix as the default for new simulations.
 */
function LaunchDefaults({ launch, onSave }: { launch: CompleteLaunch; onSave: (l: CompleteLaunch) => void }) {
  const [draft, setDraft] = useState<CompleteLaunch | null>(null);
  const shown = draft ?? launch;
  const pending = useRef<CompleteLaunch | null>(null);
  const save = useRef(onSave);
  useEffect(() => {
    save.current = onSave;
  });
  const flush = () => {
    if (!pending.current) return;
    save.current(pending.current);
    pending.current = null;
    setDraft(null);
  };
  // Closing the dialog mid-edit unmounts the field without a blur.
  useEffect(
    () => () => {
      if (pending.current) save.current(pending.current);
    },
    [],
  );
  return (
    <LaunchPanel
      weatherKey
      launch={shown}
      onChange={(patch) => {
        // From the pending draft, not the rendered one: two patches can land
        // before the next render.
        const next = withRequiredFrom({ ...(pending.current ?? shown), ...patch }, DEFAULT_SETTINGS.launchDefaults);
        pending.current = next;
        setDraft(next);
      }}
      onCommit={flush}
    />
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
