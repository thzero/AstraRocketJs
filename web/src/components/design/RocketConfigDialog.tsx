import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DESIGN_TYPES } from '../../engine/openRocketEngine';
import { useWorkspaceStore } from '../../state/store';
import { useFocusTrap } from '../common/useFocusTrap';

/**
 * The design-level "Rocket configuration" editor (OpenRocket's dialog of the
 * same name): design name, designer, design type, comments and revision history.
 * These live on the RocketTree and round-trip through .ork import/export. Applied
 * as one undoable step via {@link useWorkspaceStore.updateDesignMeta}.
 */
export function RocketConfigDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const tree = useWorkspaceStore((s) => s.tree);
  const updateDesignMeta = useWorkspaceStore((s) => s.updateDesignMeta);
  const panelRef = useFocusTrap<HTMLDivElement>(open);

  const [name, setName] = useState('');
  const [designer, setDesigner] = useState('');
  const [designType, setDesignType] = useState<string>('original');
  const [comment, setComment] = useState('');
  const [revision, setRevision] = useState('');

  // Seed the fields from the live design each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setName(tree.name ?? '');
    setDesigner(tree.designer ?? '');
    setDesignType(tree.designType ?? 'original');
    setComment(tree.comment ?? '');
    setRevision(tree.revision ?? '');
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  // Keep an unrecognised imported design-type token selectable so OK can't drop it.
  const typeOptions = (DESIGN_TYPES as readonly string[]).includes(designType)
    ? DESIGN_TYPES
    : [designType, ...DESIGN_TYPES];
  const typeLabel = (tk: string) =>
    (DESIGN_TYPES as readonly string[]).includes(tk) ? t(`config.type_${tk}`) : tk;

  const clean = (s: string) => (s.trim() ? s.trim() : undefined);
  const save = () => {
    updateDesignMeta({
      name: name.trim() || undefined,
      designer: clean(designer),
      designType,
      comment: clean(comment),
      revision: clean(revision),
    });
    onClose();
  };

  const label = 'w-28 shrink-0 pt-1.5 text-xs font-medium uppercase tracking-wide text-slate-400';
  const field =
    'min-w-0 flex-1 rounded-md bg-slate-800 px-2 py-1.5 text-sm text-slate-100 ring-1 ring-white/10 focus:outline-none focus:ring-sky-500';

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div
        ref={panelRef}
        className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl bg-slate-900 ring-1 ring-white/10"
        role="dialog"
        aria-modal="true"
        aria-label={t('config.title')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-white/10 p-4">
          <h2 className="text-lg font-semibold text-slate-100">{t('config.title')}</h2>
          <button
            onClick={onClose}
            aria-label={t('common.cancel')}
            className="shrink-0 rounded-lg bg-slate-800 px-2 py-1 text-sm text-slate-300 ring-1 ring-white/10 hover:bg-slate-700"
          >
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          <div className="flex gap-3">
            <label className={label} htmlFor="cfg-name">
              {t('config.name')}
            </label>
            <input id="cfg-name" value={name} onChange={(e) => setName(e.target.value)} className={field} autoFocus />
          </div>
          <div className="flex gap-3">
            <label className={label} htmlFor="cfg-designer">
              {t('config.designer')}
            </label>
            <input
              id="cfg-designer"
              value={designer}
              onChange={(e) => setDesigner(e.target.value)}
              className={field}
            />
          </div>
          <div className="flex gap-3">
            <label className={label} htmlFor="cfg-type">
              {t('config.designType')}
            </label>
            <select id="cfg-type" value={designType} onChange={(e) => setDesignType(e.target.value)} className={field}>
              {typeOptions.map((tk) => (
                <option key={tk} value={tk}>
                  {typeLabel(tk)}
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-3">
            <label className={label} htmlFor="cfg-comment">
              {t('config.comments')}
            </label>
            <textarea
              id="cfg-comment"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={5}
              className={`${field} resize-y`}
            />
          </div>
          <div className="flex gap-3">
            <label className={label} htmlFor="cfg-revision">
              {t('config.revision')}
            </label>
            <textarea
              id="cfg-revision"
              value={revision}
              onChange={(e) => setRevision(e.target.value)}
              rows={3}
              className={`${field} resize-y`}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-white/10 p-4">
          <button
            onClick={onClose}
            className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-slate-200 ring-1 ring-white/10 hover:bg-slate-700"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={save}
            className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500"
          >
            {t('config.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
