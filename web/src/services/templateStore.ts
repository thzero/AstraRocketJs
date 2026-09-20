// Swappable client-side store for the user's custom flight-path EXPORT TEMPLATES
// (Mustache). This is the browser equivalent of OpenRocket's desktop
// `ExportTemplates` folder: instead of scanning a user directory, we persist
// imported templates through a KeyValueStore (IndexedDB by default). Mirrors
// the material/motor stores; swap setTemplateStore(...) for a bespoke backend.
import type { KeyValueStore } from './keyValueStore';
import { IndexedDbKeyValueStore } from './idbKeyValueStore';

/** A user-imported export template. */
export interface UserTemplate {
  /** Stable id (the imported filename), used to de-dupe and remember selection. */
  id: string;
  /** Display name shown in the format dropdown. */
  name: string;
  /** Output file extension without a dot (e.g. "kml", "csv", "gpx"). */
  ext: string;
  /** The raw Mustache template text. */
  source: string;
}

const SUFFIX = '.mustache';

/**
 * Parse a template filename into its display name and output extension, using
 * the desktop convention `<name>.<ext>.mustache` (e.g. `my-waypoints.csv.mustache`
 * → name "my-waypoints", ext "csv"). A bare `<name>.mustache` defaults to "txt".
 */
export function parseTemplateFilename(filename: string): { id: string; name: string; ext: string } {
  const id = filename;
  const base = filename.toLowerCase().endsWith(SUFFIX) ? filename.slice(0, -SUFFIX.length) : filename;
  const dot = base.lastIndexOf('.');
  if (dot > 0 && dot < base.length - 1) {
    return { id, name: base.slice(0, dot), ext: base.slice(dot + 1).toLowerCase() };
  }
  return { id, name: base, ext: 'txt' };
}

export interface TemplateStore {
  /** All stored templates (implementation decides ordering). */
  list(): Promise<UserTemplate[]>;
  /** Add or replace (by id) a template. */
  add(template: UserTemplate): Promise<void>;
  /** Remove a template by id. */
  remove(id: string): Promise<void>;
}

const CUSTOM_KEY = 'astrarrocketjs:templates:custom';

function isUserTemplate(v: unknown): v is UserTemplate {
  const t = v as UserTemplate;
  return (
    !!t &&
    typeof t.id === 'string' &&
    typeof t.name === 'string' &&
    typeof t.ext === 'string' &&
    typeof t.source === 'string'
  );
}

/**
 * Default TemplateStore: serializes the template list to a single key-value
 * entry through a KeyValueStore (IndexedDB by default).
 */
export class KeyValueTemplateStore implements TemplateStore {
  constructor(
    private readonly key: string = CUSTOM_KEY,
    private readonly kv: KeyValueStore = new IndexedDbKeyValueStore(),
  ) {}

  /** The stored list, tolerating an absent, corrupt or partly invalid blob. */
  private static parse(raw: string | null): UserTemplate[] {
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(isUserTemplate);
    } catch {
      return []; // corrupt entry
    }
  }

  /**
   * Read, transform and write in ONE store transaction, and propagate a
   * refused write the way `motorStore.addCustomMotor` does.
   *
   * `kv.update` reports failure by RETURNING false rather than throwing, so
   * discarding it meant the dialog awaited the save, got a clean resolve, and
   * re-rendered a list that simply did not contain the thing the user had just
   * added - with no error anywhere. "Best-effort (re-addable)" was the excuse,
   * but re-adding is only possible if you are told it did not stick.
   *
   * `update`, not read-then-set: IndexedDB is shared across the tabs of this
   * installable PWA, and a get/set with an await between them let two tabs
   * each drop the other's template (see `DesignLibrary.mutateIndex`).
   */
  private async mutate(fn: (list: UserTemplate[]) => UserTemplate[]): Promise<void> {
    const ok = await this.kv.update(this.key, (raw) => JSON.stringify(fn(KeyValueTemplateStore.parse(raw))));
    if (!ok) throw new Error('storage-full');
  }

  async list(): Promise<UserTemplate[]> {
    return KeyValueTemplateStore.parse(await this.kv.get(this.key));
  }

  async add(template: UserTemplate): Promise<void> {
    await this.mutate((list) => [template, ...list.filter((t) => t.id !== template.id)]);
  }

  async remove(id: string): Promise<void> {
    await this.mutate((list) => list.filter((t) => t.id !== id));
  }
}

// The active template store. The header promised `setTemplateStore` and it
// did not exist; the seam is the same one the material store has.
let store: TemplateStore = new KeyValueTemplateStore();

export function getTemplateStore(): TemplateStore {
  return store;
}

export function setTemplateStore(next: TemplateStore): void {
  store = next;
}
