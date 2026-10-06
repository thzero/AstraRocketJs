// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MotorSpec } from '../../../src/engine/openRocketEngine';
import { rseDigest } from '../../../src/services/files/ork/embeddedMotors';

/**
 * A `.ork` names an embedded motor by digest. An imported motor can share its
 * name with a catalog motor (a user's own curve for an Estes C6), and matched by
 * name it would reopen as the catalog's motor: a different curve under the same
 * label. The digest says which, so the file's curve wins unless the catalog
 * holds that exact motor.
 *
 * Mocked as in loadOrk.embeddedMotor.test.ts: the wiring decision is under test.
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

const RSE = `<engine-database>
 <engine-list>
  <engine mfg="Estes" code="C6" Type="single-use" dia="18" len="70" initWt="24" propWt="12" auto-calc-mass="0" auto-calc-cg="0">
   <data>
    <eng-data t="0" f="0" m="24" cg="35"/>
    <eng-data t="0.2" f="14" m="21" cg="35"/>
    <eng-data t="1.8" f="0" m="12" cg="35"/>
   </data>
  </engine>
 </engine-list>
</engine-database>
`;
const DIGEST = rseDigest(RSE)!;

const ref = {
  value: { designation: 'C6-5', manufacturer: 'Estes', delay: 5, diameter: 0.018, length: 0.07, digest: DIGEST },
};

vi.mock('../../../src/services/files/designFile', () => ({
  parseDesignFile: () => ({
    tree: { name: 'Mine', components: [] },
    motors: { mount1: ref.value },
    notes: [],
    ignored: [],
    embeddedMotors: [RSE],
  }),
}));

const fetchMotorSpec = vi.fn();
const customMotorToSpec = vi.fn();
vi.mock('../../../src/services/motors/thrustcurve', () => ({
  fetchMotorSpec: (...a: unknown[]) => fetchMotorSpec(...a),
  customMotorToSpec: (...a: unknown[]) => customMotorToSpec(...a),
}));

const catalogDigests = { value: [] as { digest: string; delays: number[] }[] };
const catalogRow = () => ({ designation: 'C6', manufacturer: 'Estes', diameter: 18, digests: catalogDigests.value });
vi.mock('../../../src/services/motors/motorDb', () => ({
  loadCatalog: () => Promise.resolve([]),
  findCatalogMotor: () => catalogRow(),
  matchCatalogMotor: () => ({ motor: catalogRow() }),
}));

const { loadOrk } = await import('../../../src/services/files/loadOrk');

const SPEC = {
  designation: 'C6',
  times: [0, 0.2, 1.8],
  thrusts: [0, 14, 0],
  masses: [0.024, 0.021, 0.012],
} as unknown as MotorSpec;

beforeEach(() => {
  vi.clearAllMocks();
  catalogDigests.value = [];
  customMotorToSpec.mockReturnValue(SPEC);
  fetchMotorSpec.mockResolvedValue({ ...SPEC, designation: 'catalog C6' });
});

describe('an embedded motor named by digest', () => {
  it('reopens with the curve the file carried, not the catalog motor of the same name', async () => {
    const res = await loadOrk(new ArrayBuffer(0));
    expect(fetchMotorSpec).not.toHaveBeenCalled();
    expect(customMotorToSpec).toHaveBeenCalledTimes(1);
    expect(res.configs[0]!.motors['mount1']!.spec).toBe(SPEC);
  });

  it('takes the catalog motor when the catalog holds that exact digest', async () => {
    catalogDigests.value = [{ digest: DIGEST, delays: [5] }];
    await loadOrk(new ArrayBuffer(0));
    expect(fetchMotorSpec).toHaveBeenCalledTimes(1);
    expect(customMotorToSpec).not.toHaveBeenCalled();
  });
});
