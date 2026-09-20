import { useState } from 'react';
import { useWorkspaceStore } from '../../state/store';
import { ComponentTree } from './ComponentTree';
import { ScaleDialog } from './ScaleDialog';

/** Design tab, left column: the component tree and the Scale dialog it
 *  launches. The selected part's editor is the opposite column
 *  ({@link PropertyPane}), not stacked underneath this; the design's name and
 *  its configuration dialog head the center pane (`LoadedBanner`). */
export function TreePanel() {
  const tree = useWorkspaceStore((s) => s.tree);
  const selectedId = useWorkspaceStore((s) => s.selectedId);
  const onSelect = useWorkspaceStore((s) => s.setSelectedId);
  const onAdd = useWorkspaceStore((s) => s.addPartToTree);
  const onAddStage = useWorkspaceStore((s) => s.addStageToTree);
  const [scaleOpen, setScaleOpen] = useState(false);

  return (
    <div className="space-y-4 p-2">
      <ComponentTree
        tree={tree}
        selectedId={selectedId}
        onSelect={onSelect}
        onAdd={onAdd}
        onScale={() => setScaleOpen(true)}
        onAddStage={onAddStage}
      />
      {/* Mounted only while open: the factor resets by unmount. */}
      {scaleOpen && <ScaleDialog onClose={() => setScaleOpen(false)} />}
    </div>
  );
}
