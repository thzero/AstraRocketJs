import { describe, it, expect } from 'vitest';
import type { ComponentNode, MotorSpec, RocketTree } from '../../../src/engine/openRocketEngine';
import { configPowerClass, powerClass, seatedMotors } from '../../../src/services/flight/powerClass';
import { newFlightConfig } from '../../../src/services/flight/flightConfigs';

/**
 * Which safety code a configuration flies under. High power is any one of: a
 * motor over 160 N·s or 80 N average thrust, more than 320 N·s or 125 g of
 * propellant installed, or more than 1,500 g at liftoff.
 */

/** A flat thrust curve: `thrust` newtons for `burn` seconds, `loaded` kg. */
const motor = (thrust: number, burn: number, loaded = 0.05): MotorSpec => ({
  designation: 'X',
  diameter: 0.029,
  length: 0.1,
  times: [0, burn],
  thrusts: [thrust, thrust],
  masses: [loaded, loaded / 2],
  cgX: 0.05,
  ejectionDelay: 6,
});

const mountTube = (id: string, cluster = 'single'): ComponentNode => ({
  type: 'innertube',
  id,
  motorMount: true,
  cluster,
});

const tree = (...children: ComponentNode[]): RocketTree =>
  ({
    components: [{ type: 'stage', id: 'sustainer', children: [{ type: 'bodytube', id: 'body', children }] }],
  }) as RocketTree;

describe('powerClass', () => {
  it('calls a G motor in a light rocket a model rocket', () => {
    // 150 N·s at 50 N average.
    expect(powerClass([{ spec: motor(50, 3), count: 1 }], 0.5)).toBe('model');
  });

  it('calls a motor over 160 N·s high power', () => {
    expect(powerClass([{ spec: motor(50, 3.4), count: 1 }], 0.5)).toBe('highPower');
  });

  it('calls a motor over 80 N average thrust high power', () => {
    expect(powerClass([{ spec: motor(90, 1), count: 1 }], 0.5)).toBe('highPower');
  });

  it('calls more than 320 N·s installed high power, counting every copy', () => {
    // Three 150 N·s motors: each is a model motor, together 450 N·s.
    expect(powerClass([{ spec: motor(50, 3), count: 2 }], 0.5)).toBe('model');
    expect(powerClass([{ spec: motor(50, 3), count: 3 }], 0.5)).toBe('highPower');
  });

  it('calls more than 1,500 g at liftoff high power, motors included', () => {
    expect(powerClass([{ spec: motor(10, 1, 0.1), count: 1 }], 1.35)).toBe('model');
    expect(powerClass([{ spec: motor(10, 1, 0.1), count: 2 }], 1.35)).toBe('highPower');
  });

  it('calls more than 125 g of propellant installed high power', () => {
    // A low impulse motor that burns half its mass: 120 g of propellant, then 150 g.
    expect(powerClass([{ spec: motor(10, 1, 0.24), count: 1 }], 0.1)).toBe('model');
    expect(powerClass([{ spec: motor(10, 1, 0.3), count: 1 }], 0.1)).toBe('highPower');
    // Two 70 g loads: each under the limit, together over it.
    expect(powerClass([{ spec: motor(10, 1, 0.14), count: 2 }], 0.1)).toBe('highPower');
  });

  it('weighs the propellant as the kernel does: loaded less the last mass sample', () => {
    // ThrustCurveMotor.getPropellantMass is launch less burnout mass, and the
    // burnout mass is the last sample, not the lightest one.
    const dips = { ...motor(10, 1, 0.2), times: [0, 0.5, 1], thrusts: [10, 10, 10], masses: [0.2, 0.05, 0.1] };
    expect(powerClass([{ spec: dips, count: 1 }], 0.1)).toBe('model');
  });

  it('lets the motors decide while the rocket mass is unknown', () => {
    expect(powerClass([{ spec: motor(10, 1), count: 1 }], null)).toBe('model');
  });
});

describe('seatedMotors', () => {
  it('multiplies a mount by its cluster and every pod set around it', () => {
    const pods: ComponentNode = {
      type: 'podset',
      id: 'pods',
      instanceCount: 3,
      children: [{ type: 'bodytube', id: 'pod', children: [mountTube('podMount', 'double')] }],
    };
    const t = tree(mountTube('core', '3-ring'), pods);
    const config = newFlightConfig({ core: { spec: motor(10, 1) }, podMount: { spec: motor(10, 1) } });
    expect(seatedMotors(t, config).map((m) => m.count)).toEqual([3, 6]);
  });

  it('leaves out the motors of a grounded stage', () => {
    const t = {
      components: [
        { type: 'stage', id: 'top', children: [mountTube('upper')] },
        { type: 'stage', id: 'booster', children: [mountTube('lower')] },
      ],
    } as RocketTree;
    const config = {
      ...newFlightConfig({ upper: { spec: motor(10, 1) }, lower: { spec: motor(90, 1) } }),
      grounded: ['booster'],
    };
    expect(seatedMotors(t, config).map((m) => m.count)).toEqual([1]);
    expect(configPowerClass(t, config, 0.2)).toBe('model');
    expect(configPowerClass(t, { ...config, grounded: [] }, 0.2)).toBe('highPower');
  });
});
