import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ComponentNode } from '../../engine/openRocketEngine';
import { NumberInput } from '../common/NumberInput';
import { useUnits } from '../../prefs/useUnits';
import { unitScope } from '../../prefs/units';
import { freeformPoints } from '../../tree/position';
import { SCALE_MAX } from '../../tree/scaleRocket';
import { scaleComponent } from '../../services/design/componentActions';
import { FinImageError, finPointsCsv, finPointsFromImage, traceSize } from '../../services/design/finImage';
import { download, exportFilename } from '../../services/files/saveFile';
import { CSV_MIME } from '../../services/exports/csvExport';
import { partLabel } from '../../i18n/format';
import { updateNode } from '../../services/design/treeEdit';
import { selectDesignName, useWorkspaceStore } from '../../state/store';
import { useFilePick } from '../common/useFilePick';

/**
 * The three things OpenRocket's freeform editor does besides dragging points:
 * **Scale fin**, **Import from image** and **Export CSV**.
 *
 * Its own component rather than part of `FreeformFinEditor`, which is a pure
 * controlled view over a point list: two of these three need the node and the
 * store, because scaling a fin also scales its wall, tab and fillet, and an
 * import replaces the whole outline as one undo step.
 */
export function FreeformFinActions({ node }: { node: ComponentNode }) {
  const { t } = useTranslation();
  const u = useUnits();
  const apply = useWorkspaceStore((s) => s.applyTreeAction);
  const designName = useWorkspaceStore(selectDesignName);
  const [factor, setFactor] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const id = node.id as string;
  const ptX = u.at(unitScope('freeform', 'x'), 'length');

  // Cleared after each pick, so picking the same file twice fires again: how
  // anyone retrying after a threshold tweak expects it to behave.
  const imageFile = useFilePick({
    accept: 'image/*',
    label: t('freeform.importImage'),
    onFile: (file) => void importImage(file),
  });

  const exportCsv = () => {
    download(
      exportFilename([designName, partLabel(t, node), 'points'], 'csv'),
      finPointsCsv(freeformPoints(node), ptX.sym, ptX.toUi),
      CSV_MIME,
    );
  };

  const importImage = async (file: File) => {
    setError(null);
    try {
      // Resized to the tracing size before it reaches a canvas: a full-size
      // canvas for a phone photo can pass the browser's canvas area limit and
      // come back unusable. Nearest-neighbor, for the reason finImage samples
      // that way: the next step is a luma threshold. Each bitmap is closed as
      // soon as it is drawn, since a decoded photo is hundreds of megabytes.
      const full = await createImageBitmap(file);
      // Read before any close: a closed bitmap reports a size of 0 x 0.
      const { width: fullW, height: fullH } = full;
      const size = traceSize(fullW, fullH);
      let bitmap = full;
      if (size.width !== fullW || size.height !== fullH) {
        try {
          bitmap = await createImageBitmap(full, {
            resizeWidth: size.width,
            resizeHeight: size.height,
            resizeQuality: 'pixelated',
          });
        } finally {
          full.close();
        }
      }
      // One traced pixel is this many source pixels, and one source pixel is
      // one millimeter.
      const sx = fullW / size.width;
      const sy = fullH / size.height;
      let pixels: ImageData;
      try {
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new FinImageError('noOutline');
        ctx.drawImage(bitmap, 0, 0);
        pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
      } finally {
        bitmap.close();
      }
      const traced = finPointsFromImage(pixels);
      const points = sx === 1 && sy === 1 ? traced : traced.map(([x, y]) => [x * sx, y * sy] as [number, number]);
      apply((tree) => updateNode(tree, id, { points }));
    } catch (e) {
      // One message for both failures the user can act on: the image has no dark
      // shape on its bottom edge, or it has one the tracer cannot close.
      setError(e instanceof FinImageError ? t('freeform.badImage') : t('freeform.imageUnreadable'));
    }
  };

  return (
    <div className="space-y-2 border-t border-line/5 pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1 text-xs text-ink-muted">
          {t('freeform.scaleFin')}
          <NumberInput
            value={factor}
            onChange={(v) => setFactor(v ?? 1)}
            step={0.1}
            min={0}
            max={SCALE_MAX}
            ariaLabel={t('freeform.scaleFactor')}
            className="w-16 rounded bg-raised px-1.5 py-0.5 text-right tabular-nums text-ink-strong ring-1 ring-line/10 focus:outline-none focus:ring-accent-500"
          />
        </label>
        <button
          onClick={() => apply((tree) => scaleComponent(tree, id, factor))}
          disabled={!(factor > 0) || factor === 1}
          title={t('freeform.scaleFinTip')}
          className="rounded-md bg-raised px-2 py-1 text-xs text-ink-soft ring-1 ring-line/10 hover:bg-elevated disabled:cursor-not-allowed disabled:text-ink-dim disabled:hover:bg-raised"
        >
          {t('freeform.applyScale')}
        </button>
        <button
          onClick={imageFile.pick}
          title={t('freeform.importHint')}
          className="rounded-md bg-raised px-2 py-1 text-xs text-ink-soft ring-1 ring-line/10 hover:bg-elevated"
        >
          {t('freeform.importImage')}
        </button>
        <button
          onClick={exportCsv}
          className="rounded-md bg-raised px-2 py-1 text-xs text-ink-soft ring-1 ring-line/10 hover:bg-elevated"
        >
          {t('freeform.exportCsv')}
        </button>
        {imageFile.input}
      </div>
      <p className="text-[11px] leading-snug text-ink-faint">{t('freeform.importHint')}</p>
      {error && <p className="text-[11px] leading-snug text-warn-400">{error}</p>}
    </div>
  );
}
