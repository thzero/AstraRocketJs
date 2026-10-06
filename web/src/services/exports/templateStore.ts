// Swappable client-side store for the user's custom flight-path EXPORT TEMPLATES
// (Mustache). This is the browser equivalent of OpenRocket's desktop
// `ExportTemplates` folder: instead of scanning a user directory, we persist
// imported templates through a KeyValueStore (IndexedDB by default). Mirrors
// the material/motor stores; swap setTemplateStore(...) for a bespoke backend.
import type { KeyValueStore } from '../storage/keyValueStore';
import { IndexedDbKeyValueStore } from '../storage/idbKeyValueStore';
import { JsonListStore } from '../storage/jsonListStore';
import { nsKey } from '../storage/storageKeys';

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

const CUSTOM_KEY = nsKey('templates:custom');

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
 * Default TemplateStore: the template list as one JSON array under one
 * key-value entry (see JsonListStore for the read and write rules), newest
 * import first, one entry per id.
 */
export class KeyValueTemplateStore implements TemplateStore {
  private readonly items: JsonListStore<UserTemplate>;

  constructor(key: string = CUSTOM_KEY, kv: KeyValueStore = new IndexedDbKeyValueStore()) {
    this.items = new JsonListStore(key, isUserTemplate, (t) => t.id, kv);
  }

  list(): Promise<UserTemplate[]> {
    return this.items.list();
  }

  add(template: UserTemplate): Promise<void> {
    return this.items.upsert([template]);
  }

  remove(id: string): Promise<void> {
    return this.items.remove(id);
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
