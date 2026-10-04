import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { download as saveDownload, safeFilename } from '../../services/files/saveFile';
import { EXPORT_FORMATS } from '../../services/exports/flightPathExport';
import { getTemplateStore, parseTemplateFilename, type UserTemplate } from '../../services/exports/templateStore';
import { useLatest } from '../common/useLatest';

/** Prefixes a user template's id in the format select, so it cannot collide with a built-in's. */
export const USER_PREFIX = 'user:';

/**
 * Owns the flight-path export dialog's format choice: the user templates in the
 * template store (the browser equivalent of OpenRocket's desktop
 * `ExportTemplates` folder), the current selection resolved to a built-in
 * format or a user template, and the import, delete and download-template
 * handlers. Also owns the dialog's error line, which these handlers and the
 * dialog's own download both report into.
 */
export function useExportTemplates() {
  const { t } = useTranslation();
  const store = useMemo(() => getTemplateStore(), []);
  const [selected, setSelected] = useState<string>(EXPORT_FORMATS[0]!.id);
  const [templates, setTemplates] = useState<UserTemplate[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Which template-store write is current: a file read plus an IndexedDB write,
  // and this dialog can close under either.
  const storeWrite = useLatest();

  useEffect(() => {
    store
      .list()
      .then(setTemplates)
      .catch(() => setTemplates([]));
  }, [store]);

  // Resolve the current selection to either a built-in format or a user template.
  const resolved = useMemo(() => {
    if (selected.startsWith(USER_PREFIX)) {
      const id = selected.slice(USER_PREFIX.length);
      const template = templates.find((tp) => tp.id === id);
      if (template) return { kind: 'user' as const, template };
    }
    const format = EXPORT_FORMATS.find((f) => f.id === selected) ?? EXPORT_FORMATS[0]!;
    return { kind: 'builtin' as const, format };
  }, [selected, templates]);

  const selectedUser = resolved.kind === 'user' ? resolved.template : null;

  const onImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // let the same file be re-imported after edits
    if (!file) return;
    const mine = storeWrite.claim();
    try {
      const source = await file.text();
      if (!mine()) return;
      if (!source.trim()) {
        setError(t('pathExport.importEmpty'));
        return;
      }
      const { id, name, ext } = parseTemplateFilename(file.name);
      await store.add({ id, name, ext, source });
      const listed = await store.list();
      // The store write is deliberately NOT undone on a stale token - the
      // template is stored and should stay stored. What must not happen is
      // selecting it in a dialog that has moved on, or reporting the outcome of
      // one import over another's.
      if (!mine()) return;
      setTemplates(listed);
      setSelected(`${USER_PREFIX}${id}`);
      setError(null);
    } catch {
      if (!mine()) return;
      setError(t('pathExport.importError'));
    }
  };

  const deleteSelected = async () => {
    if (!selectedUser) return;
    const mine = storeWrite.claim();
    try {
      await store.remove(selectedUser.id);
      // Inside the try as well: a listing that fails after the delete would
      // otherwise reject out of the handler, leaving the row gone from the store,
      // still shown in the dialog, and no error reported.
      const listed = await store.list();
      if (!mine()) return;
      setTemplates(listed);
    } catch {
      if (!mine()) return;
      // The template store reports a refused write rather than resolving cleanly
      // on one, so this can throw.
      setError(t('storage.full'));
      return;
    }
    setSelected(EXPORT_FORMATS[0]!.id);
    setError(null);
  };

  // Download the selected template's Mustache source - a built-in as a starting
  // point for a custom template, or a user template to edit and re-import.
  const downloadTemplate = () => {
    if (resolved.kind === 'user') {
      const tp = resolved.template;
      saveDownload(`${safeFilename(tp.name, 'flight')}.${tp.ext}.mustache`, tp.source);
    } else {
      saveDownload(resolved.format.templateFilename, resolved.format.source);
    }
  };

  return {
    selected,
    setSelected,
    templates,
    resolved,
    selectedUser,
    error,
    setError,
    onImport,
    deleteSelected,
    downloadTemplate,
  };
}
