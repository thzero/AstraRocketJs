import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ComponentNode } from '../../engine/openRocketEngine';
import { useWorkspaceStore } from '../../state/store';
import { componentFormats, type ExportFormat } from '../../services/componentFormats';

const LABEL: Record<ExportFormat, string> = { stl: 'file.stl', obj: 'file.obj', glb: 'file.glb', dxf: 'file.dxf' };

/**
 * Per-component export affordance for a tree row: a small ⬇ button that drops
 * the formats THIS component supports (a nose offers mesh; a fin offers mesh +
 * DXF; a bulkhead offers DXF). Renders nothing for parts with no exportable
 * object (parachute, mass, lug…), which is the whole point — export lives with
 * the parts that can actually produce one.
 */
export function ComponentExportButton({ node }: { node: ComponentNode }) {
  const { t } = useTranslation();
  const exportComponent = useWorkspaceStore((s) => s.exportComponent);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const formats = componentFormats(node.type);
  const id = node.id as string | undefined;
  if (formats.length === 0 || !id) return null;

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={(e) => {
          e.stopPropagation(); // don't also select/deselect the row
          setOpen((o) => !o);
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('file.export')}
        title={t('file.export')}
        className="rounded px-1 text-sm leading-none text-slate-500 hover:bg-slate-700 hover:text-sky-300"
      >
        ⬇
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-1 w-40 overflow-hidden rounded-lg bg-slate-800 py-1 shadow-xl ring-1 ring-white/10"
        >
          {formats.map((f) => (
            <button
              key={f}
              role="menuitem"
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                exportComponent(id, f);
              }}
              className="flex w-full items-center px-3 py-1.5 text-left text-xs font-medium text-slate-200 hover:bg-slate-700"
            >
              {t(LABEL[f])}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
