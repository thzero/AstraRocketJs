// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { catalogDigest, loadCatalog, type CatalogMotor } from '../../../src/services/motors/motorDb';
import { buildExportMotorMap, fillMotorDigests } from '../../../src/services/motors/exportMotors';
import { newFlightConfig, type MountMotor } from '../../../src/services/flight/flightConfigs';
import { exportOrk, importOrk, type OrkExportMotor } from '../../../src/services/files/orkFile';
import { PLUGGED_DELAY, type MotorSpec } from '../../../src/engine/openRocketEngine';
import { loadOrk } from '../../../src/services/files/loadOrk';

/**
 * Which motor desktop OpenRocket flies for the `<motor>` block a save writes.
 *
 * The lookup below is desktop's own, written out from the Java:
 * MotorHandler.getMotor (core/.../file/openrocket/importt/MotorHandler.java:65)
 * passes the file's type (null when absent), manufacturer (null when absent,
 * :31 and :174), designation and digest, with NaN diameter and length, through
 * the motor finder to ThrustCurveMotorSetDatabase.findMotors
 * (core/.../database/motor/ThrustCurveMotorSetDatabase.java:25-78), which
 * returns the full matches, else the digest matches, else the description
 * matches. A manufacturer filters only when it is non-null (:48), through
 * Manufacturer.matches (core/.../motor/Manufacturer.java:215-219, search string
 * at :262-264). A designation matches when either name contains the other
 * (:50-52).
 *
 * The database is OpenRocket's own: the digests the catalog carries are synced
 * from it, one entry per desktop motor, and a catalog row with none is a motor
 * desktop does not have.
 */
const CATALOG = JSON.parse(
  readFileSync(resolve(process.cwd(), 'public/data/motors.generated.json'), 'utf8'),
) as CatalogMotor[];

vi.mock('../../../src/services/motors/motorDb', async (original) => ({
  ...(await original<typeof import('../../../src/services/motors/motorDb')>()),
  loadCatalog: vi.fn(async () => CATALOG),
}));

// Opening a file resolves its motors against the same catalog; the kernel and
// the curve download are not what is under test, so they are stubbed.
vi.mock('../../../src/engine/openRocketEngine', async (original) => ({
  ...(await original<typeof import('../../../src/engine/openRocketEngine')>()),
  OpenRocketDesign: {
    buildTree: () => ({ setMotorById: () => {}, setMotorIgnitionById: () => {}, staticInfo: () => ({}) }),
  },
  resetEngine: () => {},
}));
vi.mock('../../../src/services/motors/thrustcurve', async (original) => ({
  ...(await original<typeof import('../../../src/services/motors/thrustcurve')>()),
  fetchMotorSpec: vi.fn(async (cat: CatalogMotor, delay: number): Promise<MotorSpec> => ({
    designation: cat.designation,
    manufacturer: cat.manufacturer,
    diameter: cat.diameter / 1000,
    length: (cat.length ?? 0) / 1000,
    times: [0, 1],
    thrusts: [1, 0],
    masses: [0.02, 0.01],
    cgX: (cat.length ?? 0) / 2000,
    ejectionDelay: delay,
  })),
}));

interface DesktopMotor {
  manufacturer: string;
  designation: string;
  digest: string;
}

const DATABASE: DesktopMotor[] = CATALOG.flatMap((row) =>
  (row.digests ?? []).map((d) => ({ manufacturer: row.manufacturer, designation: row.designation, digest: d.digest })),
);

const searchString = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim();

function findMotors(digest: string | null, manufacturer: string | null, designation: string): DesktopMotor[] {
  const full: DesktopMotor[] = [];
  const byDigest: DesktopMotor[] = [];
  const byDescription: DesktopMotor[] = [];
  const want = designation.toUpperCase();
  for (const m of DATABASE) {
    const matchDigest = digest !== null && digest === m.digest;
    const matchDescription =
      (manufacturer === null || searchString(m.manufacturer) === searchString(manufacturer)) &&
      (m.designation.toUpperCase().includes(want) || want.includes(m.designation.toUpperCase()));
    if (matchDigest) byDigest.push(m);
    if (matchDescription) byDescription.push(m);
    if (matchDigest && matchDescription) full.push(m);
  }
  return full.length ? full : byDigest.length ? byDigest : byDescription;
}

/** Desktop's candidates for each `<motor>` block in a saved file, by configid. */
function desktopReads(xml: string): Record<string, DesktopMotor[]> {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const out: Record<string, DesktopMotor[]> = {};
  for (const el of Array.from(doc.querySelectorAll('motormount > motor'))) {
    const tag = (t: string) => el.querySelector(`:scope > ${t}`)?.textContent?.trim() ?? null;
    out[el.getAttribute('configid')!] = findMotors(tag('digest'), tag('manufacturer'), tag('designation')!);
  }
  return out;
}

const row = (manufacturer: string, designation: string) =>
  CATALOG.find((m) => m.manufacturer === manufacturer && m.designation === designation)!;

/** A desktop-shaped file with one configuration and one motor block on a body-tube mount. */
const desktopOrk = (motorBlock: string) => `<?xml version='1.0' encoding='utf-8'?>
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
${motorBlock}
              </motor>
            </motormount>
          </bodytube>
        </subcomponents>
      </stage>
    </subcomponents>
  </rocket>
</openrocket>`;

const spec = (manufacturer: string, designation: string, delay: number): MotorSpec => {
  const r = row(manufacturer, designation);
  return {
    designation,
    manufacturer,
    diameter: r.diameter / 1000,
    length: (r.length ?? 0) / 1000,
    ejectionDelay: delay,
    times: [],
    thrusts: [],
    masses: [],
    cgX: (r.length ?? 0) / 2000,
  };
};

describe('a save names the motor the mount holds, not the one the file was opened on', () => {
  const C6_5 = catalogDigest(row('Estes', 'C6'), 5)!;
  const opened = importOrk(
    desktopOrk(`                <manufacturer>Estes</manufacturer>
                <digest>${C6_5}</digest>
                <designation>C6</designation>
                <diameter>0.018</diameter>
                <length>0.07</length>
                <delay>5.0</delay>`),
  );
  const mountId = Object.keys(opened.motors)[0]!;
  const base = opened.motors as Record<string, OrkExportMotor>;

  const save = async (seated: MotorSpec) => {
    const config = newFlightConfig({ [mountId]: { spec: seated } as MountMotor }, null, 'cfg-1');
    const motors = await fillMotorDigests(buildExportMotorMap(opened.tree, config, base));
    return desktopReads(
      exportOrk({ name: 'Motors', tree: opened.tree, configs: [{ id: 'cfg-1', name: null, motors }] }),
    );
  };

  it('opens on the Estes C6 the file names', () => {
    expect(findMotors(C6_5, 'Estes', 'C6')).toEqual([{ manufacturer: 'Estes', designation: 'C6', digest: C6_5 }]);
  });

  it('does not send desktop back to the C6 when the new motor is one its database lacks', async () => {
    // SCR A8 has no desktop digest, so the catalog gives none to write.
    expect(row('SCR', 'A8').digests ?? []).toEqual([]);
    const found = (await save(spec('SCR', 'A8', 5)))['cfg-1']!;
    expect(found.filter((m) => m.designation !== 'A8')).toEqual([]);
  });

  it('does not send desktop back to the C6 when the catalog cannot load', async () => {
    vi.mocked(loadCatalog).mockRejectedValueOnce(new Error('offline'));
    const found = (await save(spec('Estes', 'D12', 5)))['cfg-1']!;
    expect(found.length).toBeGreaterThan(0);
    expect(found.every((m) => m.designation === 'D12' && m.manufacturer === 'Estes')).toBe(true);
  });

  it('still writes the file’s own digest while the mount holds the motor the file named', async () => {
    vi.mocked(loadCatalog).mockRejectedValueOnce(new Error('offline'));
    const found = (await save(spec('Estes', 'C6', 5)))['cfg-1']!;
    expect(found).toEqual([{ manufacturer: 'Estes', designation: 'C6', digest: C6_5 }]);
  });
});

describe('a motor the file names no manufacturer for', () => {
  const xml = desktopOrk(`                <designation>C11</designation>
                <diameter>0.024</diameter>
                <length>0.07</length>
                <delay>5.0</delay>`);
  const opened = importOrk(xml);
  const ref = Object.values(opened.motors)[0]!;
  const desktopFinds = findMotors(null, null, 'C11');

  it('is one desktop finds by its designation alone', () => {
    expect(desktopFinds.map((m) => `${m.manufacturer} ${m.designation}`)).toEqual(['Estes C11']);
  });

  it('is read with no manufacturer, as desktop reads it', () => {
    expect(ref.manufacturer).toBeUndefined();
  });

  it('opens on the motor desktop finds for it', async () => {
    const loaded = await loadOrk(new TextEncoder().encode(xml).buffer as ArrayBuffer);
    const seated = Object.values(loaded.configs[0]!.motors)[0]!.spec;
    expect([`${seated.manufacturer} ${seated.designation}`]).toEqual(
      desktopFinds.map((m) => `${m.manufacturer} ${m.designation}`),
    );
    expect(seated.thrusts.length).toBeGreaterThan(0);
  });

  it('saves to a block desktop still finds the same motor for', () => {
    const { mountId: _mountId, ...motor } = ref;
    const xml = exportOrk({
      name: 'Motors',
      tree: opened.tree,
      configs: [{ id: 'cfg-1', name: null, motors: { [ref.mountId!]: motor } }],
    });
    expect(desktopReads(xml)['cfg-1']).toEqual(desktopFinds);
  });
});

/** Each of the tests below walks the whole catalog, a file per row. */
const WHOLE_CATALOG_MS = 120_000;

/** A motor seated on the body tube of a desktop-shaped file with an empty mount. */
const blank = importOrk(
  desktopOrk(`                <designation>C6</designation>
                <diameter>0.018</diameter>
                <length>0.07</length>
                <delay>5.0</delay>`),
);
const blankMount = Object.keys(blank.motors)[0]!;

/** What desktop reads, and what the save carried, for `seated` alone in that mount. */
async function saveSeated(seated: MotorSpec) {
  const config = newFlightConfig({ [blankMount]: { spec: seated } as MountMotor }, null, 'cfg-1');
  const motors = await fillMotorDigests(buildExportMotorMap(blank.tree, config));
  const xml = exportOrk({ name: 'Motors', tree: blank.tree, configs: [{ id: 'cfg-1', name: null, motors }] });
  return { motor: motors[blankMount]!, found: desktopReads(xml)['cfg-1']! };
}

/** A user's own curve under a given maker and name, at a given diameter (m). */
const ownCurve = (manufacturer: string | undefined, designation: string, diameter: number): MotorSpec => ({
  designation,
  ...(manufacturer ? { manufacturer } : {}),
  diameter,
  length: 0.1,
  ejectionDelay: 5,
  times: [0, 0.2, 1.8],
  thrusts: [0, 40, 0],
  masses: [0.09, 0.08, 0.05],
  cgX: 0.05,
});

/** The spec as `fetchMotorSpec` seats a row: its common name, with the code beside it. */
const picked = (r: CatalogMotor, delay: number): MotorSpec => ({
  designation: r.designation,
  ...(r.code && r.code !== r.designation ? { code: r.code } : {}),
  manufacturer: r.manufacturer,
  diameter: r.diameter / 1000,
  length: (r.length ?? 0) / 1000,
  ejectionDelay: delay,
  times: [0, 0.2, 1.8],
  thrusts: [0, 40, 0],
  masses: [0.09, 0.08, 0.05],
  cgX: (r.length ?? 0) / 2000,
});

const inDatabase = (digest: string | undefined) => DATABASE.some((m) => m.digest === digest);

describe('a motor the catalog cannot name for certain', () => {
  it.each([
    ['a maker the catalog does not carry', 'Homemade', 'G80', 0.029],
    ['a shortened name', 'AeroTech', 'H128W-OLD', 0.029],
    ['no maker, where several makers sell the name', undefined, 'C6', 0.018],
  ])('goes out with its own curve, under no stock motor’s digest: %s', async (_case, maker, name, diameter) => {
    // The premise: the name alone reaches a stock motor desktop has.
    expect(findMotors(null, null, name).length).toBeGreaterThan(0);
    const { motor, found } = await saveSeated(ownCurve(maker, name, diameter));
    expect(motor.embedded).toBeDefined();
    expect(motor.digest).toBe(motor.embedded!.digest);
    expect(inDatabase(motor.digest)).toBe(false);
    // Desktop then has no digest match, which is what puts a stock motor
    // ahead of the curve the file carries.
    expect(found.filter((m) => m.digest === motor.digest)).toEqual([]);
  });

  it(
    'never takes a stock digest for a curve under a maker the catalog does not carry, whatever its name',
    async () => {
      const taken: string[] = [];
      for (const r of CATALOG.filter((m) => m.digests?.length)) {
        const { motor } = await saveSeated(ownCurve('Homemade', r.code ?? r.designation, r.diameter / 1000));
        if (inDatabase(motor.digest)) taken.push(`${r.manufacturer} ${r.code ?? r.designation}`);
      }
      expect(taken).toEqual([]);
    },
    WHOLE_CATALOG_MS,
  );
});

describe('a motor seated from the catalog', () => {
  /** The name a row is seated under: its full code, else its common name. */
  const seatedName = (r: CatalogMotor) => (r.code ?? r.designation).toLowerCase();
  /** Another row of the same maker and diameter answers to that name too. */
  const shared = (r: CatalogMotor) =>
    CATALOG.some(
      (o) =>
        o !== r &&
        o.manufacturer === r.manufacturer &&
        Math.abs(o.diameter - r.diameter) <= 1 &&
        [o.designation.toLowerCase(), (o.code ?? '').toLowerCase()].includes(seatedName(r)),
    );
  const digested = CATALOG.filter((m) => m.digests?.length);
  const delayOf = (r: CatalogMotor) => r.digests![0]!.delays.find((d) => d !== 'P') ?? PLUGGED_DELAY;

  it(
    'opens in desktop as that row’s own entry, for every row its name and size pick out',
    async () => {
      const wrong: string[] = [];
      for (const r of digested.filter((m) => !shared(m))) {
        const want = catalogDigest(r, delayOf(r))!;
        const { motor, found } = await saveSeated(picked(r, delayOf(r)));
        if (motor.embedded || !found.length || found.some((m) => m.digest !== want)) {
          wrong.push(`${r.manufacturer} ${r.code ?? r.designation}`);
        }
      }
      expect(wrong.join('; ')).toBe('');
    },
    WHOLE_CATALOG_MS,
  );

  it(
    'carries its own curve where another row of that maker and size shares its name',
    async () => {
      const both = digested.filter(shared);
      expect(both.length).toBeGreaterThan(0);
      for (const r of both) {
        const { motor } = await saveSeated(picked(r, delayOf(r)));
        expect(motor.embedded, `${r.manufacturer} ${r.designation}`).toBeDefined();
        expect(motor.digest).toBe(motor.embedded!.digest);
      }
    },
    WHOLE_CATALOG_MS,
  );
});

describe('a desktop file saved again while the catalog cannot load', () => {
  /** Rows desktop writes by a full code the seated spec keeps beside its common name. */
  const coded = CATALOG.filter((r) => r.digests?.length && r.code && r.code !== r.designation);

  it(
    'keeps the file’s digest for a motor desktop named by its full code',
    async () => {
      expect(coded.find((r) => r.manufacturer === 'AeroTech' && r.code === 'H128W')).toBeDefined();
      const lost: string[] = [];
      for (const r of coded) {
        const delay = r.digests![0]!.delays.find((d) => d !== 'P') ?? 0;
        const digest = catalogDigest(r, delay)!;
        const opened = importOrk(
          desktopOrk(`                <manufacturer>${r.manufacturer}</manufacturer>
                <digest>${digest}</digest>
                <designation>${r.code}</designation>
                <diameter>${r.diameter / 1000}</diameter>
                <length>${(r.length ?? 0) / 1000}</length>
                <delay>${delay}</delay>`),
        );
        const mountId = Object.keys(opened.motors)[0]!;
        const seated = picked(r, delay);
        const config = newFlightConfig({ [mountId]: { spec: seated } as MountMotor }, null, 'cfg-1');
        vi.mocked(loadCatalog).mockRejectedValueOnce(new Error('offline'));
        const motors = await fillMotorDigests(
          buildExportMotorMap(opened.tree, config, opened.motors as Record<string, OrkExportMotor>),
        );
        const xml = exportOrk({ name: 'Motors', tree: opened.tree, configs: [{ id: 'cfg-1', name: null, motors }] });
        const found = desktopReads(xml)['cfg-1']!;
        if (!found.length || found.some((m) => m.digest !== digest)) lost.push(`${r.manufacturer} ${r.code}`);
      }
      expect(lost.join('; ')).toBe('');
    },
    WHOLE_CATALOG_MS,
  );
});
