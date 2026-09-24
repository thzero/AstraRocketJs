import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { ComponentNode } from '../../engine/openRocketEngine';
import { colorForType, mergePalette } from '../../services/partColors';
import { useSettings } from '../../state/SettingsProvider';

/**
 * How the part is DRAWN, as against what it is.
 *
 * Color is the only thing in here, and it used to sit in the Part section
 * beside the name and the catalog picker. It does not belong with them: those
 * two say what the part is and what it is made from, and both are written to
 * the `.ork`; this one is a view preference that changes nothing about the
 * rocket. A section of its own says so, and leaves room for the other
 * appearance settings (finish, texture) whenever they land.
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

  return (
    <div className="space-y-3 border-t border-white/5 pt-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">{t('prop.appearance')}</h3>
      <label className="flex items-center justify-between gap-3">
        <span className="text-xs text-slate-400">{t('prop.color')}</span>
        <span className="flex items-center gap-2">
          <input
            type="color"
            // The swatch always shows what is DRAWN, so with no color of its
            // own it shows the one this part type gets from the palette. That
            // is why the reset button appears only when the node carries one:
            // it is the only way to tell "set to this" from "defaulted to this".
            value={typeof node.color === 'string' ? node.color : colorForType(node.type, palette)}
            onChange={(e) => onChange({ color: e.target.value })}
            onBlur={onCommit}
            className="h-7 w-10 cursor-pointer rounded-md border border-white/10 bg-slate-800 p-0.5"
          />
          {typeof node.color === 'string' && (
            <button
              onClick={() => onCommitChange({ color: undefined })}
              title={t('prop.resetColor')}
              className="rounded-md bg-slate-800 px-2 py-1 text-xs text-slate-400 ring-1 ring-white/10 hover:bg-slate-700"
            >
              ↺
            </button>
          )}
        </span>
      </label>
    </div>
  );
}
