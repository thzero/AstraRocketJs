// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import type { ComponentNode, RocketTree } from '../../src/engine/openRocketEngine';
import { loadSettings } from '../../src/services/storage/settings';
import { configuredTree, type FlightConfig } from '../../src/services/flight/flightConfigs';
import { exportOrk, importOrk } from '../../src/services/files/orkFile';
import { loadOrk } from '../../src/services/files/loadOrk';
import { wireLoadedOrk } from '../../src/services/files/wireLoadedOrk';
import { migrateWorkspace } from '../../src/services/storage/workspaceMigrate';
import { useWorkspaceStore, workspaceSnapshot } from '../../src/state/store';

/**
 * A desktop file whose configuration overrides a part with the part's own
 * values.
 *
 * Desktop keeps such an override: `FlightConfigurableParameterSet.isDefault`
 * compares the configuration's entry with the default by identity, and
 * `RecoveryDeviceSaver.addParams` and `AxialStageSaver` write a block for every
 * configuration that is not the default (OpenRocket 24.12, javap). Opened in
 * desktop, a change to the part's value leaves that configuration where its
 * block put it. The same has to hold after the app stores the design, reloads
 * it and saves it again.
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

/**
 * Three configurations, written as the 24.12 savers write them: the default
 * bare; "windy" (cfg-2) with blocks equal to the bare values; "late" (cfg-3)
 * with blocks that repeat one value and change another.
 */
const DESKTOP_ORK = `<?xml version='1.0' encoding='utf-8'?>
<openrocket version="1.10" creator="OpenRocket 24.12">
  <rocket>
    <name>Two stage</name>
    <motorconfiguration configid="cfg-1" default="true">
      <stage number="0" active="true"/>
      <stage number="1" active="true"/>
    </motorconfiguration>
    <motorconfiguration configid="cfg-2">
      <name>windy</name>
      <stage number="0" active="true"/>
      <stage number="1" active="true"/>
    </motorconfiguration>
    <motorconfiguration configid="cfg-3">
      <name>late</name>
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
                <deployaltitude>150.0</deployaltitude>
                <deploydelay>0.0</deploydelay>
                <deploymentconfiguration configid="cfg-2">
                  <deployevent>altitude</deployevent>
                  <deployaltitude>150.0</deployaltitude>
                  <deploydelay>0.0</deploydelay>
                </deploymentconfiguration>
                <deploymentconfiguration configid="cfg-3">
                  <deployevent>altitude</deployevent>
                  <deployaltitude>150.0</deployaltitude>
                  <deploydelay>1.5</deploydelay>
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
        <separationdelay>1.0</separationdelay>
        <separationconfiguration configid="cfg-2">
          <separationevent>burnout</separationevent>
          <separationdelay>1.0</separationdelay>
        </separationconfiguration>
        <separationconfiguration configid="cfg-3">
          <separationevent>burnout</separationevent>
          <separationdelay>3.0</separationdelay>
        </separationconfiguration>
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
 * One configuration's value of a part's tag as desktop reads a file: its own
 * block, else the bare tag (DeploymentConfigurationHandler and
 * StageSeparationConfigurationHandler clone the default before applying the
 * block). Null when the file has neither.
 */
function desktopValue(xml: string, part: string, blockTag: string, tag: string, configId: string): number | null {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const el = Array.from(doc.querySelectorAll('*')).find((e) => e.querySelector(':scope > name')?.textContent === part)!;
  const block = Array.from(el.children).find((c) => c.tagName === blockTag && c.getAttribute('configid') === configId);
  const text = block?.querySelector(`:scope > ${tag}`)?.textContent ?? el.querySelector(`:scope > ${tag}`)?.textContent;
  return text == null ? null : Number(text);
}

/** Whether a file holds a block of its own for that configuration. */
function hasBlock(xml: string, part: string, blockTag: string, configId: string): boolean {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const el = Array.from(doc.querySelectorAll('*')).find((e) => e.querySelector(':scope > name')?.textContent === part)!;
  return Array.from(el.children).some((c) => c.tagName === blockTag && c.getAttribute('configid') === configId);
}

const s = () => useWorkspaceStore.getState();

/** The open design saved as File > Save as .ork writes it. */
const save = (): string =>
  exportOrk({
    name: 'Two stage',
    tree: s().tree,
    configs: s().configs.map((c: FlightConfig) => ({
      id: c.id,
      name: c.name,
      motors: {},
      deployments: c.deployments,
      separations: c.separations,
      grounded: c.grounded,
    })),
    activeConfigId: s().configs[0]!.id,
  });

/** The deployment and separation tags each configuration reads from the file as desktop wrote it. */
const CASES = [
  ['Main', 'deployAltitude', 'deploymentconfiguration', 'deployaltitude'],
  ['Main', 'deployDelay', 'deploymentconfiguration', 'deploydelay'],
  ['Booster', 'separationDelay', 'separationconfiguration', 'separationdelay'],
] as const;
const OVERRIDING = ['cfg-2', 'cfg-3'] as const;

describe('a desktop configuration overriding a part with equal values', async () => {
  const wired = wireLoadedOrk(
    await loadOrk(new TextEncoder().encode(DESKTOP_ORK).buffer as ArrayBuffer),
    loadSettings().launchDefaults,
  );
  // Stored as the autosave writes it, then read back as a reload reads it.
  const stored = JSON.parse(JSON.stringify(workspaceSnapshot(wired)));
  s().hydrate(migrateWorkspace(stored)!);
  const chute = byName(s().tree, 'Main').id as string;
  const booster = byName(s().tree, 'Booster').id as string;
  // The part's own values moved off the ones the blocks repeat.
  s().setSelectedId(chute);
  s().patchSelected({ deployAltitude: 90, deployDelay: 0.5 });
  s().setSelectedId(booster);
  s().patchSelected({ separationDelay: 2.5 });
  // Read now: every describe body runs before any test, and the next one
  // replaces the store's workspace.
  const part = s().tree;
  const flownTrees = new Map(s().configs.map((c) => [c.id, configuredTree(part, c)]));
  const flown = (id: string) => flownTrees.get(id)!;
  const xml = save();

  it.each(OVERRIDING.flatMap((id) => CASES.map((c) => [id, ...c] as const)))(
    '%s keeps its own %s %s across a reload',
    (id, part, field, blockTag, tag) => {
      expect(byName(flown(id), part)[field]).toBe(desktopValue(DESKTOP_ORK, part, blockTag, tag, id));
    },
  );

  it('moves the configuration with no block of its own with the part', () => {
    expect(byName(flown('cfg-1'), 'Main')['deployAltitude']).toBe(byName(part, 'Main')['deployAltitude']);
    expect(byName(flown('cfg-1'), 'Booster')['separationDelay']).toBe(byName(part, 'Booster')['separationDelay']);
  });

  it.each(OVERRIDING.flatMap((id) => CASES.map((c) => [id, ...c] as const)))(
    'saves %s’s own %s %s, so desktop reads it back',
    (id, part, _field, blockTag, tag) => {
      expect(hasBlock(xml, part, blockTag, id)).toBe(true);
      expect(desktopValue(xml, part, blockTag, tag, id)).toBe(desktopValue(DESKTOP_ORK, part, blockTag, tag, id));
    },
  );

  it('writes no block for the configuration the file gave none', () => {
    expect(hasBlock(xml, 'Main', 'deploymentconfiguration', 'cfg-1')).toBe(false);
    expect(hasBlock(xml, 'Booster', 'separationconfiguration', 'cfg-1')).toBe(false);
  });

  it('keeps the override through a second open of the saved file', () => {
    const again = importOrk(xml);
    const c2 = again.configs.find((c) => c.id === 'cfg-2')!;
    expect(c2.deployments[byName(again.tree, 'Main').id as string]?.deployAltitude).toBe(
      desktopValue(DESKTOP_ORK, 'Main', 'deploymentconfiguration', 'deployaltitude', 'cfg-2'),
    );
    expect(c2.separations[byName(again.tree, 'Booster').id as string]?.separationDelay).toBe(
      desktopValue(DESKTOP_ORK, 'Booster', 'separationconfiguration', 'separationdelay', 'cfg-2'),
    );
  });
});

describe('an override set in the app to the part’s own value', async () => {
  const wired = wireLoadedOrk(
    await loadOrk(new TextEncoder().encode(DESKTOP_ORK).buffer as ArrayBuffer),
    loadSettings().launchDefaults,
  );
  s().hydrate(migrateWorkspace(JSON.parse(JSON.stringify(workspaceSnapshot(wired))))!);
  const chute = byName(s().tree, 'Main');
  // What the part holds before the edit: the file's bare value.
  const partAltitude = chute['deployAltitude'] as number;
  s().setDeployment('cfg-1', chute.id as string, 'deployAltitude', partAltitude);
  const xml = save();
  // Then stored, reloaded, and the part's value moved.
  s().hydrate(migrateWorkspace(JSON.parse(JSON.stringify(workspaceSnapshot(s()))))!);
  s().setSelectedId(chute.id as string);
  s().patchSelected({ deployAltitude: 90 });
  const reloaded = configuredTree(
    s().tree,
    s().configs.find((c) => c.id === 'cfg-1')!,
  );

  it('is written as the configuration’s block', () => {
    expect(hasBlock(xml, 'Main', 'deploymentconfiguration', 'cfg-1')).toBe(true);
    expect(desktopValue(xml, 'Main', 'deploymentconfiguration', 'deployaltitude', 'cfg-1')).toBe(
      desktopValue(DESKTOP_ORK, 'Main', 'deploymentconfiguration', 'deployaltitude', 'cfg-1'),
    );
  });

  it('survives a reload', () => {
    expect(byName(reloaded, 'Main')['deployAltitude']).toBe(
      desktopValue(DESKTOP_ORK, 'Main', 'deploymentconfiguration', 'deployaltitude', 'cfg-1'),
    );
  });
});
