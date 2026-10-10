import en from '../../src/i18n/locales/en.json';
import { importNoteText, type ImportNote } from '../../src/services/files/importNote';
import { localeTranslator } from './localeTranslator';

const english = localeTranslator(en);

/** One import note as the English banner shows it. */
export const noteText = (note: ImportNote): string => importNoteText(note, english);

/** Import notes as the English banner shows them, for assertions on wording. */
export const noteTexts = (notes: readonly ImportNote[] | undefined): string[] => (notes ?? []).map(noteText);
