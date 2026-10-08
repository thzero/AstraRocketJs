import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ComponentNode } from '../../engine/openRocketEngine';
import { hasMaterial, isRecoveryDevice } from '../../services/design/treeEdit';
import { updateCustomPart, type PartMeta } from '../../services/parts/customParts';
import type { CustomPart } from '../../services/parts/presetStore';
import { AppearanceSection } from './AppearanceSection';
import { FieldRow, FieldSection, sectionFields, visibleFields } from './DimensionFields';
import { MaterialSection, RecoveryMaterialSection } from './MaterialSection';
import { errorMessage } from '../../services/app/errorMessage';
import { EditorFooter } from '../common/MasterDetail';
import { PartMetaFields } from './PartMetaFields';

/**
 * The detail half of My Parts: what the selected saved part is called, and
 * what it is.
 *
 * Built out of the property panel's own pieces (`visibleFields` / `FieldRow`,
 * the material and appearance sections) rather than a second set of inputs, so
 * a saved body tube is edited with the same fields, the same units and the
 * same validation as a body tube in a design. All of those take a node and an
 * onChange and nothing else, which is what makes this possible at all.
 *
 * What it deliberately does not show is the half of the panel that describes a
 * part's place in a rocket: position, move, the fit-ranked picker, the
 * descent-rate readout. A saved part has no parent, no siblings and no design
 * to be judged against, so those are not hidden features, they are questions
 * that do not apply until the part is applied to something.
 *
 * Edits are held locally and written on Save, so this is a form over a stored
 * record rather than the live design. The parent mounts it keyed on the part,
 * so selecting another one re-seeds every field by remounting rather than by
 * an effect that has to notice.
 */
export function SavedPartEditor({
  part,
  onDirtyChange,
  onDelete,
  onBack,
}: {
  part: CustomPart;
  /** Lets the list ask before a selection change would discard edits. */
  onDirtyChange: (dirty: boolean) => void;
  onDelete: () => void;
  /** Phone only: the two panes share the width, so the list needs a way back. */
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const [meta, setMeta] = useState<PartMeta>({ mfr: part.mfr, partNo: part.partNo, desc: part.desc });
  // The saved node plus its type, which is what the field tables key off. The
  // type is not stored on the node (customParts.presetNode strips it, since it
  // identifies the node a part came from), so it is put back here.
  const [node, setNode] = useState<ComponentNode>({ ...part.node, type: part.type } as ComponentNode);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Compared against what is stored rather than tracked by a flag set on every
  // keystroke, so typing a character and deleting it again leaves the editor
  // clean and the discard prompt does not fire over an edit nobody made.
  const dirty =
    meta.mfr !== part.mfr ||
    meta.partNo !== part.partNo ||
    meta.desc !== part.desc ||
    JSON.stringify(savedShape(node)) !== JSON.stringify(part.node);

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  const change = (patch: Partial<ComponentNode>) => setNode((n) => ({ ...n, ...patch }));
  const setMetaField = (patch: Partial<PartMeta>) => setMeta((m) => ({ ...m, ...patch }));

  const revert = () => {
    setMeta({ mfr: part.mfr, partNo: part.partNo, desc: part.desc });
    setNode({ ...part.node, type: part.type } as ComponentNode);
    setErr(null);
  };

  const submit = async () => {
    if (!meta.partNo.trim() || saving) return;
    setErr(null);
    setSaving(true);
    try {
      await updateCustomPart(part.id, meta, savedShape(node));
      // No onClose: the list refreshes under this pane through the store's
      // change signal, and the part stays selected. Staying put is the point
      // of a master-detail view.
    } catch (e) {
      // A name another part already uses, a refused write, or geometry that no
      // longer projects to a row.
      setErr(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto p-4 pt-0">
        <div className="sticky top-0 -mx-4 mb-1 flex items-center gap-2 bg-surface px-4 py-2">
          {/* Phone only: at `md` and up the list is beside this, so there is
              nothing to go back to. */}
          <button
            onClick={onBack}
            className="rounded px-1 text-sm text-ink-muted hover:text-ink md:hidden"
            aria-label={t('picker.savedBack')}
          >
            ‹
          </button>
          <span className="truncate text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
            {t(`part.${part.type}`, { defaultValue: part.type })}
          </span>
        </div>

        <PartMetaFields idPrefix="edit" meta={meta} onChange={setMetaField} />

        <div className="mt-5 space-y-3 border-t border-line/10 pt-4">
          {visibleFields(node, false).map((f) => (
            <FieldRow key={f.key} node={node} field={f} onChange={change} />
          ))}

          {/* A body tube's motor-mount pair, a fin tab, a fillet: the same
              sections the panel groups them into, for the same reason. */}
          <FieldSection node={node} title={t('prop.motor')} fields={sectionFields(node, 'motor')} onChange={change} />

          {hasMaterial(node.type) && <MaterialSection node={node} onCommitChange={change} />}
          {isRecoveryDevice(node.type) && <RecoveryMaterialSection node={node} onCommitChange={change} />}
          <AppearanceSection node={node} onChange={change} onCommitChange={change} />
        </div>
      </div>

      <EditorFooter
        onDelete={onDelete}
        dirty={dirty}
        onRevert={revert}
        onSave={() => void submit()}
        saveDisabled={!meta.partNo.trim() || saving}
      >
        {err && <p className="min-w-0 flex-1 truncate text-xs text-danger-400">{err}</p>}
      </EditorFooter>
    </>
  );
}

/**
 * The node as it would be stored: without the `type` the editor put back on it
 * for the field tables to read. Used for the write and for the dirty
 * comparison, so the two cannot disagree about what a change is.
 */
function savedShape(node: ComponentNode): Partial<ComponentNode> {
  const { type: _type, ...rest } = node;
  return rest;
}
