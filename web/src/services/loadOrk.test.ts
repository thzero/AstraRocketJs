import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * A `.ork` names a motor. If we cannot produce that motor, the mount must end
 * up holding an UNRESOLVED placeholder, never a default.
 *
 * `loadOrk` already did that when the catalog lookup MISSED, with a comment
 * saying why: "the run is blocked until the user picks a real motor, and
 * nothing silently flies a C6". But when the catalog HIT and the thrust-curve
 * download then threw, the catch only pushed a note and left the mount unset,
 * and `mountMotors` seeds a default C6 into any mount without one. So a single
 * transient thrustcurve.org failure while opening an L-motor design produced a
 * runnable simulation flying a 10 N-s C6, with the only warning buried in the
 * import notes that `settings.showImportNotes` can hide.
 *
 * The engine, the zip parser and the catalog are all mocked: what is under
 * test is the wiring decision, not the kernel.
 */

const design = {
  setMotorById: vi.fn(),
  setMotorIgnitionById: vi.fn(),
  staticInfo: vi.fn(() => ({ mass: 1, cgX: 0.5 })),
};

vi.mock('../engine/openRocketEngine', () => ({
  OpenRocketDesign: { buildTree: () => design },
  resetEngine: () => {},
}));

// The PARSER is stubbed, not the file format: these cover what loadOrk does
// with an import RESULT (resolving motors, seating placeholders), and the two
// readers behind `parseDesignFile` have tests of their own. Mocking the
// dispatcher rather than `./orkFile` keeps that true now that loadOrk reads
// both `.ork` and `.rkt`.
vi.mock('./designFile', () => ({
  parseDesignFile: () => ({
    tree: { name: 'Big', components: [] },
    motors: { mount1: { designation: 'K550', manufacturer: 'AeroTech', delay: 0, diameter: 0.054, length: 0.41 } },
    notes: [],
    ignored: [],
  }),
}));

const fetchMotorSpec = vi.fn();
vi.mock('./thrustcurve', () => ({ fetchMotorSpec: (...a: unknown[]) => fetchMotorSpec(...a) }));

vi.mock('./motorDb', () => ({
  loadCatalog: () => Promise.resolve([]),
  // The catalog HITS: this is the path where the designation is known and only
  // the curve download fails.
  findCatalogMotor: () => ({ designation: 'K550', manufacturer: 'AeroTech', diameter: 54 }),
}));

const { loadOrk } = await import('./loadOrk');

describe('loadOrk when the thrust-curve download fails', () => {
  beforeEach(() => {
    fetchMotorSpec.mockReset();
    design.setMotorById.mockReset();
  });

  it('seats the unresolved motor rather than leaving the mount for a default C6', async () => {
    fetchMotorSpec.mockRejectedValue(new Error('network down'));
    const loaded = await loadOrk(new ArrayBuffer(0));

    const seated = loaded.motorSpecs['mount1'];
    expect(seated).toBeDefined();
    expect(seated!.spec.designation).toBe('K550');
    // An unresolved motor carries the designation but NO curve, which is what
    // blocks the run instead of flying something the file never asked for.
    expect(seated!.spec.times).toEqual([]);
    expect(seated!.spec.thrusts).toEqual([]);
  });

  it('says so in the import notes, naming the mount as unflyable', async () => {
    fetchMotorSpec.mockRejectedValue(new Error('network down'));
    const loaded = await loadOrk(new ArrayBuffer(0));
    expect(loaded.notes.join(' ')).toMatch(/K550/);
    expect(loaded.notes.join(' ')).toMatch(/won't fly a default/i);
  });

  it('still seats the real motor when the download succeeds', async () => {
    fetchMotorSpec.mockResolvedValue({
      designation: 'K550',
      manufacturer: 'AeroTech',
      diameter: 0.054,
      length: 0.41,
      times: [0, 1, 3],
      thrusts: [0, 600, 0],
      masses: [1.2, 0.9, 0.5],
      cgX: 0.205,
      ejectionDelay: 0,
    });
    const loaded = await loadOrk(new ArrayBuffer(0));
    expect(loaded.motorSpecs['mount1']!.spec.times).toHaveLength(3);
    expect(design.setMotorById).toHaveBeenCalled();
  });
});
