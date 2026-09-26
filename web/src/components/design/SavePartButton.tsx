import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ComponentNode } from '../../engine/openRocketEngine';
import type { PickerType } from '../../services/componentDb';
import { DEFAULT_CUSTOM_MFR, saveCustomPart } from '../../services/customParts';
import { Dialog } from '../common/Dialog';

/**
 * Saves the selected component to the user's own parts library, so it can be
 * picked again from the component picker on any design (customParts.ts).
 *
 * It sits under the picker because it is the other half of the same idea: that
 * one offers 2,900 parts somebody else made, this one adds the part you made.
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
        className="w-full rounded-lg bg-slate-800 px-2 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-700"
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
      setErr(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  const field =
    'mt-1 w-full rounded-lg bg-slate-800 px-3 py-2 text-sm text-slate-100 ring-1 ring-white/10 focus:ring-sky-500';
  const labelClass = 'mt-4 block text-xs font-medium text-slate-400';

  return (
    <Dialog id="savePart" title={t('picker.saveTitle')} onClose={onClose} layout="pad" expandable={false}>
      <label htmlFor="save-part-no" className={labelClass}>
        {t('picker.savePartNo')}
      </label>
      <input
        id="save-part-no"
        autoFocus
        value={partNo}
        onChange={(e) => setPartNo(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && void submit()}
        maxLength={80}
        className={field}
      />

      <label htmlFor="save-part-mfr" className={labelClass}>
        {t('picker.saveMfr')}
      </label>
      <input
        id="save-part-mfr"
        value={mfr}
        onChange={(e) => setMfr(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && void submit()}
        maxLength={80}
        className={field}
      />

      <label htmlFor="save-part-desc" className={labelClass}>
        {t('picker.saveDesc')}
      </label>
      <input
        id="save-part-desc"
        value={desc}
        onChange={(e) => setDesc(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && void submit()}
        maxLength={200}
        placeholder={t('picker.saveDescHint')}
        className={field}
      />

      <p className="mt-4 text-xs leading-snug text-slate-500">{t('picker.saveHint')}</p>
      {/* Said before the save, not after: a body tube saved with its fins
          attached comes back without them, and finding that out by applying
          it to another design is too late. */}
      {node.children && node.children.length > 0 && (
        <p className="mt-2 text-xs leading-snug text-amber-300">{t('picker.saveNoChildren')}</p>
      )}
      {err && <p className="mt-2 text-xs text-red-400">{err}</p>}

      <div className="mt-6 flex justify-end gap-2">
        <button
          onClick={onClose}
          className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-slate-200 ring-1 ring-white/10 hover:bg-slate-700"
        >
          {t('common.cancel')}
        </button>
        <button
          onClick={() => void submit()}
          disabled={!partNo.trim() || saving}
          className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
        >
          {t('common.save')}
        </button>
      </div>
    </Dialog>
  );
}
