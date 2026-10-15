// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import type { ComponentNode, RocketTree } from '../../../../src/engine/openRocketEngine';
import type { LaunchConditions } from '../../../../src/services/design/orkTree';
import { updateNode } from '../../../../src/services/design/treeEdit';
import { configuredTree } from '../../../../src/services/flight/flightConfigs';
import { exportOrk } from '../../../../src/services/files/orkFile';
import { loadOrk } from '../../../../src/services/files/loadOrk';
import { wireLoadedOrk } from '../../../../src/services/files/wireLoadedOrk';

/**
 * A desktop file's recovery and staging, edited in the Design tab.
 *
 * Desktop keeps the design's value as the default of a
 * FlightConfigurableParameterSet, and a configuration overrides it only when
 * the set holds an entry for it: `get` falls back to the default otherwise
 * (core/.../rocketcomponent/FlightConfigurableParameterSet.java:142-150). The
 * savers write the default bare and a block per entry
 * (RecoveryDeviceSaver.java:31-45, AxialStageSaver.java:48-64), so a file with
 * no block is a design whose every configuration flies the default, and an
 * edit to the default changes every one of those flights.
 */

// The kernel build and the motor catalog are not what is under test, and the
// fixture carries no motors.
vi.mock('../../../../src/engine/openRocketEngine', async (original) => ({
  ...(await original<typeof import('../../../../src/engine/openRocketEngine')>()),
  OpenRocketDesign: {
    buildTree: () => ({ setMotorById: () => {}, setMotorIgnitionById: () => {}, staticInfo: () => ({}) }),
  },
  resetEngine: () => {},
}));
vi.mock('../../../../src/services/motors/motorDb', async (original) => ({
  ...(await original<typeof import('../../../../src/services/motors/motorDb')>()),
  loadCatalog: async () => [],
}));

/** Written element for element as RecoveryDeviceSaver and AxialStageSaver write a one-configuration design. */
const DESKTOP_ORK = `<?xml version='1.0' encoding='utf-8'?>
<openrocket version="1.10" creator="OpenRocket 24.12">
  <rocket>
    <name>Two stage</name>
    <motorconfiguration configid="cfg-1" default="true">
      <stage number="0" active="true"/>
      <stage number="1" active="true"/>
    </motorconfiguration>
    <subcomponents>
      <stage>
        <name>Sustainer</name>
        <subcomponents>
          <nosecone>
            <name>Nose cone</name>
            <length>0.1</length>
            <thickness>0.002</thickness>
            <shape>ogive</shape>
            <aftradius>0.0125</aftradius>
          </nosecone>
          <bodytube>
            <name>Upper</name>
            <length>0.3</length>
            <thickness>0.0005</thickness>
            <radius>0.0125</radius>
            <subcomponents>
              <parachute>
                <name>Main</name>
                <packedlength>0.03</packedlength>
                <packedradius>0.01</packedradius>
                <cd>auto</cd>
                <deployevent>altitude</deployevent>
                <deployaltitude>200.0</deployaltitude>
                <deploydelay>0.0</deploydelay>
                <diameter>0.3</diameter>
              </parachute>
            </subcomponents>
          </bodytube>
        </subcomponents>
      </stage>
      <stage>
        <name>Booster</name>
        <separationevent>burnout</separationevent>
        <separationaltitude>200.0</separationaltitude>
        <separationdelay>1.0</separationdelay>
        <subcomponents>
          <bodytube>
            <name>Lower</name>
            <length>0.3</length>
            <thickness>0.0005</thickness>
            <radius>0.0125</radius>
          </bodytube>
        </subcomponents>
      </stage>
    </subcomponents>
  </rocket>
</openrocket>`;

const launchDefaults = { launchRodAngleDeg: 0, windAverage: 0 } as unknown as LaunchConditions;

const byName = (t: RocketTree, name: string): ComponentNode => {
  const walk = (ns: ComponentNode[]): ComponentNode | undefined => {
    for (const n of ns) {
      if (n.name === name) return n;
      const hit = walk(n.children ?? []);
      if (hit) return hit;
    }
    return undefined;
  };
  const found = walk(t.components);
  if (!found) throw new Error(`no ${name}`);
  return found;
};

/**
 * What desktop reads for one configuration of a saved part: the bare default,
 * or the configuration's own block cloned from it
 * (DeploymentConfigurationHandler.java:31, StageSeparationConfigurationHandler.java:30).
 */
function desktopValue(xml: string, part: string, blockTag: string, tag: string, configId: string): string | null {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const el = Array.from(doc.querySelectorAll('*')).find((e) => e.querySelector(':scope > name')?.textContent === part)!;
  const block = Array.from(el.children).find((c) => c.tagName === blockTag && c.getAttribute('configid') === configId);
  return (
    block?.querySelector(`:scope > ${tag}`)?.textContent ?? el.querySelector(`:scope > ${tag}`)?.textContent ?? null
  );
}

describe('a Design-tab edit to an opened desktop file', async () => {
  const wired = wireLoadedOrk(
    await loadOrk(new TextEncoder().encode(DESKTOP_ORK).buffer as ArrayBuffer),
    launchDefaults,
  );
  const config = wired.configs[0]!;
  const chute = byName(wired.tree, 'Main');
  const booster = byName(wired.tree, 'Booster');
  const edited = updateNode(updateNode(wired.tree, chute.id as string, { deployAltitude: 150 }), booster.id as string, {
    separationDelay: 2.5,
  });
  const save = () =>
    exportOrk({
      name: 'Two stage',
      tree: edited,
      configs: [
        {
          id: config.id,
          name: config.name,
          motors: {},
          deployments: config.deployments,
          separations: config.separations,
          grounded: config.grounded,
        },
      ],
      activeConfigId: config.id,
    });

  it('opens on the file’s own values', () => {
    expect(chute['deployAltitude']).toBe(200);
    expect(booster['separationDelay']).toBe(1);
  });

  it('flies the edited deploy altitude', () => {
    expect(byName(configuredTree(edited, config), 'Main')['deployAltitude']).toBe(150);
  });

  it('flies the edited separation delay', () => {
    expect(byName(configuredTree(edited, config), 'Booster')['separationDelay']).toBe(2.5);
  });

  it('saves a file desktop reads the edited values from', () => {
    const xml = save();
    expect(Number(desktopValue(xml, 'Main', 'deploymentconfiguration', 'deployaltitude', config.id))).toBe(150);
    expect(Number(desktopValue(xml, 'Booster', 'separationconfiguration', 'separationdelay', config.id))).toBe(2.5);
  });
});
