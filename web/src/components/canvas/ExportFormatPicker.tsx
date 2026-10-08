import { useTranslation } from 'react-i18next';
import { EXPORT_FORMATS } from '../../services/exports/flightPathExport';
import type { UserTemplate } from '../../services/exports/templateStore';
import { USER_PREFIX } from './useExportTemplates';
import { useFilePick } from '../common/useFilePick';

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
  onImport: (file: File) => void;
  onDownloadTemplate: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const templateFile = useFilePick({ accept: '.mustache', onFile: onImport, label: t('pathExport.import') });
  return (
    <div className="space-y-2">
      <label className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium uppercase tracking-wide text-ink-muted">{t('pathExport.format')}</span>
        <select
          value={selected}
          onChange={(e) => onSelect(e.target.value)}
          className="flex-1 rounded-md bg-raised px-2 py-1.5 text-sm text-ink-strong ring-1 ring-line/10 focus:outline-none focus:ring-accent-500"
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
          <button
            onClick={templateFile.pick}
            className="rounded-md bg-raised px-2 py-1 text-[11px] font-medium text-ink ring-1 ring-line/10 hover:bg-elevated"
          >
            {t('pathExport.import')}
          </button>
          {templateFile.input}
          <button
            onClick={onDownloadTemplate}
            title={t('pathExport.downloadTemplateTitle')}
            className="rounded-md bg-raised px-2 py-1 text-[11px] font-medium text-ink ring-1 ring-line/10 hover:bg-elevated"
          >
            {t('pathExport.downloadTemplate')}
          </button>
        </div>
        {canDelete && (
          <button
            onClick={onDelete}
            className="rounded-md bg-error-600/80 px-2 py-1 text-[11px] font-medium text-on-accent ring-1 ring-error-400/30 hover:bg-error-600"
          >
            {t('pathExport.delete')}
          </button>
        )}
      </div>
    </div>
  );
}
