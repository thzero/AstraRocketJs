import { describe, it, expect } from 'vitest';
import type { ComponentNode, RocketTree } from '../engine/openRocketEngine';
import { exportCdx1 } from './rasaeroExport';

/**
 * GOLDEN output of the .CDX1 writer, pinned before it was split into the
 * sustainer, booster, recovery, launch-site and simulation writers. A three
 * stage design exercises every branch: each nose shape, a shoulder and a boat
 * tail on a booster, fins on a transition, rail buttons and lugs, two chutes,
 * a Mach-Alt table, custom launch conditions and per-stage engines.
 */

const node = (o: object) => o as unknown as ComponentNode;

const fins = (id: string, extra: object = {}) =>
  node({
    type: 'trapezoidfinset',
    id,
    name: `Fins ${id}`,
    finCount: 4,
    rootChord: 0.1,
    tipChord: 0.04,
    sweep: 0.03,
    height: 0.07,
    thickness: 0.0032,
    position: { method: 'bottom', offset: -0.005 },
    ...extra,
  });

const threeStage = (): RocketTree =>
  ({
    name: 'Golden Triple',
    components: [
      node({
        type: 'stage',
        name: 'Sustainer',
        children: [
          node({
            type: 'nosecone',
            id: 'nose',
            length: 0.2,
            aftRadius: 0.038,
            shape: 'power',
            shapeParameter: 0.6,
            finish: 'unfinished',
          }),
          node({
            type: 'bodytube',
            id: 'upper',
            length: 0.5,
            outerRadius: 0.038,
            children: [
              node({ type: 'launchlug', id: 'lug', length: 0.05, outerRadius: 0.004 }),
              node({ type: 'railbutton', id: 'rb', outerDiameter: 0.0125, height: 0.012 }),
              node({
                type: 'parachute',
                id: 'main',
                diameter: 0.9,
                cd: 0.8,
                deployEvent: 'altitude',
                deployAltitude: 200,
              }),
              node({ type: 'innertube', id: 'sMount', length: 0.2 }),
            ],
          }),
          node({
            type: 'transition',
            id: 'boattail',
            length: 0.05,
            shape: 'conical',
            foreRadius: 0.038,
            aftRadius: 0.03,
            children: [
              fins('sust', {
                crossSection: 'rounded',
                airfoilSection: 'hexagonal',
                airfoilLeDiamond: 0.012,
                airfoilTeDiamond: 0.015,
                finLeRadius: 0.001,
                position: { method: 'top', offset: 0.01 },
              }),
              node({ type: 'parachute', id: 'drogue', diameter: 0.4, deployEvent: 'apogee' }),
              node({ type: 'parachute', id: 'third', diameter: 0.5 }),
            ],
          }),
        ],
      }),
      node({
        type: 'stage',
        name: 'Booster 1',
        separationEvent: 'burnout',
        separationDelay: 1.5,
        children: [
          node({ type: 'transition', id: 'shoulder1', length: 0.04, foreRadius: 0.03, aftRadius: 0.038 }),
          node({
            type: 'bodytube',
            id: 'b1tube',
            length: 0.4,
            outerRadius: 0.038,
            children: [
              node({
                type: 'freeformfinset',
                id: 'b1fins',
                finCount: 3,
                thickness: 0.004,
                points: [
                  [0, 0],
                  [0.05, 0.08],
                  [0.12, 0],
                ],
                position: { method: 'middle', offset: 0 },
              }),
              node({ type: 'innertube', id: 'b1Mount', length: 0.3 }),
            ],
          }),
          node({ type: 'transition', id: 'bt1', length: 0.03, foreRadius: 0.038, aftRadius: 0.02 }),
        ],
      }),
      node({
        type: 'stage',
        name: 'Booster 2',
        separationEvent: 'ejection',
        separationDelay: 3,
        children: [
          node({ type: 'bodytube', id: 'b2a', length: 0.15, outerRadius: 0.038 }),
          node({
            type: 'bodytube',
            id: 'b2b',
            length: 0.25,
            outerRadius: 0.038,
            children: [
              fins('b2', { crossSection: 'airfoil' }),
              node({ type: 'innertube', id: 'b2Mount', length: 0.3 }),
            ],
          }),
        ],
      }),
    ],
  }) as unknown as RocketTree;

describe('golden .CDX1 export', () => {
  it('writes the three-stage design with engines, recovery and launch site exactly as before', () => {
    const warnings: string[] = [];
    const xml = exportCdx1({
      name: 'Golden <Triple> & co',
      tree: threeStage(),
      launchMassKg: 2.5,
      launchCgM: 0.9,
      launch: {
        launchAltitudeM: 1400,
        pressureHPa: 850,
        launchRodAngleDeg: 4,
        launchRodLengthM: 2,
        temperatureC: 30,
        windAverage: 4.5,
      },
      machAlt: [
        [0.3, 0],
        [0.9, 1500],
        [1.5, 3000],
      ],
      motors: {
        sMount: { designation: 'J350W', manufacturer: 'AeroTech', ignitionEvent: 'burnout', ignitionDelay: 1.2 },
        b1Mount: { designation: 'K550W', manufacturer: 'Aerotech RCS', ignitionEvent: 'automatic', ignitionDelay: 9 },
        b2Mount: { designation: 'L1000', manufacturer: 'Cesaroni Technology Inc.' },
      },
      warnings,
    });
    expect(xml).toMatchSnapshot();
    expect(warnings).toEqual([]);
  });

  it('writes a bare single-stage design with RASAero defaults and an unmapped finish', () => {
    const warnings: string[] = [];
    const tree = {
      name: 'Bare',
      components: [
        node({ type: 'nosecone', id: 'n', length: 0.1, aftRadius: 0.02, shape: 'conical', finish: 'rough' }),
        node({ type: 'bodytube', id: 'b', length: 0.3, outerRadius: 0.02, children: [fins('bare')] }),
      ],
    } as unknown as RocketTree;
    const xml = exportCdx1({ name: 'Bare', tree, warnings, motors: { b: { designation: 'X' } } });
    expect(xml).toMatchSnapshot();
    expect(warnings).toEqual(['Unknown surface finish: rough, defaulting to Smooth.']);
  });

  it('maps each remaining nose shape', () => {
    for (const [shape, param] of [
      ['ogive', 1],
      ['ellipsoid', 1],
      ['haack', 0.33],
      ['haack', 0],
      ['power', undefined],
    ] as const) {
      const tree = {
        name: 'Nose',
        components: [
          node({ type: 'nosecone', id: 'n', length: 0.1, aftRadius: 0.02, shape, shapeParameter: param }),
          node({ type: 'bodytube', id: 'b', length: 0.3, outerRadius: 0.02, children: [fins('n')] }),
        ],
      } as unknown as RocketTree;
      expect(exportCdx1({ name: 'Nose', tree, engineExport: false })).toMatchSnapshot();
    }
  });
});
