import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * A `.ork` can carry several flight configurations, and all of them come in.
 *
 * Reading one and dropping the rest loses work the moment the design is saved
 * back: the file says a rocket was set up three ways, and a save that wrote one
 * would be the app deciding the other two no longer exist.
 *
 * The engine, the zip parser and the catalog are mocked: what is under test is
 * the wiring, not the kernel.
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

const ref = (designation: string, extra: object = {}) => ({
  designation,
  manufacturer: 'Estes',
  delay: 3,
  diameter: 0.024,
  length: 0.07,
  ...extra,
});

vi.mock('../../../src/services/files/designFile', () => ({
  parseDesignFile: () => ({
    name: 'Three ways',
    tree: {
      name: 'Three ways',
      components: [
        {
          type: 'stage',
          id: 's',
          children: [
            { type: 'bodytube', id: 'body', motorMount: true, name: 'Body' },
            { type: 'innertube', id: 'pod', motorMount: true, name: 'Pod' },
          ],
        },
      ],
    },
    // The chosen configuration's motors, as the config-scoped reads resolve them.
    motors: { body: ref('D12') },
    configs: [
      {
        id: 'low',
        name: 'Low power',
        isDefault: false,
        motors: { body: ref('C6') },
        deployments: {},
        separations: {},
        grounded: [],
      },
      {
        id: 'high',
        name: null,
        isDefault: true,
        motors: { body: ref('D12'), pod: ref('A8', { ignitionEvent: 'burnout', ignitionDelay: 1 }) },
        deployments: { chute: { deployAltitude: 150 } },
        separations: { booster: { separationDelay: 2 } },
        grounded: ['booster'],
      },
    ],
    chosenConfigId: 'high',
    notes: [],
    ignored: [],
  }),
}));

const fetchMotorSpec = vi.fn();
vi.mock('../../../src/services/motors/thrustcurve', () => ({ fetchMotorSpec, customMotorToSpec: vi.fn() }));
vi.mock('../../../src/services/motors/motorDb', () => ({
  loadCatalog: () => Promise.resolve([]),
  findCatalogMotor: (_c: unknown, designation: string) => ({ designation }),
  matchCatalogMotor: (_c: unknown, designation: string) => ({ motor: { designation } }),
}));

const { loadOrk } = await import('../../../src/services/files/loadOrk');

const curve = (designation: string) => ({
  designation,
  times: [0, 1],
  thrusts: [0, 5],
  masses: [0.02, 0.01],
  diameter: 0.024,
  length: 0.07,
  cgX: 0.035,
  ejectionDelay: 3,
});

beforeEach(() => {
  vi.clearAllMocks();
  fetchMotorSpec.mockImplementation((cat: { designation: string }) => Promise.resolve(curve(cat.designation)));
});

describe('loadOrk with several flight configurations', () => {
  it('resolves every configuration, in file order, keeping the file ids', async () => {
    const res = await loadOrk(new ArrayBuffer(0));
    expect(res.configs.map((c) => c.id)).toEqual(['low', 'high']);
    expect(res.configs.map((c) => c.name)).toEqual(['Low power', null]);
    expect(res.chosenConfigId).toBe('high');
    expect(res.configs[0]!.motors.body!.spec.designation).toBe('C6');
    expect(res.configs[1]!.motors.body!.spec.designation).toBe('D12');
  });

  it('carries each configuration"s ignition overrides', async () => {
    const res = await loadOrk(new ArrayBuffer(0));
    const pod = res.configs[1]!.motors.pod!;
    expect(pod.ignitionEvent).toBe('burnout');
    expect(pod.ignitionDelay).toBe(1);
  });

  it('fills a mount a configuration named no motor for with a curve-less placeholder', async () => {
    // Never a default: "Low power" says nothing about the pod, so the pod flies
    // nothing under it rather than a C6 the file never named.
    const res = await loadOrk(new ArrayBuffer(0));
    const pod = res.configs[0]!.motors.pod!;
    expect(pod.spec.designation).toBe('');
    expect(pod.spec.thrusts).toEqual([]);
  });

  it('resolves each distinct motor once, however many configurations use it', async () => {
    // Three motors across the two configurations, and D12 appears in both.
    await loadOrk(new ArrayBuffer(0));
    expect(fetchMotorSpec).toHaveBeenCalledTimes(3);
  });

  it('seats only the OPENED configuration into the handle the static info is read from', async () => {
    await loadOrk(new ArrayBuffer(0));
    const seated = design.setMotorById.mock.calls.map((c) => [c[0], (c[1] as { designation: string }).designation]);
    expect(seated).toEqual([
      ['body', 'D12'],
      ['pod', 'A8'],
    ]);
    expect(design.setMotorIgnitionById).toHaveBeenCalledWith('pod', 'burnout', 1);
  });

  it('carries a configuration"s deployment overrides through untouched', async () => {
    const res = await loadOrk(new ArrayBuffer(0));
    expect(res.configs[1]!.deployments).toEqual({ chute: { deployAltitude: 150 } });
    expect(res.configs[0]!.deployments).toBeUndefined(); // it had none
  });

  /**
   * `OrkFlightConfig` declares `separations` and `grounded` non-optional and
   * documents both as "carried for the same reason the deployments are".
   * `LoadedConfig` named neither, so a `.ork` whose configuration said
   * `<stage number="1" active="false"/>` or carried a
   * `<separationconfiguration>` lost it on open -- and `saveOrk` then wrote the
   * undefined value back, so the file lost it for good. The round-trip test
   * could not see this: it goes importOrk to exportOrk and never through
   * `loadOrk`.
   */
  it('carries the separation overrides and the grounded stages too', async () => {
    const res = await loadOrk(new ArrayBuffer(0));
    expect(res.configs[1]!.separations).toEqual({ booster: { separationDelay: 2 } });
    expect(res.configs[1]!.grounded).toEqual(['booster']);
    // The one that declared neither keeps them absent rather than empty.
    expect(res.configs[0]!.separations).toBeUndefined();
    expect(res.configs[0]!.grounded).toBeUndefined();
  });
});
