// Swappable client-side store for the user's custom flight-path EXPORT TEMPLATES
// (Mustache). This is the browser equivalent of OpenRocket's desktop
// `ExportTemplates` folder: instead of scanning a user directory, we persist
// imported templates through a KeyValueStore (localStorage by default). Mirrors
// the material/motor stores; swap setTemplateStore(...) for a bespoke backend.
import { type KeyValueStore, LocalStorageKeyValueStore } from './keyValueStore';

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
  const base = filename.toLowerCase().endsWith(SUFFIX)
    ? filename.slice(0, -SUFFIX.length)
    : filename;
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
  return !!t && typeof t.id === 'string' && typeof t.name === 'string'
    && typeof t.ext === 'string' && typeof t.source === 'string';
}

/**
 * Default TemplateStore: serializes the template list to a single key-value
 * entry through a KeyValueStore (localStorage by default).
 */
export class KeyValueTemplateStore implements TemplateStore {
  constructor(
    private readonly key: string = CUSTOM_KEY,
    private readonly kv: KeyValueStore = new LocalStorageKeyValueStore(),
  ) {}

  private async read(): Promise<UserTemplate[]> {
    const raw = await this.kv.get(this.key);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(isUserTemplate);
    } catch {
      return []; // corrupt entry
    }
  }

  private write(list: UserTemplate[]): Promise<void> {
    return this.kv.set(this.key, JSON.stringify(list));
  }

  async list(): Promise<UserTemplate[]> {
    return this.read();
  }

  async add(template: UserTemplate): Promise<void> {
    const rest = (await this.read()).filter((t) => t.id !== template.id);
    await this.write([template, ...rest]);
  }

  async remove(id: string): Promise<void> {
    await this.write((await this.read()).filter((t) => t.id !== id));
  }
}

let store: TemplateStore = new KeyValueTemplateStore();

export function getTemplateStore(): TemplateStore {
  return store;
}

export function setTemplateStore(next: TemplateStore): void {
  store = next;
}
