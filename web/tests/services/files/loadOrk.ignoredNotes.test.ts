// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { noteTexts } from '../../testing/importNotes';

/**
 * A component tag the reader cannot import is named once in the banner, not
 * once by the reader and again by the loader. The real readers run here; only
 * the kernel and the motor catalog are stubbed.
 */

const design = {
  setMotorById: vi.fn(),
  setMotorIgnitionById: vi.fn(),
  staticInfo: vi.fn(() => ({ mass: 1, cgX: 0.5 })),
};

vi.mock('../../../src/engine/openRocketEngine', () => ({
  engineActive: () => true, // the kernel is loaded: the file goes through it
  OpenRocketDesign: { buildTree: () => design },
  resetEngine: () => {},
}));
vi.mock('../../../src/services/motors/thrustcurve', () => ({ fetchMotorSpec: vi.fn() }));
vi.mock('../../../src/services/motors/motorDb', () => ({
  loadCatalog: () => Promise.resolve([]),
  findCatalogMotor: () => undefined,
  matchCatalogMotor: () => undefined,
}));

const { loadOrk } = await import('../../../src/services/files/loadOrk');

const ork = (inner: string): ArrayBuffer => {
  const xml = `<?xml version="1.0"?><openrocket version="1.8"><rocket><name>T</name><subcomponents><stage><name>S</name><subcomponents>${inner}</subcomponents></stage></subcomponents></rocket></openrocket>`;
  const zipped = zipSync({ 'rocket.ork': strToU8(xml) });
  return zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer;
};

describe('loadOrk notes for unsupported component tags', () => {
  it('names one unknown tag in exactly one note', async () => {
    const loaded = await loadOrk(
      ork(
        '<bodytube><name>B</name><length>0.3</length><radius>0.012</radius></bodytube><hovercraft><name>W</name></hovercraft>',
      ),
    );
    expect(noteTexts(loaded.notes).filter((n) => n.includes('hovercraft'))).toHaveLength(1);
  });

  it('gives each unknown tag a note of its own', async () => {
    const loaded = await loadOrk(
      ork('<bodytube><name>B</name><length>0.3</length><radius>0.012</radius></bodytube><hovercraft/><balloon/>'),
    );
    const texts = noteTexts(loaded.notes);
    expect(texts.filter((n) => n.includes('hovercraft'))).toHaveLength(1);
    expect(texts.filter((n) => n.includes('balloon'))).toHaveLength(1);
    expect(texts.filter((n) => n.includes('hovercraft') && n.includes('balloon'))).toHaveLength(0);
  });
});
