import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ComponentNode, ComponentType } from '../../engine/openRocketEngine';
import { colorForType, mergePalette } from '../../services/design/partColors';
import {
  alphaOf,
  defaultAppearance,
  INSIDE_COLOR_TYPES,
  opacityOf,
  readAppearance,
  SIDED_TYPES,
  type PartAppearance,
} from '../../services/design/appearance';
import { hexOf, parseHexColor } from '../../services/design/colorHex';
import { useSettings } from '../../state/SettingsProvider';
import { PropSection } from './PropSection';
import { ColorInput } from '../common/ColorInput';
import { Check } from '../common/Check';
import { NumberInput } from '../common/NumberInput';
import { Segmented } from '../common/Segmented';

/**
 * How the part is drawn, as against what it is: desktop's Appearance tab
 * without the texture. Nothing here reaches the simulation.
 *
 * Two settings, as on the desktop. The figure style is the color the 2D views
 * draw the part in (`<color>`). The appearance is what the 3D views render
 * (`<appearance>`): a paint color, its shine and its opacity, and on a part
 * with an inside (a tube, a cone, a fin set) a second one for the inside, used
 * when the two are set apart, with a choice of which the edges take.
 *
 * Below the part's own sections and above Overrides and Comment. Not rendered
 * for a stage, which is the container its parts are drawn in and has no
 * surface of its own.
 */
export function AppearanceSection({
  node,
  onCommitChange,
}: {
  node: ComponentNode;
  /**
   * Patch and close the undo entry in one shot. Every control here lands once:
   * a color when its picker closes, a number on blur, a slider on release.
   */
  onCommitChange: (patch: Partial<ComponentNode>) => void;
}) {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const palette = useMemo(() => mergePalette(settings.partColors), [settings.partColors]);
  const hasInside = INSIDE_COLOR_TYPES.has(node.type);
  const sided = SIDED_TYPES.has(node.type);
  const separate = hasInside && node['separateInsideOutside'] === true;
  const [surface, setSurface] = useState<'outside' | 'inside'>('outside');
  // The inside tab exists only while the two are set apart.
  const editing = separate ? surface : 'outside';
  const sideName = (s: 'outside' | 'inside') =>
    sided
      ? t(s === 'outside' ? 'prop.leftSide' : 'prop.rightSide')
      : t(s === 'outside' ? 'prop.outside' : 'prop.inside');

  const figureColor = typeof node.color === 'string' ? node.color : undefined;
  const key = editing === 'inside' ? 'insideAppearance' : 'appearance';
  const own = readAppearance(node[key]);
  // What the part is drawn with when it has no appearance of its own; the
  // controls show it, disabled, as desktop does.
  const shown = own ?? defaultAppearance(node.type, palette);
  // Clearing "Use default" starts from what was on screen, so the part does
  // not change until something is edited.
  const set = (patch: Partial<PartAppearance>) => onCommitChange({ [key]: { ...shown, ...patch } });

  return (
    <PropSection title={t('prop.appearance')}>
      <SubHeading title={t('prop.figureStyle')} hint={t('prop.figureStyleHint')} />
      <Check
        checked={figureColor === undefined}
        onChange={(v) => onCommitChange({ color: v ? undefined : figureDefault(node.type) })}
        label={t('prop.useDefaultColor')}
        className="text-xs text-ink-muted"
      />
      <ColorRow
        label={t('prop.componentColor')}
        value={figureColor ?? figureDefault(node.type)}
        disabled={figureColor === undefined}
        onCommit={(color) => onCommitChange({ color })}
      />

      <SubHeading title={t('prop.appearance3d')} hint={t('prop.appearance3dHint')} />
      {hasInside && (
        <>
          <Check
            checked={separate}
            onChange={(v) => onCommitChange({ separateInsideOutside: v || undefined })}
            label={t(sided ? 'prop.separateLeftRight' : 'prop.separateInsideOutside')}
            className="text-xs text-ink-muted"
            align="start"
          />
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-ink-muted">{t('prop.edgesAppearance')}</span>
            <Segmented
              options={['outside', 'inside'] as const}
              value={node['edgesSameAsInside'] === true ? 'inside' : 'outside'}
              onChange={(v) => onCommitChange({ edgesSameAsInside: v === 'inside' || undefined })}
              fmt={sideName}
              disabled={!separate}
            />
          </div>
          {separate && (
            <Segmented options={['outside', 'inside'] as const} value={surface} onChange={setSurface} fmt={sideName} />
          )}
        </>
      )}
      <Check
        checked={!own}
        onChange={(v) => onCommitChange({ [key]: v ? undefined : shown })}
        label={t('prop.useDefault')}
        className="text-xs text-ink-muted"
      />
      <ColorRow label={t('prop.color')} value={shown.paint} disabled={!own} onCommit={(paint) => set({ paint })} />
      <PercentRow label={t('prop.shine')} value={shown.shine} disabled={!own} onCommit={(shine) => set({ shine })} />
      <PercentRow
        label={t('prop.opacity')}
        value={opacityOf(shown)}
        disabled={!own}
        onCommit={(opacity) => set({ alpha: alphaOf(opacity) })}
      />
    </PropSection>
  );
}

/**
 * The figure color a part with none of its own is drawn in: the 2D side view's
 * fill for it. Where no stylesheet is loaded, the part's 3D palette color.
 */
function figureDefault(type: ComponentType): string {
  const name = ['nosecone', 'bodytube', 'transition'].includes(type) ? 'sch-shell' : 'sch-part';
  const raw =
    typeof document === 'undefined' ? '' : getComputedStyle(document.documentElement).getPropertyValue(`--c-${name}`);
  const n = parseHexColor(raw.trim());
  return n === null ? colorForType(type) : hexOf(n);
}

function SubHeading({ title, hint }: { title: string; hint: string }) {
  return (
    <div>
      <h4 className="text-xs font-medium text-ink-soft">{title}</h4>
      <p className="text-[11px] text-ink-muted">{hint}</p>
    </div>
  );
}

/**
 * A color: the swatch and its hex, as desktop pairs them. The swatch commits
 * when its picker closes (ColorInput); the hex box on blur or Enter, and a box
 * that does not hold a color goes back to the one in use.
 */
function ColorRow({
  label,
  value,
  disabled,
  onCommit,
}: {
  label: string;
  value: string;
  disabled?: boolean;
  onCommit: (color: string) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [draft, setDraft] = useState(value);
  // A new color from elsewhere (the swatch, an undo) replaces the draft.
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setDraft(value);
  }
  const commitDraft = () => {
    const n = parseHexColor(draft);
    if (n === null || hexOf(n) === value) setDraft(value);
    else onCommit(hexOf(n));
  };
  return (
    // Only the controls dim when disabled: a faded label would fall below
    // the text contrast floor, and the inputs' own state already says so.
    <div className="flex items-center justify-between gap-3">
      <label htmlFor={id} className="text-xs text-ink-muted">
        {label}
      </label>
      <span className="flex items-center gap-2">
        <ColorInput
          id={id}
          value={value}
          disabled={disabled}
          onCommit={onCommit}
          className="h-7 w-10 cursor-pointer rounded-md border border-line/10 bg-raised p-0.5 disabled:cursor-default disabled:opacity-40"
        />
        <input
          type="text"
          value={draft}
          disabled={disabled}
          aria-label={`${label}, ${t('prop.hexColor')}`}
          placeholder={t('prop.hexColor')}
          spellCheck={false}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitDraft}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitDraft();
          }}
          className="w-20 rounded-md bg-raised px-2 py-1 font-mono text-xs text-ink-strong ring-1 ring-line/10 focus:outline-none focus:ring-accent-500 disabled:bg-raised/50 disabled:text-ink-muted"
        />
      </span>
    </div>
  );
}

/** Tenths of a percent: what the box shows of a 0-1 value. */
const pctOf = (v: number) => Math.round(v * 1000) / 10;

/**
 * A 0-1 value as a percentage, as desktop's relative unit shows shine and
 * opacity: a slider and a box. The slider previews while dragged and commits
 * on release; the box commits on blur, and only when its number changed, so
 * a value the box rounds is never written back rounded.
 */
function PercentRow({
  label,
  value,
  disabled,
  onCommit,
}: {
  label: string;
  value: number;
  disabled?: boolean;
  onCommit: (v: number) => void;
}) {
  const [drag, setDrag] = useState<number | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  const latest = useRef({ value, onCommit });
  useLayoutEffect(() => {
    latest.current = { value, onCommit };
  });
  // React's onChange on a range input is the native `input` event, which fires
  // on every step of a drag; the native `change` fires once, on release.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const commit = () => {
      const v = Number(el.value) / 100;
      setDrag(null);
      if (pctOf(v) !== pctOf(latest.current.value)) latest.current.onCommit(v);
    };
    el.addEventListener('change', commit);
    return () => el.removeEventListener('change', commit);
  }, []);
  const shown = drag ?? value;
  return (
    <div className="flex items-center justify-between gap-3">
      {/* The box is the control the label names; the slider is a second way
          to move it, kept out of the tab order and the accessibility tree. */}
      <span className="text-xs text-ink-muted">{label}</span>
      <span className="flex items-center gap-2">
        <input
          ref={ref}
          type="range"
          min={0}
          max={100}
          step={1}
          value={Math.round(shown * 100)}
          disabled={disabled}
          aria-hidden
          tabIndex={-1}
          onChange={(e) => setDrag(Number(e.target.value) / 100)}
          className="w-24 accent-accent-500 disabled:opacity-40"
        />
        <NumberInput
          value={pctOf(shown)}
          min={0}
          max={100}
          step={1}
          disabled={disabled}
          commitOnBlur
          ariaLabel={label}
          onChange={(v) => {
            if (v !== null && v !== pctOf(value)) onCommit(v / 100);
          }}
          className="w-16 rounded-md bg-raised px-2 py-1 text-right text-sm text-ink-strong ring-1 ring-line/10 focus:outline-none focus:ring-accent-500 disabled:bg-raised/50 disabled:text-ink-muted"
        />
        <span className="text-xs text-ink-faint">%</span>
      </span>
    </div>
  );
}
