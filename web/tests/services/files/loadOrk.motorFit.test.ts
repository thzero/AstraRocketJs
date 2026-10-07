import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * A `.ork` names a motor, and the name is all the catalog is searched by.
 *
 * So nothing stopped a 54 mm Cesaroni J360 being seated in a 38 mm tube: the
 * app flew a rocket on a motor nobody could push into it, and said nothing. The
 * motor browser has judged this all along (`motorFitsMount`) and the file reader
 * never asked.
 *
 * It is still SEATED, because a file is a statement of what somebody built and
 * dropping its motor would be the app overruling it on a tolerance it is
 * guessing at. The note is the point.
 *
 * The engine, the parser and the catalog are mocked: what is under test is the
 * reader's decision, not the kernel.
 */

const design = {
  setMotorById: vi.fn(),
  setMotorIgnitionById: vi.fn(),
  staticInfo: vi.fn(() => ({ mass: 1, cgX: 0.5 })),
};

vi.mock('../../../src/engine/openRocketEngine', () => ({
  OpenRocketDesign: { buildTree: () => design },
  resetEngine: () => {},
}));

/** A 38 mm mount: a 19.5 mm outer radius with a 0.5 mm wall, 300 mm of it. */
const tree = {
  name: 'Fits',
  components: [
    {
      type: 'stage',
      id: 's1',
      children: [
        {
          type: 'bodytube',
          id: 'body',
          length: 0.5,
          outerRadius: 0.04,
          thickness: 0.001,
          children: [
            {
              type: 'innertube',
              id: 'mount1',
              name: 'Motor tube',
              motorMount: true,
              length: 0.3,
              outerRadius: 0.0195,
              thickness: 0.0005,
            },
          ],
        },
      ],
    },
  ],
};

vi.mock('../../../src/services/files/designFile', () => ({
  parseDesignFile: () => ({
    tree,
    motors: { mount1: { designation: 'J360SK', manufacturer: 'Cesaroni', delay: 0, diameter: 0.038, length: 0.3 } },
    notes: [],
    ignored: [],
  }),
}));

const fetchMotorSpec = vi.fn();
vi.mock('../../../src/services/motors/thrustcurve', () => ({
  fetchMotorSpec: (...a: unknown[]) => fetchMotorSpec(...a),
}));

/** What the lookup says about its own confidence, set per test. */
const doubt: { value: string | undefined } = { value: undefined };
const row = { designation: 'J360', manufacturer: 'Cesaroni', diameter: 54 };

vi.mock('../../../src/services/motors/motorDb', () => ({
  loadCatalog: () => Promise.resolve([]),
  findCatalogMotor: () => row,
  matchCatalogMotor: () => ({ motor: row, ...(doubt.value ? { doubt: doubt.value } : {}) }),
}));

const { loadOrk } = await import('../../../src/services/files/loadOrk');

/** A resolved motor of the given size, with a curve so it counts as flyable. */
const spec = (diameter: number, length: number) => ({
  designation: 'J360',
  manufacturer: 'Cesaroni',
  diameter,
  length,
  times: [0, 1, 3],
  thrusts: [0, 600, 0],
  masses: [1.2, 0.9, 0.5],
  cgX: 0.205,
  ejectionDelay: 0,
});

describe('a motor the file names for a mount it does not go in', () => {
  beforeEach(() => {
    fetchMotorSpec.mockReset();
    design.setMotorById.mockReset();
    doubt.value = undefined;
  });

  it('seats it anyway, as the file asks', async () => {
    fetchMotorSpec.mockResolvedValue(spec(0.054, 0.3));
    const loaded = await loadOrk(new ArrayBuffer(0));
    expect(loaded.configs[0]!.motors['mount1']!.spec.designation).toBe('J360');
    expect(design.setMotorById).toHaveBeenCalled();
  });

  it('says it does not fit, naming both diameters', async () => {
    fetchMotorSpec.mockResolvedValue(spec(0.054, 0.3));
    const notes = (await loadOrk(new ArrayBuffer(0))).notes.join(' ');
    expect(notes).toMatch(/54 mm/);
    expect(notes).toMatch(/38 mm/);
    expect(notes).toMatch(/Motor tube/);
    expect(notes).toMatch(/does not fit/i);
  });

  it('says nothing about a motor that fits', async () => {
    fetchMotorSpec.mockResolvedValue(spec(0.038, 0.3));
    const notes = (await loadOrk(new ArrayBuffer(0))).notes.join(' ');
    expect(notes).not.toMatch(/does not fit/i);
  });

  it('judges the length too, against the tube plus its overhang', async () => {
    // 1 m of motor in 300 mm of tube. Length is the other half of a fit, and
    // the browser has always judged both.
    fetchMotorSpec.mockResolvedValue(spec(0.038, 1.0));
    const notes = (await loadOrk(new ArrayBuffer(0))).notes.join(' ');
    expect(notes).toMatch(/1000 mm long/);
    expect(notes).toMatch(/300 mm/);
  });

  it('complains once per mount and motor, not once per configuration', async () => {
    // Three configurations flying the same oversized motor in the same mount is
    // one thing to go and fix, the way an unresolvable motor already is.
    fetchMotorSpec.mockResolvedValue(spec(0.054, 0.3));
    const loaded = await loadOrk(new ArrayBuffer(0));
    expect(loaded.notes.filter((n) => /does not fit/i.test(n))).toHaveLength(1);
  });
});

/**
 * A motor the catalog found but the file did not confirm.
 *
 * The lookup will take a name apart and will settle for another maker's motor
 * rather than none, which is the right trade and is not the file speaking. It
 * used to happen in silence.
 */
describe('a motor the file did not confirm', () => {
  beforeEach(() => {
    fetchMotorSpec.mockReset();
    fetchMotorSpec.mockResolvedValue(spec(0.038, 0.3));
    doubt.value = undefined;
  });

  it('says whose motor it loaded when the maker did not match', async () => {
    doubt.value = 'maker';
    const notes = (await loadOrk(new ArrayBuffer(0))).notes.join(' ');
    expect(notes).toMatch(/Cesaroni J360/);
    expect(notes).toMatch(/check it before flying/i);
  });

  it('says the name was not one the catalog carries', async () => {
    doubt.value = 'shortened';
    expect((await loadOrk(new ArrayBuffer(0))).notes.join(' ')).toMatch(/closest/i);
  });

  it('says when more than one motor matched', async () => {
    doubt.value = 'several';
    expect((await loadOrk(new ArrayBuffer(0))).notes.join(' ')).toMatch(/more than one/i);
  });

  it('says nothing when the file named the motor outright', async () => {
    const notes = (await loadOrk(new ArrayBuffer(0))).notes.join(' ');
    expect(notes).not.toMatch(/check it before flying/i);
  });
});
