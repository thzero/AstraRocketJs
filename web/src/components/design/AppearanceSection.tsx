import { useId, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { ComponentNode } from '../../engine/openRocketEngine';
import { colorForType, mergePalette } from '../../services/design/partColors';
import { useSettings } from '../../state/SettingsProvider';
import { PropSection } from './PropSection';

/**
 * How the part is drawn, as against what it is.
 *
 * Color is the only thing in here, and it does not belong in the Part section with
 * the name and the catalog picker: those say what the part is and what it is made
 * from, and both are written to the `.ork`, while this is a view preference that
 * changes nothing about the rocket. A section of its own says so, and leaves room
 * for the other appearance settings (finish, texture) whenever they land.
 *
 * Second to last on every part, directly above Overrides, for the same reason
 * Overrides is last: it is read far less often than anything describing the
 * part, so it sits below all of it and above the one thing read less still.
 *
 * Not rendered for a stage, which has no color of its own: a stage is the
 * container its parts are drawn in.
 */
export function AppearanceSection({
  node,
  onChange,
  onCommit,
  onCommitChange,
}: {
  node: ComponentNode;
  onChange: (patch: Partial<ComponentNode>) => void;
  onCommit?: () => void;
  /** Patch and close the undo entry in one shot (the reset is discrete). */
  onCommitChange: (patch: Partial<ComponentNode>) => void;
}) {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const palette = useMemo(() => mergePalette(settings.partColors), [settings.partColors]);
  const colorId = useId();

  return (
    <PropSection title={t('prop.appearance')}>
      {/* A row, not one big <label>: the reset button is a second control, and a
          label may only bind to one. */}
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={colorId} className="text-xs text-ink-muted">
          {t('prop.color')}
        </label>
        <span className="flex items-center gap-2">
          <input
            id={colorId}
            type="color"
            // The swatch always shows what is drawn, so with no color of its
            // own it shows the one this part type gets from the palette. That
            // is why the reset button appears only when the node carries one:
            // it is the only way to tell "set to this" from "defaulted to this".
            value={typeof node.color === 'string' ? node.color : colorForType(node.type, palette)}
            onChange={(e) => onChange({ color: e.target.value })}
            onBlur={onCommit}
            className="h-7 w-10 cursor-pointer rounded-md border border-line/10 bg-raised p-0.5"
          />
          {typeof node.color === 'string' && (
            <button
              onClick={() => onCommitChange({ color: undefined })}
              title={t('prop.resetColor')}
              aria-label={t('prop.resetColor')}
              className="rounded-md bg-raised px-2 py-1 text-xs text-ink-muted ring-1 ring-line/10 hover:bg-elevated"
            >
              ↺
            </button>
          )}
        </span>
      </div>
    </PropSection>
  );
}
