// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import type { ComponentNode, RocketTree } from '../../src/engine/openRocketEngine';
import { loadSettings } from '../../src/services/storage/settings';
import { configuredTree, type FlightConfig } from '../../src/services/flight/flightConfigs';
import { loadOrk } from '../../src/services/files/loadOrk';
import { wireLoadedOrk } from '../../src/services/files/wireLoadedOrk';
import { migrateWorkspace } from '../../src/services/storage/workspaceMigrate';
import { useWorkspaceStore } from '../../src/state/store';
import { isOutdated, resultKey, type Simulation } from '../../src/services/flight/simulations';
import type { FlightResult } from '../../src/engine/openRocketEngine';

/**
 * A design stored at workspace version 2 by a build whose import recorded
 * every configuration's recovery and staging, the file's bare values included,
 * as an override. The step to version 3 drops those, once.
 *
 * Desktop keeps the part's value as the default of a
 * FlightConfigurableParameterSet, and a configuration without an entry of its
 * own reads that default (core/.../rocketcomponent/FlightConfigurableParameterSet.java:142-150),
 * so a Design-tab edit to the part changes its flight. A stored override equal
 * to the part's value is that same configuration; one that differs is the
 * configuration's own and keeps flying.
 */

// The kernel build and the motor catalog are not what is under test, and the
// fixture carries no motors.
vi.mock('../../src/engine/openRocketEngine', async (original) => ({
  ...(await original<typeof import('../../src/engine/openRocketEngine')>()),
  OpenRocketDesign: {
    buildTree: () => ({ setMotorById: () => {}, setMotorIgnitionById: () => {}, staticInfo: () => ({}) }),
  },
  resetEngine: () => {},
}));
vi.mock('../../src/services/motors/motorDb', async (original) => ({
  ...(await original<typeof import('../../src/services/motors/motorDb')>()),
  loadCatalog: async () => [],
}));

/** Two configurations, as RecoveryDeviceSaver and AxialStageSaver write them: the default bare, a block for the one that differs. */
const DESKTOP_ORK = `<?xml version='1.0' encoding='utf-8'?>
<openrocket version="1.10" creator="OpenRocket 24.12">
  <rocket>
    <name>Two stage</name>
    <motorconfiguration configid="cfg-1" default="true">
      <stage number="0" active="true"/>
      <stage number="1" active="true"/>
    </motorconfiguration>
    <motorconfiguration configid="cfg-2">
      <stage number="0" active="true"/>
      <stage number="1" active="true"/>
    </motorconfiguration>
    <subcomponents>
      <stage>
        <name>Sustainer</name>
        <subcomponents>
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
                <deploymentconfiguration configid="cfg-2">
                  <deployaltitude>300.0</deployaltitude>
                </deploymentconfiguration>
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

// The defaults a stored row is laid over on load, so a row keys the same stored and loaded.
const launchDefaults = loadSettings().launchDefaults;

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

/** One configuration's value of a part's tag as desktop reads the file: its own block, else the bare default. */
function fileValue(part: string, blockTag: string, tag: string, configId: string): number {
  const doc = new DOMParser().parseFromString(DESKTOP_ORK, 'application/xml');
  const el = Array.from(doc.querySelectorAll('*')).find((e) => e.querySelector(':scope > name')?.textContent === part)!;
  const block = Array.from(el.children).find((c) => c.tagName === blockTag && c.getAttribute('configid') === configId);
  return Number(
    block?.querySelector(`:scope > ${tag}`)?.textContent ?? el.querySelector(`:scope > ${tag}`)!.textContent,
  );
}

const s = () => useWorkspaceStore.getState();

describe('a stored design carrying every configuration’s values as overrides', async () => {
  const wired = wireLoadedOrk(
    await loadOrk(new TextEncoder().encode(DESKTOP_ORK).buffer as ArrayBuffer),
    launchDefaults,
  );
  const chute = byName(wired.tree, 'Main').id as string;
  const booster = byName(wired.tree, 'Booster').id as string;
  // What the earlier import recorded: every configuration, the bare tags with
  // the configuration's block over them.
  const oldShape = (c: FlightConfig): FlightConfig => ({
    ...c,
    deployments: {
      [chute]: {
        deployEvent: 'altitude',
        deployAltitude: fileValue('Main', 'deploymentconfiguration', 'deployaltitude', c.id),
        deployDelay: fileValue('Main', 'deploymentconfiguration', 'deploydelay', c.id),
      },
    },
    separations: {
      [booster]: {
        separationEvent: 'burnout',
        separationAltitude: fileValue('Booster', 'separationconfiguration', 'separationaltitude', c.id),
        separationDelay: fileValue('Booster', 'separationconfiguration', 'separationdelay', c.id),
      },
    },
  });
  const oldConfigs = wired.configs.map(oldShape);
  const prefs = s().simPrefs;
  // Each row flown against its stored configuration, so current as stored.
  const flownSims: Simulation[] = wired.sims.map((x) => {
    const sim = { ...x, result: {} as FlightResult };
    return {
      ...sim,
      resultKey: resultKey(
        wired.tree,
        oldConfigs.find((c) => c.id === x.configId)!,
        sim,
        prefs,
      ),
    };
  });
  const currentAsStored = flownSims.map(
    (x) =>
      !isOutdated(
        x,
        wired.tree,
        oldConfigs.find((c) => c.id === x.configId)!,
        prefs,
      ),
  );
  const stored = JSON.parse(
    JSON.stringify({
      version: 2,
      tree: wired.tree,
      sims: flownSims,
      configs: oldConfigs,
      activeId: wired.activeId,
      loadedMeta: null,
    }),
  );
  // The same rows flown against other recovery settings than the stored ones.
  const elsewhere = (c: FlightConfig): FlightConfig => ({
    ...c,
    deployments: {
      [chute]: { deployAltitude: fileValue('Main', 'deploymentconfiguration', 'deployaltitude', c.id) + 1 },
    },
  });
  const staleRows = migrateWorkspace(
    JSON.parse(
      JSON.stringify({
        ...stored,
        sims: flownSims.map((x) => ({
          ...x,
          resultKey: resultKey(wired.tree, elsewhere(oldConfigs.find((c) => c.id === x.configId)!), x, prefs),
        })),
      }),
    ),
  )!;
  const outdatedAsLoaded = staleRows.sims.map((x) =>
    isOutdated(
      x,
      staleRows.tree,
      staleRows.configs.find((c) => c.id === x.configId)!,
      prefs,
    ),
  );

  s().hydrate(migrateWorkspace(stored)!);
  const currentAsLoaded = s().sims.map(
    (x) =>
      !isOutdated(
        x,
        s().tree,
        s().configs.find((c) => c.id === x.configId)!,
        s().simPrefs,
      ),
  );
  s().setSelectedId(chute);
  s().patchSelected({ deployAltitude: 150 });
  s().setSelectedId(booster);
  s().patchSelected({ separationDelay: 2.5 });
  const flown = (id: string) =>
    configuredTree(
      s().tree,
      s().configs.find((c) => c.id === id)!,
    );

  it('flies the edited deploy altitude and separation delay where the file had no block', () => {
    expect(byName(flown('cfg-1'), 'Main')['deployAltitude']).toBe(150);
    expect(byName(flown('cfg-1'), 'Booster')['separationDelay']).toBe(2.5);
  });

  it('loads a result current against the stored overrides as current', () => {
    expect(currentAsStored.every(Boolean)).toBe(true);
    expect(currentAsLoaded).toEqual(currentAsStored);
  });

  it('loads a result flown against other inputs as outdated', () => {
    expect(outdatedAsLoaded.every(Boolean)).toBe(true);
  });

  it('leaves a version 3 workspace’s overrides as stored', () => {
    const v3 = migrateWorkspace(JSON.parse(JSON.stringify({ ...stored, version: 3 })))!;
    expect(v3.configs).toEqual(stored.configs);
  });

  it('keeps the configuration’s own block', () => {
    expect(byName(flown('cfg-2'), 'Main')['deployAltitude']).toBe(
      fileValue('Main', 'deploymentconfiguration', 'deployaltitude', 'cfg-2'),
    );
  });
});
