import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ComponentNode } from '../../engine/openRocketEngine';
import { NumberInput } from '../common/NumberInput';
import { useUnits } from '../../prefs/useUnits';
import { unitScope } from '../../prefs/units';
import { freeformPoints } from '../../tree/position';
import { scaleComponent } from '../../services/design/componentActions';
import { FinImageError, finPointsCsv, finPointsFromImage } from '../../services/design/finImage';
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
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new FinImageError('noOutline');
      ctx.drawImage(bitmap, 0, 0);
      const points = finPointsFromImage(ctx.getImageData(0, 0, canvas.width, canvas.height));
      apply((tree) => updateNode(tree, id, { points } as Partial<ComponentNode>));
    } catch (e) {
      // One message for both failures the user can act on: the image has no dark
      // shape on its bottom edge, or it has one the tracer cannot close.
      setError(e instanceof FinImageError ? t('freeform.badImage') : t('freeform.imageUnreadable'));
    }
  };

  return (
    <div className="space-y-2 border-t border-white/5 pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1 text-xs text-slate-400">
          {t('freeform.scaleFin')}
          <NumberInput
            value={factor}
            onChange={(v) => setFactor(v ?? 1)}
            step={0.1}
            min={0}
            ariaLabel={t('freeform.scaleFactor')}
            className="w-16 rounded bg-slate-800 px-1.5 py-0.5 text-right tabular-nums text-slate-100 ring-1 ring-white/10 focus:outline-none focus:ring-sky-500"
          />
        </label>
        <button
          onClick={() => apply((tree) => scaleComponent(tree, id, factor))}
          disabled={!(factor > 0) || factor === 1}
          title={t('freeform.scaleFinTip')}
          className="rounded-md bg-slate-800 px-2 py-1 text-xs text-slate-300 ring-1 ring-white/10 hover:bg-slate-700 disabled:cursor-not-allowed disabled:text-slate-600 disabled:hover:bg-slate-800"
        >
          {t('freeform.applyScale')}
        </button>
        <button
          onClick={imageFile.pick}
          title={t('freeform.importHint')}
          className="rounded-md bg-slate-800 px-2 py-1 text-xs text-slate-300 ring-1 ring-white/10 hover:bg-slate-700"
        >
          {t('freeform.importImage')}
        </button>
        <button
          onClick={exportCsv}
          className="rounded-md bg-slate-800 px-2 py-1 text-xs text-slate-300 ring-1 ring-white/10 hover:bg-slate-700"
        >
          {t('freeform.exportCsv')}
        </button>
        {imageFile.input}
      </div>
      <p className="text-[11px] leading-snug text-slate-500">{t('freeform.importHint')}</p>
      {error && <p className="text-[11px] leading-snug text-amber-400">{error}</p>}
    </div>
  );
}
