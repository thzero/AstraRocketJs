import { describe, it, expect, vi } from 'vitest';
import { hasThrustCurve } from './runnability';

/**
 * A `.ork` whose mount carries NO motor at all (as opposed to one it names
 * but the app cannot produce, covered in loadOrk.test.ts). The policy is the
 * same: the mount is seated with a curve-less placeholder so the run gate
 * blocks with "no motor", and the import notes say which mount to fill.
 * Nothing downstream may treat the missing entry as a hole to fill with a
 * default C6, which is what `wireLoadedOrk` and `reconcileMounts` used to do.
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
    tree: {
      name: 'Empty',
      components: [
        {
          type: 'stage',
          id: 's',
          children: [
            { type: 'bodytube', id: 'body', length: 0.3, outerRadius: 0.012, motorMount: true, name: 'Body' },
            { type: 'innertube', id: 'pod', length: 0.07, outerRadius: 0.0095, motorMount: true, name: 'Pod mount' },
          ],
        },
      ],
    },
    motors: {},
    notes: [],
    ignored: [],
  }),
}));

vi.mock('./thrustcurve', () => ({ fetchMotorSpec: vi.fn() }));
vi.mock('./motorDb', () => ({ loadCatalog: () => Promise.resolve([]), findCatalogMotor: () => undefined }));

const { loadOrk, emptyMountMotor } = await import('./loadOrk');

describe('loadOrk with mounts the file gave no motor', () => {
  it('seats a curve-less placeholder in every empty mount', async () => {
    const loaded = await loadOrk(new ArrayBuffer(0));
    expect(Object.keys(loaded.motorSpecs).sort()).toEqual(['body', 'pod']);
    for (const m of Object.values(loaded.motorSpecs)) {
      expect(hasThrustCurve(m.spec)).toBe(false);
      expect(m.spec.designation).toBe('');
    }
    expect(design.setMotorById).not.toHaveBeenCalled();
  });

  it('names the empty mounts in one note that says no default will fly', async () => {
    const loaded = await loadOrk(new ArrayBuffer(0));
    const note = loaded.notes.find((n) => /No motor in this file/.test(n));
    expect(note).toBeDefined();
    expect(note).toMatch(/"Body"/);
    expect(note).toMatch(/"Pod mount"/);
    expect(note).toMatch(/won't fly a default/);
  });

  it('the placeholder itself has no curve', () => {
    expect(hasThrustCurve(emptyMountMotor())).toBe(false);
  });
});
