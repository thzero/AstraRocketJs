import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ComponentNode } from '../../engine/openRocketEngine';
import type { PickerType } from '../../services/parts/componentDb';
import { DEFAULT_CUSTOM_MFR, saveCustomPart, type PartMeta } from '../../services/parts/customParts';
import { PartMetaFields } from './PartMetaFields';
import { Dialog } from '../common/Dialog';
import { errorMessage } from '../../services/app/errorMessage';
import { DialogButton } from '../common/DialogButton';

/**
 * Saves the selected component to the user's own parts library, so it can be
 * picked again from the component picker on any design (customParts.ts).
 *
 * It sits under the picker because it is the other half of the same idea: that
 * one offers thousands of parts somebody else made, this one adds the part you made.
 * The whole node is saved, not the dimensions the picker lists it by, so the
 * cone's shoulder and the chute's lines come back with it.
 */
export function SavePartButton({ node, type }: { node: ComponentNode; type: PickerType }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="w-full rounded-lg bg-raised px-2 py-1.5 text-xs font-medium text-ink-soft hover:bg-elevated"
      >
        {t('picker.save')}
      </button>
      {/* Mounted only while open, so the form seeds its fields once in their
          initializers rather than resetting them from an effect. */}
      {open && <SavePartDialog node={node} type={type} onClose={() => setOpen(false)} />}
    </>
  );
}

function SavePartDialog({ node, type, onClose }: { node: ComponentNode; type: PickerType; onClose: () => void }) {
  const { t } = useTranslation();
  // Seeded from what the part is already called, which is the name the user
  // will look for in the picker. A part they never renamed falls back to its
  // type, which at least reads as something rather than as an empty box.
  const [partNo, setPartNo] = useState(
    typeof node.name === 'string' && node.name.trim() ? node.name.trim() : t(`part.${node.type}`, { defaultValue: '' }),
  );
  const [mfr, setMfr] = useState(t('picker.saveDefaultMfr', { defaultValue: DEFAULT_CUSTOM_MFR }));
  const [desc, setDesc] = useState('');
  const onMeta = (patch: Partial<PartMeta>) => {
    if (patch.partNo !== undefined) setPartNo(patch.partNo);
    if (patch.mfr !== undefined) setMfr(patch.mfr);
    if (patch.desc !== undefined) setDesc(patch.desc);
  };
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!partNo.trim() || saving) return;
    setErr(null);
    setSaving(true);
    try {
      await saveCustomPart(node, type, { mfr, partNo, desc });
      onClose();
    } catch (e) {
      // A refused write, or a node the picker could not list. Either way the
      // dialog stays open: closing it would say the part was saved.
      setErr(errorMessage(e));
      setSaving(false);
    }
  };

  return (
    <Dialog id="savePart" title={t('picker.saveTitle')} onClose={onClose} layout="pad" expandable={false}>
      <PartMetaFields
        idPrefix="save"
        autoFocus
        meta={{ partNo, mfr, desc }}
        onChange={onMeta}
        onEnter={() => void submit()}
      />

      <p className="mt-4 text-xs leading-snug text-ink-faint">{t('picker.saveHint')}</p>
      {/* Said before the save, not after: a body tube saved with its fins
          attached comes back without them, and finding that out by applying
          it to another design is too late. */}
      {node.children && node.children.length > 0 && (
        <p className="mt-2 text-xs leading-snug text-warn-300">{t('picker.saveNoChildren')}</p>
      )}
      {err && <p className="mt-2 text-xs text-danger-400">{err}</p>}

      <div className="mt-6 flex justify-end gap-2">
        <DialogButton onClick={onClose} variant="secondary">
          {t('common.cancel')}
        </DialogButton>
        <DialogButton onClick={() => void submit()} disabled={!partNo.trim() || saving} variant="primary">
          {t('common.save')}
        </DialogButton>
      </div>
    </Dialog>
  );
}
