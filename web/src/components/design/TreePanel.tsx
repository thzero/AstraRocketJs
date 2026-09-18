import { useState } from 'react';
import { useWorkspaceStore } from '../../state/store';
import { ComponentTree } from './ComponentTree';
import { ScaleDialog } from './ScaleDialog';
import { RocketConfigDialog } from './RocketConfigDialog';

/** Design tab, left column: the component tree and the two design-wide dialogs
 *  it launches. The selected part's editor is the opposite column
 *  ({@link PropertyPane}), not stacked underneath this. */
export function TreePanel() {
  const tree = useWorkspaceStore((s) => s.tree);
  const selectedId = useWorkspaceStore((s) => s.selectedId);
  const onSelect = useWorkspaceStore((s) => s.setSelectedId);
  const onAdd = useWorkspaceStore((s) => s.addPartToTree);
  const onAddStage = useWorkspaceStore((s) => s.addStageToTree);
  const [scaleOpen, setScaleOpen] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);

  return (
    <div className="space-y-4 p-3">
      <ComponentTree
        tree={tree}
        selectedId={selectedId}
        onSelect={onSelect}
        onAdd={onAdd}
        onEditDesign={() => setConfigOpen(true)}
        onScale={() => setScaleOpen(true)}
        onAddStage={onAddStage}
      />
      <ScaleDialog open={scaleOpen} onClose={() => setScaleOpen(false)} />
      <RocketConfigDialog open={configOpen} onClose={() => setConfigOpen(false)} />
    </div>
  );
}
