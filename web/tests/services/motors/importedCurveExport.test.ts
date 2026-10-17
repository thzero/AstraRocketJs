// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { CatalogMotor } from '../../../src/services/motors/motorDb';
import { buildExportMotorMap, fillMotorDigests } from '../../../src/services/motors/exportMotors';
import { newFlightConfig, type MountMotor } from '../../../src/services/flight/flightConfigs';
import { importOrk } from '../../../src/services/files/orkFile';
import { orkArchive } from '../../../src/services/files/saveOrk';
import { loadOrk } from '../../../src/services/files/loadOrk';
import { parseEng } from '../../../src/services/motors/engParser';
import { customMotorToSpec } from '../../../src/services/motors/thrustcurve';
import type { MotorSpec } from '../../../src/engine/openRocketEngine';

/**
 * A curve the user imported from an `.eng` file, under exactly the maker and
 * name of a catalog motor, is still the user's curve. Saved as the catalog
 * motor (its digest, no curve) it would reopen as the catalog's curve, here and
 * in desktop, and the user's samples would be gone. It goes out embedded, so
 * the file reopens on the samples that were flown.
 */

const CATALOG = JSON.parse(
  readFileSync(resolve(process.cwd(), 'public/data/motors.generated.json'), 'utf8'),
) as CatalogMotor[];

vi.mock('../../../src/services/motors/motorDb', async (original) => ({
  ...(await original<typeof import('../../../src/services/motors/motorDb')>()),
  loadCatalog: vi.fn(async () => CATALOG),
}));

vi.mock('../../../src/engine/openRocketEngine', async (original) => ({
  ...(await original<typeof import('../../../src/engine/openRocketEngine')>()),
  OpenRocketDesign: {
    buildTree: () => ({ setMotorById: () => {}, setMotorIgnitionById: () => {}, staticInfo: () => ({}) }),
  },
  resetEngine: () => {},
}));

// A catalog motor reopened from the catalog would come back with the
// catalog's own curve; this stands in for that download.
const fetchMotorSpec = vi.hoisted(() => vi.fn());
vi.mock('../../../src/services/motors/thrustcurve', async (original) => ({
  ...(await original<typeof import('../../../src/services/motors/thrustcurve')>()),
  fetchMotorSpec,
}));

const catalogC6 = CATALOG.find((m) => m.manufacturer === 'Estes' && m.designation === 'C6')!;

/** An Estes C6 curve of the user's own, unlike the catalog's. */
const ENG = `; a user's own measurement
C6 18 70 0-3-5-7 0.0108 0.0231 Estes
0.05 2.5
0.2 13.0
0.4 7.5
1.2 4.8
1.7 4.1
1.86 0.0
;
`;

const desktopOrk = `<?xml version='1.0' encoding='utf-8'?>
<openrocket version="1.10" creator="OpenRocket 24.12">
  <rocket>
    <name>Motors</name>
    <motorconfiguration configid="cfg-1" default="true">
      <stage number="0" active="true"/>
    </motorconfiguration>
    <subcomponents>
      <stage>
        <name>Sustainer</name>
        <subcomponents>
          <bodytube>
            <name>Body tube</name>
            <length>0.3</length>
            <thickness>0.0005</thickness>
            <radius>0.0125</radius>
            <motormount>
              <ignitionevent>automatic</ignitionevent>
              <ignitiondelay>0.0</ignitiondelay>
              <overhang>0.0</overhang>
              <motor configid="cfg-1">
                <manufacturer>Estes</manufacturer>
                <designation>C6</designation>
                <diameter>0.018</diameter>
                <length>0.07</length>
                <delay>5.0</delay>
              </motor>
            </motormount>
          </bodytube>
        </subcomponents>
      </stage>
    </subcomponents>
  </rocket>
</openrocket>`;

describe('a user-imported curve under a catalog motor’s maker and name', () => {
  it('reopens from the saved file on its own samples', async () => {
    // The premise: the catalog has this maker and name, with a curve of its own.
    expect(catalogC6.digests?.length).toBeGreaterThan(0);
    const [custom] = parseEng(ENG);
    const seated = customMotorToSpec(custom!, 5);
    expect(seated.manufacturer).toBe(catalogC6.manufacturer);
    expect(seated.designation).toBe(catalogC6.designation);
    const stock = catalogC6.curves![0]!.samples.map(([, f]) => f);
    expect(seated.thrusts).not.toEqual(stock);
    fetchMotorSpec.mockImplementation(async (cat: CatalogMotor, delay: number): Promise<MotorSpec> => ({
      ...seated,
      designation: cat.designation,
      times: cat.curves![0]!.samples.map(([t]) => t),
      thrusts: cat.curves![0]!.samples.map(([, f]) => f),
      masses: cat.curves![0]!.samples.map(() => 0.02),
      ejectionDelay: delay,
    }));

    const opened = importOrk(desktopOrk);
    const mountId = Object.keys(opened.motors)[0]!;
    const config = newFlightConfig({ [mountId]: { spec: seated } as MountMotor }, null, 'cfg-1');
    const motors = await fillMotorDigests(buildExportMotorMap(opened.tree, config));
    expect(motors[mountId]!.embedded).toBeDefined();
    const bytes = orkArchive({ name: 'Motors', tree: opened.tree, configs: [{ id: 'cfg-1', name: null, motors }] });

    const reopened = await loadOrk(bytes.slice().buffer as ArrayBuffer);
    const seatedAgain = Object.values(reopened.configs[0]!.motors);
    expect(seatedAgain).toHaveLength(1);
    const spec = seatedAgain[0]!.spec;
    expect(fetchMotorSpec).not.toHaveBeenCalled();
    expect(spec.times).toEqual(seated.times);
    expect(spec.thrusts).toEqual(seated.thrusts);
    expect(spec.masses.map((m) => m.toFixed(9))).toEqual(seated.masses.map((m) => m.toFixed(9)));
  });
});
