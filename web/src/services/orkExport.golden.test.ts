// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import type { ComponentNode, RocketTree } from '../engine/openRocketEngine';
import type { LaunchConditions } from './orkTree';
import type { OrkTreeExportInput } from './orkTypes';

/**
 * GOLDEN output of the .ork writer and reader, pinned before the two were split
 * into per-type tables. Every component type the writer knows, every optional
 * block (multi-config motors and deployments, separation, wind profile, custom
 * atmosphere, design info) and the classic single-config path all appear here,
 * so any drift in a line's text, order or indentation fails the snapshot.
 *
 * The only nondeterminism in the writer is `uuid()` for the <id> elements, so
 * it is replaced with a counter for the length of this file.
 */

let nextUuid = 0;
vi.mock('./uuid', () => ({ uuid: () => `00000000-0000-4000-8000-${String(++nextUuid).padStart(12, '0')}` }));

const { exportOrk, importOrk } = await import('./orkFile');

const node = (o: object) => o as unknown as ComponentNode;

const kitchenSink = (): RocketTree =>
  ({
    name: 'Kitchen sink',
    designer: 'Golden <tester>',
    comment: 'Every "type" & block',
    revision: 'r7',
    designType: 'kit',
    components: [
      node({
        type: 'stage',
        id: 'st0',
        name: 'Sustainer',
        nozzleExitDiameter: 0.02,
        children: [
          node({
            type: 'nosecone',
            id: 'nose',
            name: 'Nose',
            length: 0.15,
            aftRadius: 0.025,
            shape: 'haack',
            shapeParameter: 0.33,
            thickness: 0.002,
            shoulderRadius: 0.024,
            shoulderLength: 0.03,
            shoulderThickness: 0.002,
            shoulderCapped: true,
            density: 1050,
            materialName: 'Polystyrene',
            materialGroup: 'Plastics',
            finish: 'smooth',
            overrideMass: 0.05,
            overrideSubcomponentsMass: true,
            overrideCGX: 0.07,
            overrideCD: 0.4,
            children: [
              node({ type: 'masscomponent', id: 'tracker', name: 'Tracker', mass: 0.02, massComponentType: 'tracker' }),
            ],
          }),
          node({
            type: 'transition',
            id: 'trans',
            length: 0.06,
            shape: 'ellipsoid',
            clipped: false,
            foreRadius: 0.025,
            aftRadius: 0.03,
            filled: true,
            foreShoulderRadius: 0.024,
            foreShoulderLength: 0.02,
            aftShoulderThickness: 0.001,
          }),
          node({ type: 'transition', id: 'trans2', length: 0.04, shape: 'conical', foreRadius: 0.03 }),
          node({
            type: 'bodytube',
            id: 'body',
            name: 'Airframe',
            length: 0.6,
            outerRadius: 0.03,
            thickness: 0.001,
            caseAirframe: true,
            motorMount: true,
            motorOverhang: 0.01,
            children: [
              node({
                type: 'trapezoidfinset',
                id: 'fins',
                name: 'Fins',
                finCount: 4,
                rootChord: 0.1,
                tipChord: 0.05,
                sweep: 0.04,
                height: 0.06,
                thickness: 0.003,
                crossSection: 'airfoil',
                cant: 0.0349,
                rotation: Math.PI / 4,
                tabHeight: 0.01,
                tabLength: 0.05,
                tabOffsetMethod: 'top',
                tabOffset: 0.005,
                filletRadius: 0.004,
                filletDensity: 1200,
                filletMaterialGroup: 'Plastics',
                filletMaterialName: 'Epoxy',
                airfoilSection: 'doublewedge',
                airfoilLeDiamond: 0.01,
                airfoilTeDiamond: 0.02,
                finLeRadius: 0.001,
                position: { method: 'bottom', offset: -0.01 },
              }),
              node({
                type: 'freeformfinset',
                id: 'ffins',
                finCount: 3,
                points: [
                  [0, 0],
                  [0.02, 0.05],
                  [0.06, 0.05],
                  [0.08, 0],
                ],
                tabHeight: 0.01,
                tabLength: 0.02,
                tabOffsetMethod: 'bottom',
                position: { method: 'top', offset: 0.1, ork: { method: 'absolute', offset: 0.31, resolved: 0.1 } },
              }),
              node({
                type: 'ellipticalfinset',
                id: 'efins',
                finCount: 2,
                rootChord: 0.07,
                height: 0.04,
                tabHeight: 0.01,
                tabLength: 0.02,
                tabOffsetMethod: 'middle',
                position: { method: 'top', offset: 0.3, ork: { method: 'absolute', offset: 0.9, resolved: 0.2 } },
              }),
              node({ type: 'tubefinset', id: 'tfins', finCount: 6, outerRadius: 0.012, length: 0.08, rotation: 0.1 }),
              node({
                type: 'innertube',
                id: 'mount',
                name: 'Motor mount',
                length: 0.12,
                outerRadius: 0.015,
                thickness: 0.0005,
                radialPosition: 0.01,
                radialDirection: Math.PI / 2,
                cluster: '2x2',
                clusterScale: 1.1,
                clusterRotation: Math.PI / 6,
                maxMotorLength: 0.14,
                position: { method: 'bottom', offset: 0 },
                children: [
                  node({ type: 'engineblock', id: 'block', length: 0.005, outerRadius: 0.014, thickness: 0.002 }),
                  node({
                    type: 'centeringring',
                    id: 'ring',
                    instanceCount: 3,
                    instanceSeparation: 0.02,
                    innerRadius: 0.015,
                  }),
                ],
              }),
              node({ type: 'innertube', id: 'emptyMount', motorMount: true, length: 0.07 }),
              node({
                type: 'tubecoupler',
                id: 'coupler',
                length: 0.06,
                outerRadius: 0.029,
                position: { method: 'middle', offset: 0.05 },
              }),
              node({ type: 'bulkhead', id: 'bulk', length: 0.004, outerRadius: 0.029 }),
              node({
                type: 'launchlug',
                id: 'lug',
                length: 0.04,
                outerRadius: 0.0025,
                angleOffset: Math.PI / 3,
                instanceCount: 2,
              }),
              node({
                type: 'railbutton',
                id: 'button',
                outerDiameter: 0.0125,
                innerDiameter: 0.009,
                height: 0.011,
                baseHeight: 0.003,
                density: 1400,
                materialName: 'Acetal',
                materialGroup: 'Plastics',
                angleOffset: 0,
              }),
              node({
                type: 'parachute',
                id: 'drogue',
                name: 'Drogue',
                drogue: true,
                diameter: 0.3,
                cd: 0.8,
                length: 0.06,
                packedRadius: 0.02,
                deployEvent: 'apogee',
                deployAltitude: 250,
                deployDelay: 1.5,
                lineCount: 8,
                lineLength: 0.5,
                lineDensity: 0.002,
                lineMaterialName: 'Kevlar line',
                surfaceDensity: 0.05,
                surfaceMaterialName: 'Nylon',
                spillHoleDiameter: 0.03,
              }),
              node({ type: 'parachute', id: 'main', name: 'Main', deployEvent: 'altitude', deployAltitude: 150 }),
              node({
                type: 'streamer',
                id: 'streamer',
                stripLength: 1,
                stripWidth: 0.04,
                cd: 0.6,
                drogue: true,
                deployEvent: 'ejection',
              }),
              node({ type: 'shockcord', id: 'cord', cordLength: 1.2, lineDensity: 0.003, lineMaterialName: 'Elastic' }),
              node({
                type: 'masscomponent',
                id: 'payload',
                mass: 0.1,
                length: 0.05,
                radius: 0.02,
                radialPosition: 0.005,
                radialDirection: Math.PI,
                massComponentType: 'payload',
              }),
              node({
                type: 'fairing',
                id: 'shroud',
                length: 0.09,
                width: 0.03,
                height: 0.025,
                fairingShape: 'halfround',
                mass: 0.04,
                finish: 'polished',
              }),
              node({
                type: 'podset',
                id: 'pods',
                instanceCount: 3,
                radiusOffset: 0.05,
                radiusMethod: 'free',
                angleOffset: Math.PI / 2,
                children: [node({ type: 'bodytube', id: 'podTube', length: 0.1, outerRadius: 0.01 })],
              }),
              node({
                type: 'parallelstage',
                id: 'strapons',
                instanceCount: 2,
                radiusOffset: 0.04,
                angleOffset: 0.5,
                angleMethod: 'fixed',
                separationEvent: 'burnout',
                separationDelay: 0.5,
                separationAltitude: 300,
                children: [
                  node({
                    type: 'bodytube',
                    id: 'strapTube',
                    length: 0.2,
                    outerRadius: 0.015,
                    children: [node({ type: 'innertube', id: 'strapMount', length: 0.1, motorMount: true })],
                  }),
                ],
              }),
            ],
          }),
        ],
      }),
      node({
        type: 'stage',
        id: 'st1',
        name: 'Booster',
        separationEvent: 'launch',
        separationDelay: 2,
        separationAltitude: 100,
        children: [
          node({
            type: 'bodytube',
            id: 'boosterTube',
            length: 0.3,
            outerRadius: 0.03,
            children: [node({ type: 'innertube', id: 'boosterMount', length: 0.1 })],
          }),
        ],
      }),
    ],
  }) as unknown as RocketTree;

const launch: LaunchConditions = {
  launchRodLengthM: 1.5,
  launchRodAngleDeg: 5,
  launchRodDirectionDeg: 45,
  launchIntoWind: true,
  windAverage: 3,
  windStdDev: 0.6,
  windDirectionDeg: 180,
  windLevels: [
    { altitudeM: 0, speed: 2, directionDeg: 90, stddev: 0.2 },
    { altitudeM: 500, speed: 6, directionDeg: 135, stddev: 0.5 },
  ],
  windAltitudeReference: 'agl',
  launchAltitudeM: 1200,
  latitudeDeg: 39.5,
  longitudeDeg: -104.7,
  geodetic: 'wgs84',
  gravityModel: 'constant',
  constantGravity: 9.8,
  temperatureC: 25,
  pressureHPa: null,
  relativeHumidity: 0.4,
};

const multiConfigInput = (): OrkTreeExportInput => ({
  name: 'Kitchen sink',
  tree: kitchenSink(),
  motors: {
    mount: { designation: 'H128W', manufacturer: 'AeroTech', diameter: 0.029, length: 0.194, delay: 10 },
    boosterMount: {
      designation: 'G80',
      manufacturer: 'AeroTech',
      diameter: 0.029,
      length: 0.124,
      delay: 1e9,
      ignitionEvent: 'launch',
      ignitionDelay: 0,
    },
  },
  launch,
  configs: [
    {
      id: 'cfg-a',
      name: 'Two stage',
      isDefault: true,
      motors: {},
      deployments: {},
    },
    {
      id: 'cfg-b',
      name: null,
      isDefault: false,
      motors: {
        mount: { designation: 'F39', manufacturer: 'AeroTech', diameter: 0.029, length: 0.124, delay: 6 },
        body: { designation: 'E12', manufacturer: 'Estes', diameter: 0.024, length: 0.07, delay: 4 },
      },
      deployments: {
        drogue: { deployEvent: 'ejection', deployAltitude: 200, deployDelay: 0 },
        main: { deployAltitude: 120 },
      },
    },
    { id: 'cfg-c', name: 'Empty', isDefault: false, motors: {}, deployments: {} },
  ],
  activeConfigId: 'cfg-a',
  designInfo: {
    groups: [
      { scope: 'rocket', stats: [{ field: 'length', value: '1.250', unit: 'm' }] },
      {
        scope: 'stage',
        stageNumber: 1,
        name: 'Booster "B"',
        stats: [
          { field: 'mass', value: '0.4500', unit: 'kg' },
          { field: 'cg', value: '0.8000', unit: 'm' },
        ],
      },
    ],
    finsets: [{ stageNumber: 0, stage: 'Sustainer', name: 'Fins', topX: 0.7123456, bottomX: 0.8123456 }],
  },
});

describe('golden .ork export', () => {
  it('writes every configuration, block and component type exactly as before', () => {
    nextUuid = 0;
    expect(exportOrk(multiConfigInput())).toMatchSnapshot();
  });

  it('writes the classic single-config path with a legacy motor and no launch block', () => {
    nextUuid = 0;
    const xml = exportOrk({
      name: 'Classic',
      tree: kitchenSink(),
      motor: { designation: 'C6', manufacturer: 'Estes', diameter: 0.018, length: 0.07, delay: 3 },
      mountId: 'mount',
    });
    expect(xml).toMatchSnapshot();
  });

  it('mints an unnamed config for a live motor set with no active config, ISA atmosphere', () => {
    nextUuid = 0;
    const input = multiConfigInput();
    input.activeConfigId = null;
    input.launch = { ...launch, temperatureC: null, pressureHPa: null, relativeHumidity: null, gravityModel: 'wgs' };
    delete input.launch.windLevels;
    expect(exportOrk(input)).toMatchSnapshot();
  });
});

describe('golden .ork import', () => {
  it('reads the kitchen-sink export back into the same result as before', () => {
    nextUuid = 0;
    const xml = exportOrk(multiConfigInput());
    expect(importOrk(xml)).toMatchSnapshot();
    expect(importOrk(xml, { configId: 'cfg-b' })).toMatchSnapshot();
  });
});
