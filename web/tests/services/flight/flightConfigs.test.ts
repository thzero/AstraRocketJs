import { describe, it, expect } from 'vitest';
import {
  designDeployment,
  designSeparation,
  effectiveDeployment,
  effectiveSeparation,
  configuredTree,
  deployOverride,
  sepOverride,
  stageFlies,
  configFor,
  ensureConfig,
  liveMotors,
  loadoutSignature,
  motorSpecs,
  newFlightConfig,
  type FlightConfig,
  primaryMotor,
  reconcileConfig,
  reconcileConfigs,
  seatedMotorsKey,
} from '../../../src/services/flight/flightConfigs';
import { C6 } from '../../../src/engine/api';
import { parseDelays } from '../../../src/services/motors/motorPicker';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ComponentNode, MotorSpec, RocketTree } from '../../../src/engine/openRocketEngine';

const node = (o: object) => o as unknown as ComponentNode;
const spec = (designation: string): MotorSpec =>
  ({ designation, manufacturer: 'Estes', diameter: 0.024, length: 0.07, ejectionDelay: 5 }) as unknown as MotorSpec;

/** 'aft' first in tree order, 'pod' nested deeper and declared second. */
const tree = {
  components: [
    node({ type: 'bodytube', id: 'aft', motorMount: true }),
    node({ type: 'bodytube', id: 'upper', children: [node({ type: 'innertube', id: 'pod', motorMount: true })] }),
  ],
} as unknown as RocketTree;

describe('liveMotors', () => {
  it('pairs each mount with its motor in TREE order, not key order', () => {
    const config = newFlightConfig({ pod: { spec: spec('D12') }, aft: { spec: spec('C6') } });
    expect(liveMotors(tree, config).map(([id]) => id)).toEqual(['aft', 'pod']);
  });

  it('drops an entry whose mount is gone, or is no longer a mount', () => {
    const config = newFlightConfig({ aft: { spec: spec('C6') }, ghost: { spec: spec('G') } });
    expect(liveMotors(tree, config).map(([id]) => id)).toEqual(['aft']);
    const unflagged = { components: [node({ type: 'bodytube', id: 'aft' })] } as unknown as RocketTree;
    expect(liveMotors(unflagged, config)).toEqual([]);
  });

  it('leaves a mount with no motor out rather than inventing one', () => {
    expect(liveMotors(tree, newFlightConfig({ aft: { spec: spec('C6') } })).map(([id]) => id)).toEqual(['aft']);
  });
});

describe('primaryMotor', () => {
  it('is the first mount in tree order, which is what the run gate judges', () => {
    const config = newFlightConfig({ aft: { spec: spec('C6') }, pod: { spec: spec('D12') } });
    expect(primaryMotor(tree, config)?.designation).toBe('C6');
  });

  it('is undefined when nothing is seated', () => {
    expect(primaryMotor(tree, newFlightConfig())).toBeUndefined();
  });
});

describe('reconcileConfig', () => {
  it('seeds the app default into a mount with no motor', () => {
    const out = reconcileConfig(tree, newFlightConfig());
    expect(Object.keys(out.motors).sort()).toEqual(['aft', 'pod']);
    expect(out.motors.aft!.spec).toBe(C6);
  });

  it('seeds it on a delay the picker itself would have chosen', () => {
    // The seeded motor is the one motor the app picks FOR you, so the delay has
    // to be one Estes actually sells on a C6 and the one `MotorDialog.choose`
    // would land on: the middle of that motor's own charges, not a constant.
    const { delays } = parseDelays(
      (
        JSON.parse(readFileSync(resolve(process.cwd(), 'public/data/motors.generated.json'), 'utf8')) as {
          manufacturer: string;
          designation: string;
          delays?: string;
        }[]
      ).find((m) => m.manufacturer === 'Estes' && m.designation === 'C6')!.delays,
    );
    expect(delays).toContain(C6.ejectionDelay);
    expect(C6.ejectionDelay).toBe(delays[Math.floor(delays.length / 2)]);
  });

  it('drops a motor whose mount is gone', () => {
    const out = reconcileConfig(tree, newFlightConfig({ ghost: { spec: spec('G') } }));
    expect(out.motors.ghost).toBeUndefined();
  });

  it('keeps an EMPTY mount empty, so an import never flies a motor the file did not name', () => {
    const placeholder = { spec: { designation: '', times: [], thrusts: [], masses: [] } as unknown as MotorSpec };
    const out = reconcileConfig(tree, newFlightConfig({ aft: placeholder, pod: placeholder }));
    expect(out.motors.aft).toBe(placeholder);
  });

  it('returns the SAME object when nothing moved, so an edit allocates nothing', () => {
    const settled = reconcileConfig(tree, newFlightConfig());
    expect(reconcileConfig(tree, settled)).toBe(settled);
    const list = [settled];
    expect(reconcileConfigs(tree, list)).toBe(list);
  });
});

describe('loadoutSignature', () => {
  it('is key-order independent, so two identical loadouts match', () => {
    const a = { aft: { spec: spec('C6') }, pod: { spec: spec('D12') } };
    const b = { pod: { spec: spec('D12') }, aft: { spec: spec('C6') } };
    expect(loadoutSignature(a)).toBe(loadoutSignature(b));
  });

  it('separates loadouts that differ by motor or by ignition', () => {
    const base = { aft: { spec: spec('C6') } };
    expect(loadoutSignature(base)).not.toBe(loadoutSignature({ aft: { spec: spec('D12') } }));
    expect(loadoutSignature(base)).not.toBe(
      loadoutSignature({ aft: { spec: spec('C6'), ignitionEvent: 'burnout' as const } }),
    );
  });

  it('treats two fetches of one motor as the same motor', () => {
    // Curve samples are deliberately not part of it: a re-fetched catalog motor
    // is a different object and the same motor.
    expect(loadoutSignature({ aft: { spec: spec('C6') } })).toBe(loadoutSignature({ aft: { spec: spec('C6') } }));
  });
});

describe('ensureConfig', () => {
  it('reuses a configuration that already holds the loadout', () => {
    const existing = newFlightConfig({ aft: { spec: spec('C6') } });
    const { configs, id } = ensureConfig([existing], { aft: { spec: spec('C6') } });
    expect(configs).toHaveLength(1);
    expect(id).toBe(existing.id);
  });

  it('adds one when nothing holds it', () => {
    const existing = newFlightConfig({ aft: { spec: spec('C6') } });
    const { configs, id } = ensureConfig([existing], { aft: { spec: spec('D12') } });
    expect(configs).toHaveLength(2);
    expect(id).not.toBe(existing.id);
  });
});

describe('seatedMotorsKey', () => {
  it('moves when a motor does', () => {
    const before = newFlightConfig({ aft: { spec: spec('C6') } });
    const after = newFlightConfig({ aft: { spec: spec('C6') } }); // a DIFFERENT spec object
    expect(seatedMotorsKey(tree, before)).not.toBe(seatedMotorsKey(tree, after));
  });

  it('does NOT move when only ignition timing does', () => {
    const motor = { spec: spec('C6') };
    const before = newFlightConfig({ aft: motor });
    const after = newFlightConfig({ aft: { ...motor, ignitionEvent: 'burnout', ignitionDelay: 2 } });
    expect(seatedMotorsKey(tree, after)).toBe(seatedMotorsKey(tree, before));
  });
});

describe('configFor', () => {
  it('falls back to the first configuration when the id names none', () => {
    const first = newFlightConfig();
    expect(configFor([first, newFlightConfig()], 'gone')).toBe(first);
  });
});

describe('motorSpecs', () => {
  it('is every seated spec in tree order', () => {
    const config = newFlightConfig({ pod: { spec: spec('D12') }, aft: { spec: spec('C6') } });
    expect(motorSpecs(tree, config).map((m) => m.designation)).toEqual(['C6', 'D12']);
  });
});

describe('deployment overrides', () => {
  /** A design with one chute that the DESIGN opens at apogee. */
  const withChute = {
    components: [
      node({
        type: 'bodytube',
        id: 'body',
        children: [
          node({ type: 'parachute', id: 'chute', deployEvent: 'apogee', deployAltitude: 200, deployDelay: 0 }),
        ],
      }),
    ],
  } as unknown as RocketTree;

  const over = (o: object) => ({ ...newFlightConfig(), deployments: { chute: o } });

  it('leaves the tree ALONE when nothing is overridden', () => {
    // Identity, not equality: the rebuild keys and every memo chain downstream
    // compare by reference, so a copy would look like an edit.
    expect(configuredTree(withChute, newFlightConfig())).toBe(withChute);
    expect(configuredTree(withChute, over({}))).toBe(withChute);
  });

  it('applies only the fields the configuration overrides', () => {
    const out = configuredTree(withChute, over({ deployAltitude: 150 }));
    const chute = out.components[0]!.children![0]!;
    expect(chute['deployAltitude']).toBe(150);
    expect(chute['deployEvent']).toBe('apogee'); // the design still decides WHEN
    expect(chute['deployDelay']).toBe(0);
  });

  it('applies an event override without touching the altitude', () => {
    const out = configuredTree(withChute, over({ deployEvent: 'altitude' }));
    const chute = out.components[0]!.children![0]!;
    expect(chute['deployEvent']).toBe('altitude');
    expect(chute['deployAltitude']).toBe(200);
  });

  it('ignores an override for a device that is no longer in the tree', () => {
    const cfg = { ...newFlightConfig(), deployments: { ghost: { deployAltitude: 150 } } };
    expect(configuredTree(withChute, cfg).components).toEqual(withChute.components);
  });

  it('reads back as an override only when it actually says something', () => {
    expect(deployOverride(over({ deployDelay: 2 }), 'chute')).toEqual({ deployDelay: 2 });
    expect(deployOverride(over({}), 'chute')).toBeUndefined();
    expect(deployOverride(newFlightConfig(), 'chute')).toBeUndefined();
  });

  it('drops an override whose device was deleted, on the next reconcile', () => {
    const cfg = { ...newFlightConfig(), deployments: { chute: { deployAltitude: 150 }, ghost: { deployDelay: 1 } } };
    const out = reconcileConfig(withChute, cfg);
    expect(Object.keys(out.deployments!)).toEqual(['chute']);
  });
});

describe('separation overrides', () => {
  /** Two stages: the top one has nothing above it to let go of. */
  const staged = {
    components: [
      node({ type: 'stage', id: 'sustainer', children: [] }),
      node({ type: 'stage', id: 'booster', separationEvent: 'ejection', separationDelay: 0, children: [] }),
    ],
  } as unknown as RocketTree;

  const over = (o: object) => ({ ...newFlightConfig(), separations: { booster: o } });

  it('applies only the fields the configuration overrides', () => {
    const out = configuredTree(staged, over({ separationDelay: 2 }));
    const booster = out.components[1]!;
    expect(booster['separationDelay']).toBe(2);
    expect(booster['separationEvent']).toBe('ejection'); // the design still decides WHAT
  });

  it('leaves the tree alone when nothing is overridden', () => {
    expect(configuredTree(staged, newFlightConfig())).toBe(staged);
    expect(configuredTree(staged, over({}))).toBe(staged);
  });

  it('applies recovery and separation in one pass', () => {
    const both = {
      ...newFlightConfig(),
      separations: { booster: { separationEvent: 'burnout' } },
      deployments: { chute: { deployAltitude: 150 } },
    };
    const withChute = {
      components: [
        node({ type: 'stage', id: 'sustainer', children: [node({ type: 'parachute', id: 'chute' })] }),
        node({ type: 'stage', id: 'booster', separationEvent: 'ejection' }),
      ],
    } as unknown as RocketTree;
    const out = configuredTree(withChute, both);
    expect(out.components[0]!.children![0]!['deployAltitude']).toBe(150);
    expect(out.components[1]!['separationEvent']).toBe('burnout');
  });

  it('reads back as an override only when it actually says something', () => {
    expect(sepOverride(over({ separationDelay: 2 }), 'booster')).toEqual({ separationDelay: 2 });
    expect(sepOverride(over({}), 'booster')).toBeUndefined();
  });

  it('drops an override whose stage was deleted, on the next reconcile', () => {
    const cfg = {
      ...newFlightConfig(),
      separations: { booster: { separationDelay: 2 }, gone: { separationDelay: 1 } },
    };
    expect(Object.keys(reconcileConfig(staged, cfg).separations!)).toEqual(['booster']);
  });

  it('never offers the TOP stage, which has nothing above it to let go of', () => {
    const cfg = { ...newFlightConfig(), separations: { sustainer: { separationDelay: 2 } } };
    expect(reconcileConfig(staged, cfg).separations).toEqual({});
  });
});

describe('stage activeness', () => {
  const staged = {
    components: [
      node({ type: 'stage', id: 'sustainer', children: [] }),
      node({ type: 'stage', id: 'booster', children: [] }),
    ],
  } as unknown as RocketTree;

  it('flies every stage unless the configuration says otherwise', () => {
    const config = newFlightConfig();
    expect(stageFlies(config, 'booster')).toBe(true);
    expect(stageFlies({ ...config, grounded: ['booster'] }, 'booster')).toBe(false);
    expect(stageFlies({ ...config, grounded: ['booster'] }, 'sustainer')).toBe(true);
  });

  it('drops a grounded stage that was deleted, on the next reconcile', () => {
    const cfg = { ...newFlightConfig(), grounded: ['booster', 'gone'] };
    expect(reconcileConfig(staged, cfg).grounded).toEqual(['booster']);
  });
});

describe('deployment and separation as flown', () => {
  const bare = { type: 'parachute', id: 'chute' } as ComponentNode;
  const stage = { type: 'stage', id: 'booster' } as ComponentNode;

  it("fills what a device leaves out with the kernel's own deployment", () => {
    // DeploymentConfiguration: EJECTION, 200 m, 0 s. The bridge sets only the
    // keys a node carries, so a device without an event opens on the charge.
    expect(designDeployment(bare)).toEqual({ deployEvent: 'ejection', deployAltitude: 200, deployDelay: 0 });
  });

  it("fills what a stage leaves out with the kernel's own separation", () => {
    expect(designSeparation(stage)).toEqual({
      separationEvent: 'ejection',
      separationAltitude: 200,
      separationDelay: 0,
    });
  });

  it('keeps what the design states', () => {
    const set = { ...bare, deployEvent: 'altitude', deployAltitude: 150, deployDelay: 1 } as ComponentNode;
    expect(designDeployment(set)).toEqual({ deployEvent: 'altitude', deployAltitude: 150, deployDelay: 1 });
  });

  it("lays a configuration's override over the design, field by field", () => {
    const config = {
      id: 'c',
      name: null,
      motors: {},
      deployments: { chute: { deployAltitude: 90 } },
      separations: { booster: { separationEvent: 'burnout' } },
    } as FlightConfig;
    expect(effectiveDeployment(config, bare)).toEqual({ deployEvent: 'ejection', deployAltitude: 90, deployDelay: 0 });
    expect(effectiveSeparation(config, stage)).toEqual({
      separationEvent: 'burnout',
      separationAltitude: 200,
      separationDelay: 0,
    });
  });
});
