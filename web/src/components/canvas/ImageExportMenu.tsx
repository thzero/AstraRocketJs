import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IMAGE_WIDTHS, type ImageFormat } from '../../services/exports/schematicExport.js';
import { useMenuPopover } from '../common/useMenuPopover';

/** Per-export toggles carried alongside the format/width choice. Nothing here
 *  is persisted: the picker is reopened for every export anyway. */
export interface ImageExportOptions {
  /** Reframe the camera so the subject fills the exported frame (3D only). */
  fit: boolean;
}

/**
 * Format × resolution picker for the 2D/3D image exports. One trigger button,
 * a small popover with a PNG row and a JPG row of width presets. Shared by TreeSchematic (2D
 * rasterize) and Rocket3D (hi-res re-render snapshot) so the two views offer
 * the identical picker. The 3D view additionally opts into the "fit rocket to
 * frame" toggle it needs to spend its megapixels on the rocket.
 */
export function ImageExportMenu({
  label,
  title,
  onPick,
  fitOption,
}: {
  label: string;
  title: string;
  onPick: (format: ImageFormat, widthPx: number, opts: ImageExportOptions) => void;
  /** Show the "Fit rocket to frame" checkbox. The 2D export has no camera (it
   *  already draws the whole rocket at identity view), so only the 3D view
   *  opts in, and its `opts.fit` is forced false everywhere else. */
  fitOption?: boolean;
}) {
  const { t } = useTranslation();
  const { open, toggle, close, wrapRef, triggerRef } = useMenuPopover();
  // Default on: an export that spends most of its pixels on background is
  // rarely what was wanted. Unchecked, the export keeps the on-screen framing.
  const [fit, setFit] = useState(true);

  const widthLabel = (w: number) => (w >= 7680 ? '8K' : w >= 3840 ? '4K' : 'HD');
  const formatName = (fmt: ImageFormat) => (fmt === 'png' ? 'PNG' : 'JPG');

  return (
    <div ref={wrapRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        className="file-btn"
        title={title}
        aria-haspopup="menu"
        aria-expanded={open}
        ref={triggerRef}
        onClick={toggle}
      >
        {label}
      </button>
      {open && (
        <div
          // A `role="menu"` whose children are plain buttons is an invalid
          // structure: screen readers announce "menu, 0 items".
          role="menu"
          style={{
            position: 'absolute',
            right: 0,
            top: '100%',
            marginTop: 4,
            zIndex: 30,
            background: 'var(--surface-1)',
            border: '1px solid var(--border, #444)',
            borderRadius: 6,
            padding: 6,
            boxShadow: '0 4px 14px rgba(0,0,0,0.35)',
            display: 'grid',
            gridTemplateColumns: 'auto repeat(3, auto)',
            gap: 4,
            whiteSpace: 'nowrap',
            fontSize: 12,
          }}
        >
          {(['png', 'jpeg'] as ImageFormat[]).map((fmt) => [
            // The row label is for the eye. Each item names its own format, so
            // the six read as "PNG HD" and "JPG HD" rather than "HD" twice.
            <span
              key={`${fmt}-label`}
              aria-hidden="true"
              style={{ alignSelf: 'center', padding: '0 6px', color: 'var(--text-muted, #999)' }}
            >
              {formatName(fmt)}
            </span>,
            ...IMAGE_WIDTHS.map((w) => (
              <button
                key={`${fmt}-${w}`}
                role="menuitem"
                className="file-btn"
                title={`${w} px wide`}
                aria-label={`${formatName(fmt)} ${widthLabel(w)}, ${w} px`}
                onClick={() => {
                  close();
                  onPick(fmt, w, { fit: !!fitOption && fit });
                }}
              >
                {widthLabel(w)}
              </button>
            )),
          ])}
          {fitOption && (
            // Spans the whole grid under the format rows: it modifies every
            // button above it, so it reads as a setting, not a fourth width.
            <label
              style={{
                gridColumn: '1 / -1',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                marginTop: 2,
                paddingTop: 5,
                borderTop: '1px solid var(--border, #444)',
                color: 'var(--text-muted, #999)',
                cursor: 'pointer',
              }}
              title={t('export.fitFrameHint')}
            >
              <input
                type="checkbox"
                role="menuitemcheckbox"
                aria-checked={fit}
                checked={fit}
                onChange={(e) => setFit(e.target.checked)}
              />
              {t('export.fitFrame')}
            </label>
          )}
        </div>
      )}
    </div>
  );
}
