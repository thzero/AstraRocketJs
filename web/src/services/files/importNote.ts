import { keyedText, type Keyed, type Translate } from '../../i18n/keyedError';
import { fmtList } from '../../i18n/format';

/**
 * One note an import raises for the loaded-design banner.
 *
 * A keyed note names an `importNote.*` translation and the data it interpolates
 * (part names, motor designations, counts, the kernel's own error text, or a
 * keyed text translated along with it), so it renders in whatever language the
 * app is showing when it is read, not the one it had when the file was opened.
 * A list of names is kept as a list and joined in that language at render
 * (see {@link NoteList}). A plain string is final text, kept only for a note a
 * workspace saved before notes were keyed; nothing makes a new one, since it
 * would stay in the language the file was opened in.
 */
export type ImportNote = string | KeyedNote;

/** A keyed note: a {@link Keyed} whose values may also be lists. */
export interface KeyedNote {
  key: string;
  values?: NoteValues;
}

export type NoteValue = string | number | Keyed | NoteList;
export type NoteValues = { [name: string]: NoteValue };

/**
 * Names joined at render with the language's own list conjunction. `quote`
 * puts each in quotation marks; `more` ends the list with an ellipsis, for a
 * list cut short.
 */
export interface NoteList {
  list: (string | Keyed)[];
  quote?: boolean;
  more?: boolean;
}

/** A keyed note. `key` is the full i18n key, so every call site names it literally. */
export function keyedNote(key: string, values?: NoteValues): ImportNote {
  return values ? { key, values } : { key };
}

/** A list value for a keyed note, joined when the note is read. */
export function noteList(list: (string | Keyed)[], opts: { quote?: boolean; more?: boolean } = {}): NoteList {
  return { list, ...(opts.quote ? { quote: true } : {}), ...(opts.more ? { more: true } : {}) };
}

/**
 * A part's name for a note: its own name, or its type's name as a key, so a part
 * nobody named reads in the language the note is shown in.
 */
export function notePartName(node: { name?: unknown; type: string }): string | Keyed {
  const own = typeof node.name === 'string' ? node.name.trim() : '';
  return own || { key: `part.${node.type}` };
}

const isList = (v: unknown): v is NoteList =>
  !!v && typeof v === 'object' && Array.isArray((v as { list?: unknown }).list);

const isKeyedValue = (v: unknown): v is Keyed =>
  !!v && typeof v === 'object' && typeof (v as { key?: unknown }).key === 'string';

const itemText = (item: unknown, t: Translate): string =>
  typeof item === 'string' ? item : isKeyedValue(item) ? keyedText(item, t) : '';

function valueText(v: NoteValue, t: Translate): string | number {
  if (isList(v)) {
    const items = v.list.map((item) => itemText(item, t)).map((s) => (v.quote ? `"${s}"` : s));
    return `${fmtList(items)}${v.more ? ' …' : ''}`;
  }
  if (isKeyedValue(v)) return keyedText(v, t);
  return typeof v === 'string' || typeof v === 'number' ? v : '';
}

/**
 * The text a note shows. A keyed note is translated on every read, its lists
 * joined in the language shown; a plain string is returned as it is. Anything
 * else, which only a damaged saved workspace could hold, renders as empty
 * rather than as a raw object.
 */
export function importNoteText(note: ImportNote, t: Translate): string {
  if (typeof note === 'string') return note;
  if (!note || typeof note !== 'object' || typeof note.key !== 'string') return '';
  if (!note.values) return t(note.key);
  const flat: Record<string, string | number> = {};
  for (const [name, v] of Object.entries(note.values)) flat[name] = valueText(v, t);
  return t(note.key, flat);
}
