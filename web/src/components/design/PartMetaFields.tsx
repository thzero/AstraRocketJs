import { useTranslation } from 'react-i18next';
import type { PartMeta } from '../../services/parts/customParts';

const field =
  'mt-1 w-full rounded-lg bg-slate-800 px-3 py-2 text-sm text-slate-100 ring-1 ring-white/10 focus:ring-sky-500';
const labelClass = 'mt-4 block text-xs font-medium text-slate-400';

/** A saved part's name, manufacturer and description: the fields it is found by in the picker. */
export function PartMetaFields({
  idPrefix,
  meta,
  onChange,
  onEnter,
  autoFocus = false,
}: {
  /** Keeps the label ids apart when two forms could be in the document. */
  idPrefix: string;
  meta: PartMeta;
  onChange: (patch: Partial<PartMeta>) => void;
  /** Enter in any field, for a form that submits on it. */
  onEnter?: () => void;
  autoFocus?: boolean;
}) {
  const { t } = useTranslation();
  const onKeyDown = onEnter ? (e: { key: string }) => e.key === 'Enter' && onEnter() : undefined;
  return (
    <>
      <label htmlFor={`${idPrefix}-part-no`} className={labelClass}>
        {t('picker.savePartNo')}
      </label>
      <input
        id={`${idPrefix}-part-no`}
        autoFocus={autoFocus}
        value={meta.partNo}
        onChange={(e) => onChange({ partNo: e.target.value })}
        onKeyDown={onKeyDown}
        maxLength={80}
        className={field}
      />

      <label htmlFor={`${idPrefix}-part-mfr`} className={labelClass}>
        {t('picker.saveMfr')}
      </label>
      <input
        id={`${idPrefix}-part-mfr`}
        value={meta.mfr}
        onChange={(e) => onChange({ mfr: e.target.value })}
        onKeyDown={onKeyDown}
        maxLength={80}
        className={field}
      />

      <label htmlFor={`${idPrefix}-part-desc`} className={labelClass}>
        {t('picker.saveDesc')}
      </label>
      <input
        id={`${idPrefix}-part-desc`}
        value={meta.desc}
        onChange={(e) => onChange({ desc: e.target.value })}
        onKeyDown={onKeyDown}
        maxLength={200}
        placeholder={t('picker.saveDescHint')}
        className={field}
      />
    </>
  );
}
