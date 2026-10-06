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
const DIA_KEY = nsKey('motorPicker:dia2');
export const loadDia = (): [number, number] | null => readLocalJson<[number, number] | null>(DIA_KEY, isRange, null);
export const saveDia = (d: [number, number]): void => void writeLocalJson(DIA_KEY, d);
