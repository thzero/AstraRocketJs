import type { KeyValueStore } from './keyValueStore';

/**
 * The items of a stored JSON array that pass `isItem`, tolerating an absent,
 * corrupt or partly invalid blob: anything that is not an array reads as empty,
 * and a bad row costs that row, not the list.
 */
export function parseJsonList<T>(raw: string | null, isItem: (v: unknown) => v is T): T[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter(isItem) : [];
  } catch {
    return []; // corrupt entry
  }
}

/**
 * A list of user items persisted as one JSON array under one key of a
 * KeyValueStore: the shared storage half of the custom motor, material, part,
 * template and launch location stores. The domain stores wrap it and keep
 * their own public API, ordering and validation.
 *
 * Reads never reject. `list` is read whenever a picker or dialog opens, often
 * beside a catalog fetch, and a storage layer that rejects (blocked IndexedDB,
 * a private window) must not take that dialog down over a feature the user may
 * never have used; it reads as an empty list, the same as a corrupt blob.
 *
 * Writes always report. Each one reads, transforms and writes in one
 * `kv.update` transaction, because IndexedDB is shared across the tabs of this
 * installable PWA and a get/set with an await between them lets two tabs each
 * drop the other's item. `kv.update` reports a refused write by returning
 * false, so that is turned into a `storage-full` rejection: a caller told
 * nothing cannot tell the user the item did not stick.
 */
export class JsonListStore<T> {
  /**
   * @param key the storage key the array lives under.
   * @param isItem accepts a stored row this build can use.
   * @param idOf the identity an upsert replaces and a remove matches by.
   * @param kv where the bytes go.
   * @param normalize applied to every row read back (and so to every row an
   *   update writes again).
   */
  constructor(
    private readonly key: string,
    private readonly isItem: (v: unknown) => v is T,
    private readonly idOf: (item: T) => string,
    private readonly kv: KeyValueStore,
    private readonly normalize: (item: T) => T = (item) => item,
  ) {}

  private parse(raw: string | null): T[] {
    return parseJsonList(raw, this.isItem).map(this.normalize);
  }

  private async mutate(fn: (list: T[]) => T[]): Promise<void> {
    const ok = await this.kv.update(this.key, (raw) => JSON.stringify(fn(this.parse(raw))));
    if (!ok) throw new Error('storage-full');
  }

  /** The stored items in stored order; empty when storage cannot be read. */
  async list(): Promise<T[]> {
    try {
      return this.parse(await this.kv.get(this.key));
    } catch {
      return [];
    }
  }

  /**
   * Put `items` at the head of the list, in the order given, replacing any
   * stored item with the same id. The caller dedupes `items` among themselves.
   */
  async upsert(items: readonly T[]): Promise<void> {
    const incoming = new Set(items.map(this.idOf));
    await this.mutate((list) => [...items, ...list.filter((item) => !incoming.has(this.idOf(item)))]);
  }

  /** Remove the stored item with this id, if any. */
  async remove(id: string): Promise<void> {
    await this.mutate((list) => list.filter((item) => this.idOf(item) !== id));
  }
}
