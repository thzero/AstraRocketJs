import type { RocketTree, ComponentNode, ComponentType as PartType } from '../../engine/openRocketEngine';
import { ComponentTree } from './ComponentTree';
import { PropertyPanel } from './PropertyPanel';

/** Left pane: the component tree plus the selected part's property editor. */
export function EditorPanel({
  tree, selectedId, onSelect, onAdd,
  node, onChange, onRemove, onMove, canMoveUp, canMoveDown,
}: {
  tree: RocketTree;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onAdd: (type: PartType) => void;
  node: ComponentNode | null;
  onChange: (patch: Partial<ComponentNode>) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}) {
  return (
    <div className="space-y-4 p-3">
      <ComponentTree tree={tree} selectedId={selectedId} onSelect={onSelect} onAdd={onAdd} />
      <PropertyPanel
        node={node}
        onChange={onChange}
        onRemove={onRemove}
        onMove={onMove}
        canMoveUp={canMoveUp}
        canMoveDown={canMoveDown}
      />
    </div>
  );
}
