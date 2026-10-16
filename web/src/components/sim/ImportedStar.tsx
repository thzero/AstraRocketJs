import { useTranslation } from 'react-i18next';

/**
 * The mark on an imported motor: a curve the user brought in, which has no
 * other copy here and can be deleted. The star is drawn for the eye and the
 * same fact is spoken as text, since a glyph or a tooltip alone is not read
 * out as part of the row.
 */
export function ImportedStar() {
  const { t } = useTranslation();
  return (
    <>
      <span aria-hidden="true" className="text-warn-400" title={t('motor.importedTitle')}>
        ★
      </span>
      <span className="sr-only">{t('motor.importedTitle')}</span>{' '}
    </>
  );
}
