import { describe, it, expect } from 'vitest';
import type { ComponentNode, IgnitionEvent, MotorSpec, RocketTree } from '../engine/openRocketEngine';
import type { MountMotor } from './loadOrk';
import type { OrkExportMotor } from './orkFile';
import { buildExportMotorMap } from './exportMotors';

const node = (o: object) => o as unknown as ComponentNode;
const spec = (designation: string): MotorSpec =>
  ({ designation, diameter: 0.024, length: 0.07, ejectionDelay: 5 }) as unknown as MotorSpec;
const mount = (designation: string, extra?: Partial<MountMotor>): MountMotor =>
  ({ spec: spec(designation), ...extra }) as MountMotor;

// First motorMount node = primary; a second mount ('pod') stands in for a cluster/pod.
const tree = {
  components: [
    node({ type: 'bodytube', id: 'primary', motorMount: true }),
    node({ type: 'innertube', id: 'pod', motorMount: true }),
  ],
} as unknown as RocketTree;

describe('buildExportMotorMap', () => {
  it('maps the primary mount from the active motor + ignition', () => {
    const m = buildExportMotorMap(tree, { motor: spec('D12'), ignitionEvent: 'launch' as IgnitionEvent, ignitionDelay: 0 }, {});
    expect(Object.keys(m)).toEqual(['primary']);
    expect(m.primary).toMatchObject({
      designation: 'D12',
      diameter: 0.024,
      length: 0.07,
      delay: 5,
      ignitionEvent: 'launch',
      ignitionDelay: 0,
    });
  });

  it('maps extra mounts, skipping the primary id and mounts gone from the tree', () => {
    const m = buildExportMotorMap(tree, { motor: spec('D12') }, {
      pod: mount('C6', { ignitionEvent: 'burnout' as IgnitionEvent, ignitionDelay: 2 }),
      primary: mount('SKIP'), // same id as the primary → ignored (exported from the active motor above)
      gone: mount('GONE'), // no such node in the tree → skipped
    });
    expect(Object.keys(m).sort()).toEqual(['pod', 'primary']);
    expect(m.primary!.designation).toBe('D12'); // the active motor, NOT the extraMotors['primary'] entry
    expect(m.pod).toMatchObject({ designation: 'C6', ignitionEvent: 'burnout', ignitionDelay: 2 });
  });

  it('carries through base fields the app never edits (e.g. manufacturer)', () => {
    const base: Record<string, OrkExportMotor> = {
      primary: { designation: 'old', manufacturer: 'Estes', diameter: 0, length: 0, delay: 0 },
    };
    const m = buildExportMotorMap(tree, { motor: spec('D12') }, {}, base);
    expect(m.primary!.manufacturer).toBe('Estes'); // preserved from import
    expect(m.primary!.designation).toBe('D12'); // overwritten with the live value
  });

  it('omits the primary mount when the tree has no motor mount', () => {
    const noMount = { components: [node({ type: 'bodytube', id: 'x' })] } as unknown as RocketTree;
    expect(buildExportMotorMap(noMount, { motor: spec('D12') }, {})).toEqual({});
  });
});
