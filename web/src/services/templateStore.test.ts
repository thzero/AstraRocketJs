import { describe, it, expect } from 'vitest';
import { KeyValueTemplateStore, parseTemplateFilename, type UserTemplate } from './templateStore';
import type { KeyValueStore } from './keyValueStore';

class FakeKv implements KeyValueStore {
  map = new Map<string, string>();
  async get(k: string) {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  async set(k: string, v: string) {
    this.map.set(k, v);
  }
  async remove(k: string) {
    this.map.delete(k);
  }
}

const KEY = 'astrarrocketjs:templates:custom';
const tpl = (id: string, ext = 'kml'): UserTemplate => ({
  id,
  name: id.replace(/\..*$/, ''),
  ext,
  source: `{{title}}`,
});

describe('parseTemplateFilename', () => {
  it('splits <name>.<ext>.mustache into name + extension', () => {
    expect(parseTemplateFilename('my-waypoints.csv.mustache')).toEqual({
      id: 'my-waypoints.csv.mustache',
      name: 'my-waypoints',
      ext: 'csv',
    });
    expect(parseTemplateFilename('track.kml.mustache')).toEqual({
      id: 'track.kml.mustache',
      name: 'track',
      ext: 'kml',
    });
  });

  it('defaults a bare <name>.mustache to the txt extension', () => {
    expect(parseTemplateFilename('notes.mustache')).toEqual({ id: 'notes.mustache', name: 'notes', ext: 'txt' });
  });

  it('lowercases the extension', () => {
    expect(parseTemplateFilename('a.GPX.mustache').ext).toBe('gpx');
  });
});

describe('KeyValueTemplateStore', () => {
  it('adds, lists (newest first), and removes by id', async () => {
    const store = new KeyValueTemplateStore(KEY, new FakeKv());
    await store.add(tpl('a.kml.mustache'));
    await store.add(tpl('b.gpx.mustache', 'gpx'));
    expect((await store.list()).map((t) => t.id)).toEqual(['b.gpx.mustache', 'a.kml.mustache']);
    await store.remove('a.kml.mustache');
    expect((await store.list()).map((t) => t.id)).toEqual(['b.gpx.mustache']);
  });

  it('replaces an existing template with the same id', async () => {
    const store = new KeyValueTemplateStore(KEY, new FakeKv());
    await store.add({ id: 'x.kml.mustache', name: 'x', ext: 'kml', source: 'one' });
    await store.add({ id: 'x.kml.mustache', name: 'x', ext: 'kml', source: 'two' });
    const list = await store.list();
    expect(list.length).toBe(1);
    expect(list[0]!.source).toBe('two');
  });

  it('survives a corrupt store entry', async () => {
    const kv = new FakeKv();
    await kv.set(KEY, '{not json');
    const store = new KeyValueTemplateStore(KEY, kv);
    expect(await store.list()).toEqual([]);
  });
});
