import { useTranslation } from 'react-i18next';
import { EXPORT_FORMATS } from '../../services/exports/flightPathExport';
import type { UserTemplate } from '../../services/exports/templateStore';
import { USER_PREFIX } from './useExportTemplates';

/**
 * The flight-path export dialog's format block: the format select (built-ins,
 * then any imported templates), import and download-template, and delete for a
 * selected user template. State and handlers come from `useExportTemplates`.
 */
export function ExportFormatPicker({
  selected,
  templates,
  canDelete,
  onSelect,
  onImport,
  onDownloadTemplate,
  onDelete,
}: {
  selected: string;
  templates: UserTemplate[];
  canDelete: boolean;
  onSelect: (value: string) => void;
  onImport: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onDownloadTemplate: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      <label className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-400">{t('pathExport.format')}</span>
        <select
          value={selected}
          onChange={(e) => onSelect(e.target.value)}
          className="flex-1 rounded-md bg-slate-800 px-2 py-1.5 text-sm text-slate-100 ring-1 ring-white/10 focus:outline-none focus:ring-sky-500"
        >
          <optgroup label={t('pathExport.builtIns')}>
            {EXPORT_FORMATS.map((f) => (
              <option key={f.id} value={f.id}>
                {t(`pathExport.fmt.${f.id}`)}
              </option>
            ))}
          </optgroup>
          {templates.length > 0 && (
            <optgroup label={t('pathExport.custom')}>
              {templates.map((tp) => (
                <option key={tp.id} value={`${USER_PREFIX}${tp.id}`}>
                  {tp.name} (.{tp.ext})
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </label>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          <label className="cursor-pointer rounded-md bg-slate-800 px-2 py-1 text-[11px] font-medium text-slate-200 ring-1 ring-white/10 hover:bg-slate-700">
            {t('pathExport.import')}
            <input type="file" accept=".mustache" className="hidden" onChange={onImport} />
          </label>
          <button
            onClick={onDownloadTemplate}
            title={t('pathExport.downloadTemplateTitle')}
            className="rounded-md bg-slate-800 px-2 py-1 text-[11px] font-medium text-slate-200 ring-1 ring-white/10 hover:bg-slate-700"
          >
            {t('pathExport.downloadTemplate')}
          </button>
        </div>
        {canDelete && (
          <button
            onClick={onDelete}
            className="rounded-md bg-rose-600/80 px-2 py-1 text-[11px] font-medium text-white ring-1 ring-rose-400/30 hover:bg-rose-600"
          >
            {t('pathExport.delete')}
          </button>
        )}
      </div>
    </div>
  );
}
