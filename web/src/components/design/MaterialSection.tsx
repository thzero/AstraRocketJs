import { useTranslation } from 'react-i18next';
import type { ComponentNode } from '../../engine/openRocketEngine';
import { MaterialPicker } from './MaterialPicker';

/**
 * The property panel's material sections: the bulk material a structural part
 * is made of, and the surface (fabric) + line (cord) materials of a recovery
 * device. Each picker commits its choice in one shot.
 */

/** The bulk material of a structural part. */
export function MaterialSection({
  node,
  onCommitChange,
}: {
  node: ComponentNode;
  /** Patch and close the undo entry in one shot (pickers are discrete controls). */
  onCommitChange: (patch: Partial<ComponentNode>) => void;
}) {
  return (
    <div className="border-t border-white/5 pt-3">
      <MaterialPicker
        value={typeof node.materialName === 'string' ? node.materialName : undefined}
        onChange={(name, d) => onCommitChange({ materialName: name, density: d || undefined })}
      />
    </div>
  );
}

/** Recovery devices use surface (fabric) + line (cord) materials, not the
 *  bulk material above — each feeds the device's mass. */
export function RecoveryMaterialSection({
  node,
  onCommitChange,
}: {
  node: ComponentNode;
  onCommitChange: (patch: Partial<ComponentNode>) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3 border-t border-white/5 pt-3">
      <MaterialPicker
        type="surface"
        label={t(node.type === 'streamer' ? 'material.strip' : 'material.canopy')}
        value={typeof node.surfaceMaterialName === 'string' ? node.surfaceMaterialName : undefined}
        onChange={(name, d) => onCommitChange({ surfaceMaterialName: name, surfaceDensity: d || undefined })}
      />
      {node.type === 'parachute' && (
        <MaterialPicker
          type="line"
          label={t('material.lines')}
          value={typeof node.lineMaterialName === 'string' ? node.lineMaterialName : undefined}
          onChange={(name, d) => onCommitChange({ lineMaterialName: name, lineDensity: d || undefined })}
        />
      )}
    </div>
  );
}
