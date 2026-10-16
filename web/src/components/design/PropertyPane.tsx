import { PropertyPanel } from './PropertyPanel';
import { useSelectedComponent } from './useSelectedComponent';

/** Design tab, right column: the selected part's property editor (which renders its
 *  own "pick a part" hint when nothing is selected). A column of its own, beside
 *  the drawing, so the tree and the editor do not compete for height. */
export function PropertyPane() {
  const sel = useSelectedComponent();

  return (
    <div className="space-y-4 p-3">
      <PropertyPanel {...sel} />
    </div>
  );
}
