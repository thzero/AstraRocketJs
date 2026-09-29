import { describe, it, expect } from 'vitest';
import type { ComponentNode, IgnitionEvent, MotorSpec, RocketTree } from '../../src/engine/openRocketEngine';
import { newFlightConfig, type MountMotor } from '../../src/services/flightConfigs';
import type { OrkExportMotor } from '../../src/services/orkFile';
import { buildExportMotorMap } from '../../src/services/exportMotors';

const node = (o: object) => o as unknown as ComponentNode;
const spec = (designation: string): MotorSpec =>
  ({ designation, diameter: 0.024, length: 0.07, ejectionDelay: 5 }) as unknown as MotorSpec;
const mount = (designation: string, extra?: Partial<MountMotor>): MountMotor =>
  ({ spec: spec(designation), ...extra }) as MountMotor;

// Two mounts: the aft one and a second ('pod') standing in for a cluster/pod.
const tree = {
  components: [
    node({ type: 'bodytube', id: 'primary', motorMount: true }),
    node({ type: 'innertube', id: 'pod', motorMount: true }),
  ],
} as unknown as RocketTree;

describe('buildExportMotorMap', () => {
  it('maps every mount the configuration seats, with its ignition', () => {
    const m = buildExportMotorMap(
      tree,
      newFlightConfig({
        primary: mount('D12', { ignitionEvent: 'launch' as IgnitionEvent, ignitionDelay: 0 }),
        pod: mount('C6', { ignitionEvent: 'burnout' as IgnitionEvent, ignitionDelay: 2 }),
      }),
    );
    expect(Object.keys(m).sort()).toEqual(['pod', 'primary']);
    expect(m.primary).toMatchObject({
      designation: 'D12',
      diameter: 0.024,
      length: 0.07,
      delay: 5,
      ignitionEvent: 'launch',
      ignitionDelay: 0,
    });
    expect(m.pod).toMatchObject({ designation: 'C6', ignitionEvent: 'burnout', ignitionDelay: 2 });
  });

  it('skips a mount that is gone from the tree', () => {
    const m = buildExportMotorMap(tree, newFlightConfig({ primary: mount('D12'), gone: mount('GONE') }));
    expect(Object.keys(m)).toEqual(['primary']);
  });

  it('carries through base fields the app never edits (e.g. manufacturer)', () => {
    const base: Record<string, OrkExportMotor> = {
      primary: { designation: 'old', manufacturer: 'Estes', diameter: 0, length: 0, delay: 0 },
    };
    const m = buildExportMotorMap(tree, newFlightConfig({ primary: mount('D12') }), base);
    expect(m.primary!.manufacturer).toBe('Estes'); // preserved from import
    expect(m.primary!.designation).toBe('D12'); // overwritten with the live value
  });

  it('writes nothing when the tree has no motor mount', () => {
    const noMount = { components: [node({ type: 'bodytube', id: 'x' })] } as unknown as RocketTree;
    expect(buildExportMotorMap(noMount, newFlightConfig({ primary: mount('D12') }))).toEqual({});
  });
});
