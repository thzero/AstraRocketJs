import { useTranslation } from 'react-i18next';
import type { ComponentNode } from '../../engine/openRocketEngine';
import { fireAction } from '../../state/fireAction';
import { useWorkspaceStore } from '../../state/store';
import { componentFormats, type ExportFormat } from '../../services/files/componentFormats';
import { useMenuPopover } from '../common/useMenuPopover';

const LABEL: Record<ExportFormat, string> = {
  stl: 'file.stl',
  obj: 'file.obj',
  glb: 'file.glb',
  '3mf': 'file.3mf',
  dxf: 'file.dxf',
};

/**
 * Per-component export affordance for a tree row: a small ⬇ button that drops
 * the formats THIS component supports (a nose offers mesh; a fin offers mesh +
 * DXF; a bulkhead offers DXF). Renders nothing for parts with no exportable
 * object (parachute, mass, lug…), so export sits only with the parts that can
 * produce one.
 */
export function ComponentExportButton({ node }: { node: ComponentNode }) {
  const { t } = useTranslation();
  const exportComponent = useWorkspaceStore((s) => s.exportComponent);
  const { open, toggle, close, wrapRef, triggerRef } = useMenuPopover();

  const formats = componentFormats(node.type);
  const id = node.id as string | undefined;
  if (formats.length === 0 || !id) return null;

  return (
    <div ref={wrapRef} className="relative shrink-0">
      <button
        ref={triggerRef}
        onClick={(e) => {
          e.stopPropagation(); // don't also select/deselect the row
          toggle();
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('file.export')}
        title={t('file.export')}
        className="rounded px-1 text-sm leading-none text-ink-faint hover:bg-elevated hover:text-accent-300"
      >
        ⬇
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-1 w-40 overflow-hidden rounded-lg bg-raised py-1 shadow-xl ring-1 ring-line/10"
        >
          {formats.map((f) => (
            <button
              key={f}
              role="menuitem"
              onClick={(e) => {
                e.stopPropagation();
                close();
                fireAction(exportComponent(id, f));
              }}
              className="flex w-full items-center px-3 py-1.5 text-left text-xs font-medium text-ink hover:bg-elevated"
            >
              {t(LABEL[f])}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
