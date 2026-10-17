// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { importOrk } from '../../../../src/services/files/orkImport';
import type { ComponentNode, RocketTree } from '../../../../src/engine/openRocketEngine';

/**
 * A configuration's override block names only the fields it changes. The
 * desktop handlers clone the default and apply the block's fields
 * (StageSeparationConfigurationHandler.getConfiguration, and the mount's
 * MotorConfiguration built from the default one), so a field the block leaves
 * out keeps the bare default rather than falling to the kernel's.
 */

const ORK = `<?xml version="1.0"?>
<openrocket version="1.10">
  <rocket>
    <name>Merge</name>
    <motorconfiguration configid="cfg-1" default="true"/>
    <motorconfiguration configid="cfg-2"/>
    <subcomponents>
      <stage>
        <name>Sustainer</name>
        <subcomponents>
          <bodytube>
            <name>Upper</name><length>0.3</length><radius>0.012</radius>
            <subcomponents>
              <parachute>
                <name>Chute</name><diameter>0.3</diameter>
                <deployevent>altitude</deployevent>
                <deployaltitude>300.0</deployaltitude>
                <deploydelay>1.0</deploydelay>
                <deploymentconfiguration configid="cfg-2">
                  <deploydelay>2.0</deploydelay>
                </deploymentconfiguration>
              </parachute>
            </subcomponents>
          </bodytube>
        </subcomponents>
      </stage>
      <stage>
        <name>Booster</name>
        <separationevent>burnout</separationevent>
        <separationdelay>3.0</separationdelay>
        <separationconfiguration configid="cfg-1">
          <separationdelay>1.5</separationdelay>
        </separationconfiguration>
        <subcomponents>
          <bodytube>
            <name>Lower</name><length>0.3</length><radius>0.012</radius>
            <subcomponents>
              <innertube>
                <name>Mount</name><length>0.07</length><outerradius>0.0095</outerradius><thickness>0.0005</thickness>
                <motormount>
                  <ignitionevent>never</ignitionevent>
                  <ignitiondelay>4.0</ignitiondelay>
                  <motor configid="cfg-1">
                    <manufacturer>Estes</manufacturer><designation>C6</designation>
                    <diameter>0.018</diameter><length>0.07</length><delay>5.0</delay>
                  </motor>
                  <motor configid="cfg-2">
                    <manufacturer>Estes</manufacturer><designation>C6</designation>
                    <diameter>0.018</diameter><length>0.07</length><delay>5.0</delay>
                  </motor>
                  <ignitionconfiguration configid="cfg-1">
                    <ignitiondelay>0.5</ignitiondelay>
                  </ignitionconfiguration>
                  <ignitionconfiguration configid="cfg-2">
                    <ignitionevent>launch</ignitionevent>
                  </ignitionconfiguration>
                </motormount>
              </innertube>
            </subcomponents>
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

describe('a per-configuration override block merges over the bare defaults', () => {
  const res = importOrk(ORK);
  const booster = byName(res.tree, 'Booster');
  const mount = byName(res.tree, 'Mount');
  const chute = byName(res.tree, 'Chute');
  const [cfg1, cfg2] = res.configs;

  it('keeps the default separation event when the block states only a delay', () => {
    expect(cfg1!.separations[booster.id as string]).toEqual({ separationEvent: 'burnout', separationDelay: 1.5 });
  });

  it('keeps the design on the bare defaults, whichever configuration opens', () => {
    expect(booster['separationEvent']).toBe('burnout');
    expect(booster['separationDelay']).toBe(3);
  });

  it('records an override only for a configuration with a block of its own', () => {
    expect(cfg2!.separations[booster.id as string]).toBeUndefined();
    expect(cfg1!.deployments[chute.id as string]).toBeUndefined();
  });

  it('keeps the default ignition event or delay the block leaves out', () => {
    const chosen = res.motors[mount.id as string]!;
    expect(chosen.ignitionEvent).toBe('never');
    expect(chosen.ignitionDelay).toBe(0.5);
    expect(cfg1!.motors[mount.id as string]).toMatchObject({ ignitionEvent: 'never', ignitionDelay: 0.5 });
    expect(cfg2!.motors[mount.id as string]).toMatchObject({ ignitionEvent: 'launch', ignitionDelay: 4 });
  });

  it('records a deployment block over the bare defaults', () => {
    expect(cfg2!.deployments[chute.id as string]).toEqual({
      deployEvent: 'altitude',
      deployAltitude: 300,
      deployDelay: 2,
    });
  });
});
