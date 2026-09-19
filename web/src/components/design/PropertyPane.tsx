import { PropertyPanel } from './PropertyPanel';
import { useSelectedComponent } from './useSelectedComponent';

/** Design tab, right column: the selected part's property editor (which renders
 *  its own "pick a part" hint when nothing is selected). Gets a whole column of
 *  its own here — it used to be stacked under the component tree in a single
 *  340px column, where the two grew into each other. */
export function PropertyPane() {
  const sel = useSelectedComponent();

  return (
    <div className="space-y-4 p-3">
      <PropertyPanel
        node={sel.node}
        onChange={sel.onChange}
        onCommit={sel.onCommit}
        onRemove={sel.onRemove}
        onMove={sel.onMove}
        canMoveUp={sel.canMoveUp}
        canMoveDown={sel.canMoveDown}
        canRemove={sel.canRemove}
        isFirstStage={sel.isFirstStage}
        parentRadius={sel.parentRadius}
      />
    </div>
  );
}
