import { useTranslation } from 'react-i18next';
import type { ComponentNode } from '../../engine/openRocketEngine';
import { MaterialPicker } from './MaterialPicker';
import { FieldRow, sectionFields } from './DimensionFields';

/**
 * The property panel's material sections: the bulk material a structural part
 * is made of, with the surface finish of an external part under it, and the
 * surface (fabric) + line (cord) materials of a recovery device. Each picker
 * commits its choice in one shot.
 */

/** The bulk material of a structural part, and the finish of an external one. */
export function MaterialSection({
  node,
  onCommitChange,
}: {
  node: ComponentNode;
  /** Patch and close the undo entry in one shot (pickers are discrete controls). */
  onCommitChange: (patch: Partial<ComponentNode>) => void;
}) {
  return (
    <div className="space-y-2 border-t border-line/5 pt-3">
      <MaterialPicker
        value={typeof node.materialName === 'string' ? node.materialName : undefined}
        density={typeof node.density === 'number' ? node.density : undefined}
        onChange={(name, d, group) =>
          onCommitChange({
            materialName: name,
            density: d || undefined,
            // The catalog group rides along, as the fillet picker's does, so
            // the .ork writer files the material under its own category rather
            // than the one the part's previous material belonged to.
            materialGroup: (name && group) || undefined,
          })
        }
      />
      {/* The finish is a select, so it closes its own undo entry as it changes. */}
      {sectionFields(node, 'material').map((f) => (
        <FieldRow key={f.key} node={node} field={f} onChange={onCommitChange} />
      ))}
    </div>
  );
}

/** The line material a parachute's shroud lines or a shock cord is weighed by. */
function LineMaterialPicker({
  label,
  node,
  onCommitChange,
}: {
  label: string;
  node: ComponentNode;
  onCommitChange: (patch: Partial<ComponentNode>) => void;
}) {
  return (
    <MaterialPicker
      type="line"
      label={label}
      value={typeof node.lineMaterialName === 'string' ? node.lineMaterialName : undefined}
      density={typeof node.lineDensity === 'number' ? node.lineDensity : undefined}
      onChange={(name, d) => onCommitChange({ lineMaterialName: name, lineDensity: d || undefined })}
    />
  );
}

/** Recovery devices use surface (fabric) + line (cord) materials, not the
 *  bulk material above; each feeds the device's mass. */
export function RecoveryMaterialSection({
  node,
  onCommitChange,
}: {
  node: ComponentNode;
  onCommitChange: (patch: Partial<ComponentNode>) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3 border-t border-line/5 pt-3">
      <MaterialPicker
        type="surface"
        label={t(node.type === 'streamer' ? 'material.strip' : 'material.canopy')}
        value={typeof node.surfaceMaterialName === 'string' ? node.surfaceMaterialName : undefined}
        density={typeof node.surfaceDensity === 'number' ? node.surfaceDensity : undefined}
        onChange={(name, d) => onCommitChange({ surfaceMaterialName: name, surfaceDensity: d || undefined })}
      />
      {node.type === 'parachute' && (
        <LineMaterialPicker label={t('material.lines')} node={node} onCommitChange={onCommitChange} />
      )}
    </div>
  );
}

/** A shock cord's line material, which the kernel weighs the cord by, as the
 *  desktop shock cord dialog offers it. */
export function CordMaterialSection({
  node,
  onCommitChange,
}: {
  node: ComponentNode;
  onCommitChange: (patch: Partial<ComponentNode>) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="border-t border-line/5 pt-3">
      <LineMaterialPicker label={t('material.cord')} node={node} onCommitChange={onCommitChange} />
    </div>
  );
}
