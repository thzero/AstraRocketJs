import { keyedText, type Keyed, type KeyedValues, type Translate } from '../../i18n/keyedError';

/**
 * One note an import raises for the loaded-design banner.
 *
 * A keyed note names an `importNote.*` translation and the data it interpolates
 * (part names, motor designations, counts, the kernel's own error text, or a
 * keyed reason translated along with it), so it renders in whatever language
 * the app is showing when it is read, not the one it had when the file was
 * opened. A plain string is final text: a note the app translated when it made
 * it, or one a saved workspace already holds from a build that stored English
 * sentences.
 */
export type ImportNote = string | Keyed;

/** A keyed note. `key` is the full i18n key, so every call site names it literally. */
export function keyedNote(key: string, values?: KeyedValues): ImportNote {
  return values ? { key, values } : { key };
}

/**
 * The text a note shows. A keyed note is translated on every read; a plain
 * string is returned as it is. Anything else, which only a damaged saved
 * workspace could hold, renders as empty rather than as a raw object.
 */
export function importNoteText(note: ImportNote, t: Translate): string {
  if (typeof note === 'string') return note;
  if (note && typeof note === 'object' && typeof note.key === 'string') return keyedText(note, t);
  return '';
}
