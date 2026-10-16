import en from './locales/en.json';
import { errorMessage } from '../services/app/errorMessage';

/**
 * Text that is translated when it is shown rather than when it is made: an i18n
 * key and the values it interpolates. A value can itself be keyed (a reason
 * nested inside a wrapper sentence), and is translated with it.
 */
export interface Keyed {
  /** The full i18n key, so every call site names it literally. */
  key: string;
  values?: KeyedValues;
}

export type KeyedValues = { [name: string]: string | number | Keyed };

/** The translate function a render site holds (`t` from `useTranslation`, or `i18n.t`). */
export type Translate = (key: string, values?: Record<string, string | number>) => string;

/**
 * An error whose text the user reads.
 *
 * Services throw this instead of a sentence, and the catch site renders it in
 * the language the app is showing ({@link errorText}). `message` is the English
 * text from en.json, so a log, a test or a caller that only knows `Error` still
 * gets a readable sentence.
 */
export class KeyedError extends Error implements Keyed {
  readonly key: string;
  readonly values?: KeyedValues;

  constructor(key: string, values?: KeyedValues) {
    super(englishText(key, values));
    this.name = 'KeyedError';
    this.key = key;
    if (values) this.values = values;
  }
}

type Tree = { [k: string]: string | Tree };

/**
 * A key rendered from the English bundle, with `{{name}}` filled in. A key
 * en.json lacks comes back as the key itself, which is what i18next shows too.
 */
export function englishText(key: string, values?: KeyedValues): string {
  let node: string | Tree | undefined = en;
  for (const part of key.split('.')) node = typeof node === 'object' ? node[part] : undefined;
  if (typeof node !== 'string') return key;
  return node.replace(/{{\s*([^}]+?)\s*}}/g, (whole, name: string) => {
    const v = values?.[name];
    if (v === undefined) return whole;
    return typeof v === 'object' ? englishText(v.key, v.values) : String(v);
  });
}

/** A keyed text in the language `t` speaks, nested keyed values included. */
export function keyedText(k: Keyed, t: Translate): string {
  if (!k.values) return t(k.key);
  const flat: Record<string, string | number> = {};
  for (const [name, v] of Object.entries(k.values)) flat[name] = typeof v === 'object' ? keyedText(v, t) : v;
  return t(k.key, flat);
}

/**
 * What a caught value says, for the user: a {@link KeyedError} in the language
 * `t` speaks, anything else as its own message.
 */
export function errorText(e: unknown, t: Translate): string {
  return e instanceof KeyedError ? keyedText(e, t) : errorMessage(e);
}

/**
 * A caught value as something a keyed text can carry and translate later: a
 * {@link KeyedError} as its key and values, anything else as its message.
 */
export function errorReason(e: unknown): string | Keyed {
  return e instanceof KeyedError ? (e.values ? { key: e.key, values: e.values } : { key: e.key }) : errorMessage(e);
}

/**
 * A received value that has the shape of a {@link Keyed}: a non-empty key, and
 * values that are strings, numbers or nested keyed texts. Used where a
 * keyed text crosses a boundary the type system cannot see across, such as a
 * worker reply.
 */
export function isKeyed(v: unknown): v is Keyed {
  if (!v || typeof v !== 'object') return false;
  const { key, values } = v as { key?: unknown; values?: unknown };
  if (typeof key !== 'string' || key === '') return false;
  if (values === undefined) return true;
  if (!values || typeof values !== 'object' || Array.isArray(values)) return false;
  return Object.values(values).every((x) => typeof x === 'string' || typeof x === 'number' || isKeyed(x));
}
