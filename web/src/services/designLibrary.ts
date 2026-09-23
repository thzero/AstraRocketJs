// The saved-designs library.
//
// Before this, the app held exactly ONE design: a single blob under
// `astrarrocketjs:workspace`, replaced whenever you opened another. That was a
// localStorage-era shape — with IndexedDB there is no reason a design has to be
// the only one. Designs are now addressable:
//
//   astrarrocketjs:designs:index        → DesignMeta[]  (small: id, name, updatedAt)
//   astrarrocketjs:designs:<id>         → one Workspace blob (the INPUTS)
//   astrarrocketjs:designs:<id>:results → that design's flight results
//   astrarrocketjs:designs:active       → the id currently open
//
// The index is deliberately separate from the designs. Autosave runs on a 500 ms
// debounce while you edit, so it must rewrite ONE design — not a single document
// containing every design, which would grow with the library and get rewritten
// on every keystroke.
//
// Flight RESULTS are separate for the same reason, one level down. A result is
// tens of thousands of per-timestep samples; the inputs are a few kilobytes. Held
// in the one blob, every keystroke's autosave would re-serialize every flight the
// design has ever run. Split, the inputs stay cheap to write and the results are
// written only when a run actually produces one (see workspaceStore.save).
import type { KeyValueStore } from './keyValueStore';
import { IndexedDbKeyValueStore } from './idbKeyValueStore';
import type { Workspace } from './workspaceStore';
import type { FlightResult } from '../engine/openRocketEngine';

/** A design's cached flights, by simulation id. */
export type StoredResults = Record<string, FlightResult>;

const INDEX_KEY = 'astrarrocketjs:designs:index';
const ACTIVE_KEY = 'astrarrocketjs:designs:active';
const designKey = (id: string) => `astrarrocketjs:designs:${id}`;
const resultsKey = (id: string) => `astrarrocketjs:designs:${id}:results`;
/** The pre-library single-workspace key, migrated on first use. */
const LEGACY_KEY = 'astrarrocketjs:workspace';

export interface DesignMeta {
  id: string;
  name: string;
  /** Epoch ms of the last save; the library lists most-recent first. */
  updatedAt: number;
}

const isMeta = (v: unknown): v is DesignMeta => {
  const m = v as DesignMeta | null;
  return !!m && typeof m.id === 'string' && typeof m.name === 'string' && typeof m.updatedAt === 'number';
};

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
/** A summary field the kernel may legitimately leave unset. */
const isNullableNumber = (v: unknown): boolean => v === null || isFiniteNumber(v);

/**
 * Is this stored value really a flight result this build can render?
 *
 * Deliberately strict about FINITENESS, not just types: `JSON.stringify` turns
 * `NaN` and `Infinity` into `null`, so a summary that went through storage can
 * come back with nulls where numbers belong, and the first `.toFixed()` on one
 * throws in the middle of an export the user asked for.
 */
function isFlightResult(v: unknown): v is FlightResult {
  // One narrowing to an open record, then plain property reads: the previous
  // `r.summary as unknown as Record<...>` double cast asserted a FlightResult
  // it had not yet checked and then un-asserted it field by field.
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  const s = r.summary as Record<string, unknown> | undefined;
  if (!s || typeof s !== 'object') return false;
  // FINITE is required only of the three the exporters format directly with
  // `.toFixed()`, which is the crash this guard exists to stop. The rest need
  // only be a number or null: throwing away an otherwise-usable flight because
  // one peripheral field came back odd would be a worse trade than the bug.
  for (const k of ['maxAltitude', 'maxVelocity', 'maxAcceleration']) {
    if (!isFiniteNumber(s[k])) return false;
  }
  for (const k of [
    'maxMachNumber',
    'timeToApogee',
    'flightTime',
    'groundHitVelocity',
    'launchRodVelocity',
    'deploymentVelocity',
    'optimumDelay',
  ]) {
    if (!isNullableNumber(s[k])) return false;
  }
  const series = r.series as Record<string, unknown> | undefined;
  if (!series || typeof series !== 'object') return false;
  for (const k of ['time', 'altitude', 'velocity', 'acceleration']) {
    if (!Array.isArray(series[k])) return false;
  }
  return Array.isArray(r.events);
}

/** Short, collision-free enough for a per-browser library. */
const freshId = () => `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export class DesignLibrary {
  constructor(private readonly kv: KeyValueStore = new IndexedDbKeyValueStore()) {}

  // --- index -------------------------------------------------------------

  /** Saved designs, most recently updated first. */
  async list(): Promise<DesignMeta[]> {
    await this.migrateLegacy();
    return (await this.readIndex()).slice().sort((a, b) => b.updatedAt - a.updatedAt);
  }

  private async readIndex(): Promise<DesignMeta[]> {
    const raw = await this.kv.get(INDEX_KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? parsed.filter(isMeta) : [];
    } catch {
      return []; // corrupt index — the designs themselves are still addressable
    }
  }

  private async writeIndex(list: DesignMeta[]): Promise<boolean> {
    return await this.kv.set(INDEX_KEY, JSON.stringify(list));
  }

  /**
   * Mutate the index ATOMICALLY: read, transform and write in one store
   * transaction.
   *
   * Every mutation here used to be `readIndex()` then `writeIndex()`, with
   * several awaited round trips in between. This is an installable PWA and
   * IndexedDB is shared across tabs, so two tabs saving at once both read
   * `[X]`, one writes `[A,X]`, the other writes `[B,X]`, and one entry is
   * gone. Since `activeId()` filters against the index, that design becomes
   * unreachable and its bytes are orphaned.
   */
  private async mutateIndex(fn: (list: DesignMeta[]) => DesignMeta[]): Promise<boolean> {
    return await this.kv.update(INDEX_KEY, (raw) => {
      let list: DesignMeta[] = [];
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as unknown;
          if (Array.isArray(parsed)) list = parsed.filter(isMeta);
        } catch {
          /* corrupt index: rebuild from this mutation alone */
        }
      }
      return JSON.stringify(fn(list));
    });
  }

  // --- active design -----------------------------------------------------

  async activeId(): Promise<string | null> {
    await this.migrateLegacy();
    const id = await this.kv.get(ACTIVE_KEY);
    if (!id) return null;
    // An id pointing at a deleted design would strand the app on an empty
    // workspace it cannot save to.
    return (await this.readIndex()).some((m) => m.id === id) ? id : null;
  }

  /** Point the library at a design. False if storage refused the write. */
  async setActive(id: string): Promise<boolean> {
    // The boolean was discarded. `KeyValueStore.set` reports refusal by
    // returning false rather than throwing, so switching designs resolved
    // cleanly on a quota failure: this session edited the new design and the
    // next load reopened the previous one.
    return await this.kv.set(ACTIVE_KEY, id);
  }

  // --- designs -----------------------------------------------------------

  async read(id: string): Promise<Workspace | null> {
    const raw = await this.kv.get(designKey(id));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as Workspace;
    } catch {
      return null;
    }
  }

  /** Write a design and stamp its index entry. Returns false if storage refused. */
  async write(id: string, name: string, w: Workspace): Promise<boolean> {
    if (!(await this.kv.set(designKey(id), JSON.stringify(w)))) return false;
    // The index write counts too. It was treated as survivable on the grounds
    // that the design itself is stored — but `activeId()` filters against this
    // index, so a design missing from it is unreachable: a newly created one
    // vanishes and the next session opens empty over orphaned bytes, and an
    // existing one stops advancing its `updatedAt` so the library list silently
    // goes stale. Reporting the failure lets `workspaceStore.save()` raise
    // "storage full" instead of the user finding out later.
    return await this.mutateIndex((list) => [{ id, name, updatedAt: Date.now() }, ...list.filter((m) => m.id !== id)]);
  }

  /**
   * Register a new design and make it active. Returns its meta.
   *
   * Throws `storage-full` if the write is refused. It used to discard `write`'s
   * boolean and fall back to a FABRICATED meta, so the caller got a clean
   * resolve for a design that was never stored — and this is the path taken by
   * the first save of a session, i.e. exactly when there is no other copy yet.
   */
  async create(name: string, w: Workspace): Promise<DesignMeta> {
    const id = freshId();
    if (!(await this.write(id, name, w))) throw new Error('storage-full');
    // Same rule for the pointer: a design that is written and indexed but not
    // active works for this session and then the next launch opens the
    // previous one, with the user's new rocket sitting in the library list.
    //
    // ROLL BACK before throwing. The caller (workspaceStore.save) still has no
    // active id, so its next autosave creates again — and a half-done create
    // that left an indexed design behind added one identical row to the
    // library per retry, i.e. one every 500 ms for as long as the pointer
    // write kept failing.
    if (!(await this.setActive(id))) {
      await this.remove(id);
      throw new Error('storage-full');
    }
    const meta = (await this.readIndex()).find((m) => m.id === id);
    return meta ?? { id, name, updatedAt: Date.now() };
  }

  /** Rename a design. False if storage refused the write. */
  async rename(id: string, name: string): Promise<boolean> {
    // Also had its boolean discarded: the UI showed the new name from memory
    // and the next session showed the old one.
    return await this.mutateIndex((list) => list.map((m) => (m.id === id ? { ...m, name } : m)));
  }

  // --- flight results ----------------------------------------------------

  /**
   * A design's cached flights. Missing, unreadable or malformed reads as
   * "none" for the entries that fail, keeping the ones that do not.
   *
   * Every entry is shape-checked. The inputs go through `workspaceStore`'s
   * `validate`, but this path had only `typeof parsed === 'object'` and the
   * values are re-attached to simulations and rendered straight into charts,
   * CSV and the KML/GPX export. Two things get through otherwise: a blob from
   * a different build shape, and - more insidiously - `NaN`/`Infinity`, which
   * `JSON.stringify` writes as `null`, so a summary number comes back null and
   * the first `.toFixed()` on it throws mid-export.
   */
  async readResults(id: string): Promise<StoredResults> {
    const raw = await this.kv.get(resultsKey(id));
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
      const out: StoredResults = {};
      for (const [simId, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (isFlightResult(value)) out[simId] = value;
      }
      return out;
    } catch {
      return {}; // a truncated blob costs a re-run, not the design
    }
  }

  /**
   * Replace a design's cached flights. An empty map REMOVES the key rather than
   * storing `{}`, so a design whose results were all invalidated stops occupying
   * space for them.
   *
   * Best-effort by design: unlike the inputs, a result that will not fit is
   * recomputable, so a refused write is not worth failing a save over.
   */
  async writeResults(id: string, results: StoredResults): Promise<boolean> {
    if (!Object.keys(results).length) {
      await this.kv.remove(resultsKey(id));
      return true;
    }
    return await this.kv.set(resultsKey(id), JSON.stringify(results));
  }

  /**
   * Delete a design. False if the index write was refused, in which case
   * nothing is deleted.
   *
   * The INDEX GOES FIRST, and the blobs only if it lands. The other order left
   * the library listing a design whose bytes were gone whenever the index
   * write was refused (quota, or the degraded localStorage fallback):
   * `activeId()` returned it, `read()` returned null, and
   * `workspaceStore.readActive` threw `unreadable-design`, so the app opened
   * broken. Every other path in this file was hardened to gate on the index
   * write; this one was not. Orphaned bytes are the better failure: they cost
   * space, not a working app.
   */
  async remove(id: string): Promise<boolean> {
    if (!(await this.mutateIndex((list) => list.filter((m) => m.id !== id)))) return false;
    await this.kv.remove(designKey(id));
    await this.kv.remove(resultsKey(id)); // or the flights outlive their design
    if ((await this.kv.get(ACTIVE_KEY)) === id) await this.kv.remove(ACTIVE_KEY);
    return true;
  }

  // --- migration ---------------------------------------------------------

  private migrated: Promise<void> | null = null;

  /**
   * Fold a pre-library single workspace into the library as its first design.
   *
   * Runs at most once per session and only when there is no index yet, so an
   * empty library created by the user deleting everything is not re-seeded from
   * a stale legacy blob. The legacy key is removed only after the design is
   * safely written.
   */
  private migrateLegacy(): Promise<void> {
    return (this.migrated ??= (async () => {
      try {
        if (await this.kv.get(INDEX_KEY)) return; // library already exists
        const raw = await this.kv.get(LEGACY_KEY);
        if (!raw) {
          await this.writeIndex([]); // mark the library as initialized
          return;
        }
        const id = freshId();
        if (!(await this.kv.set(designKey(id), raw))) return; // retry next session
        // The INDEX write gates the delete too, for the same reason the blob
        // write does. `activeId()` filters against this index, so a design
        // missing from it is unreachable — and the line below removes the only
        // other copy. Blob stored + index refused (quota, degraded fallback)
        // used to leave the user opening an empty workspace with their
        // pre-library design gone for good.
        if (!(await this.writeIndex([{ id, name: legacyName(raw), updatedAt: Date.now() }]))) return;
        await this.setActive(id);
        await this.kv.remove(LEGACY_KEY);
      } catch {
        // Never let a migration problem stop the app from starting.
      }
    })());
  }
}

/** Name the migrated design after its imported .ork, else a sensible default. */
function legacyName(raw: string): string {
  try {
    const w = JSON.parse(raw) as Workspace;
    const name = w.loadedMeta?.name?.trim();
    if (name) return name;
  } catch {
    /* fall through */
  }
  return 'My Rocket';
}

let library = new DesignLibrary();
export function getDesignLibrary(): DesignLibrary {
  return library;
}
/** Swap the library (tests, or a different backend). */
export function setDesignLibrary(next: DesignLibrary): void {
  library = next;
}
