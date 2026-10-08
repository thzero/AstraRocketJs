import { nsKey } from '../../services/storage/storageKeys';
import { readLocalJson, writeLocalJson } from '../../services/storage/localPref';

const isStringList = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');
const isRange = (v: unknown): v is [number, number] =>
  Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === 'number' && Number.isFinite(x));

// Selected manufacturers persist across sessions (the user's usual set).
const MFRS_KEY = nsKey('motorPicker:mfrs');
export const loadMfrs = (): Set<string> => new Set(readLocalJson(MFRS_KEY, isStringList, []));
export const saveMfrs = (s: Set<string>): void => void writeLocalJson(MFRS_KEY, [...s]);

/**
 * The diameter range [lowIdx, highIdx], remembered across sessions.
 *
 * Seeded from nothing but the user's own drags. Seeding the ceiling from the
 * mount and then storing it as a preference makes a range picked for an 18 mm
 * mount follow the user to every other mount they load; capping by the mount is
 * the fit checkbox's job instead.
 */
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';

/** "Hide motors not in regular production", remembered; on until turned off, as desktop's is. */
const HIDE_OOP_KEY = nsKey('motorPicker:hideOop');
export const loadHideOop = (): boolean => readLocalJson(HIDE_OOP_KEY, isBool, true);
export const saveHideOop = (on: boolean): void => void writeLocalJson(HIDE_OOP_KEY, on);

/** "Hide very similar thrust curves", remembered; on until turned off, as desktop's is. */
const HIDE_SIMILAR_KEY = nsKey('motorPicker:hideSimilar');
export const loadHideSimilar = (): boolean => readLocalJson(HIDE_SIMILAR_KEY, isBool, true);
export const saveHideSimilar = (on: boolean): void => void writeLocalJson(HIDE_SIMILAR_KEY, on);

const DIA_KEY = nsKey('motorPicker:dia2');
export const loadDia = (): [number, number] | null => readLocalJson<[number, number] | null>(DIA_KEY, isRange, null);
export const saveDia = (d: [number, number]): void => void writeLocalJson(DIA_KEY, d);
