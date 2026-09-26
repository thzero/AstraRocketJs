// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { exportOrk, importOrk } from '../../src/services/orkFile';
import type { ComponentNode, RocketTree } from '../../src/engine/openRocketEngine';

/**
 * A `.ork` in the DESKTOP's own layout, not this app's.
 *
 * Every other .ork test round-trips through `exportOrk`, which checks that the
 * reader understands the writer and nothing more: three findings (the wind
 * altitude reference on the wrong carrier, the packed size and the rail button
 * geometry replaced by constants) passed every round trip because writer and
 * reader agreed with each other while both disagreed with OpenRocket. This
 * fixture is written element for element from the desktop savers:
 * OpenRocketSaver.saveSimulation (conditions order and carriers),
 * RocketComponentSaver (name, id, instances, angle, axial position, then the
 * type-specific tail), ExternalComponentSaver (finish, material),
 * RailButtonSaver, MassObjectSaver + RecoveryDeviceSaver + ParachuteSaver.
 */
const DESKTOP_ORK = `<?xml version='1.0' encoding='utf-8'?>
<openrocket version="1.10" creator="OpenRocket 24.12">
  <rocket>
    <name>Desktop minimal</name>
    <id>6f0c2d0e-9a4c-4a44-9c3f-0e9d1a7a1e01</id>
    <axialoffset method="absolute">0.0</axialoffset>
    <position type="absolute">0.0</position>
    <designtype>original</designtype>
    <motorconfiguration configid="cfg-1" default="true">
      <stage number="0" active="true"/>
    </motorconfiguration>
    <referencetype>maximum</referencetype>

    <subcomponents>
      <stage>
        <name>Sustainer</name>
        <id>6f0c2d0e-9a4c-4a44-9c3f-0e9d1a7a1e02</id>

        <subcomponents>
          <nosecone>
            <name>Nose cone</name>
            <id>6f0c2d0e-9a4c-4a44-9c3f-0e9d1a7a1e03</id>
            <finish>normal</finish>
            <material type="bulk" density="1050.0" group="Plastics">Polystyrene</material>
            <length>0.1</length>
            <thickness>0.002</thickness>
            <shape>ogive</shape>
            <shapeclipped>false</shapeclipped>
            <shapeparameter>1.0</shapeparameter>
            <aftradius>0.0125</aftradius>
            <aftshoulderradius>0.0</aftshoulderradius>
            <aftshoulderlength>0.0</aftshoulderlength>
            <aftshoulderthickness>0.0</aftshoulderthickness>
            <aftshouldercapped>false</aftshouldercapped>
            <isflipped>false</isflipped>
          </nosecone>

          <bodytube>
            <name>Body tube</name>
            <id>6f0c2d0e-9a4c-4a44-9c3f-0e9d1a7a1e04</id>
            <finish>normal</finish>
            <material type="bulk" density="680.0" group="PaperProducts">Cardboard</material>
            <length>0.3</length>
            <thickness>0.001</thickness>
            <radius>0.0125</radius>

            <subcomponents>
              <railbutton>
                <name>Rail button</name>
                <id>6f0c2d0e-9a4c-4a44-9c3f-0e9d1a7a1e05</id>
                <instancecount>2</instancecount>
                <instanceseparation>0.0582</instanceseparation>
                <angleoffset method="relative">180.0</angleoffset>
                <axialoffset method="middle">0.0</axialoffset>
                <position type="middle">0.0</position>
                <finish>normal</finish>
                <material type="bulk" density="2700.0" group="Metals">Aluminum</material>
                <outerdiameter>0.0135</outerdiameter>
                <innerdiameter>0.0065</innerdiameter>
                <height>0.012</height>
                <baseheight>0.003</baseheight>
                <flangeheight>0.0025</flangeheight>
                <screwheight>0.001</screwheight>
              </railbutton>

              <parachute>
                <name>Parachute</name>
                <id>6f0c2d0e-9a4c-4a44-9c3f-0e9d1a7a1e06</id>
                <axialoffset method="top">0.05</axialoffset>
                <position type="top">0.05</position>
                <packedlength>0.06</packedlength>
                <packedradius>0.02</packedradius>
                <radialposition>0.0</radialposition>
                <radialdirection>0.0</radialdirection>
                <cd>auto</cd>
                <material type="surface" density="0.067" group="Fabrics">Ripstop nylon</material>
                <deployevent>ejection</deployevent>
                <deployaltitude>200.0</deployaltitude>
                <deploydelay>0.0</deploydelay>
                <diameter>0.3</diameter>
                <linecount>6</linecount>
                <linelength>0.3</linelength>
                <linematerial type="line" density="0.0018" group="ThreadsLines">Elastic cord (round 2 mm, 1/16 in)</linematerial>
              </parachute>

              <innertube>
                <name>Motor mount</name>
                <id>6f0c2d0e-9a4c-4a44-9c3f-0e9d1a7a1e07</id>
                <axialoffset method="bottom">0.0</axialoffset>
                <position type="bottom">0.0</position>
                <material type="bulk" density="680.0" group="PaperProducts">Cardboard</material>
                <length>0.07</length>
                <radialposition>0.0</radialposition>
                <radialdirection>0.0</radialdirection>
                <outerradius>0.0095</outerradius>
                <thickness>0.0005</thickness>
                <clusterconfiguration>single</clusterconfiguration>
                <clusterscale>1.0</clusterscale>
                <clusterrotation>0.0</clusterrotation>
                <motormount>
                  <ignitionevent>automatic</ignitionevent>
                  <ignitiondelay>0.0</ignitiondelay>
                  <overhang>0.0</overhang>
                  <motor configid="cfg-1">
                    <type>single</type>
                    <manufacturer>Estes</manufacturer>
                    <digest>0000</digest>
                    <designation>C6</designation>
                    <diameter>0.018</diameter>
                    <length>0.07</length>
                    <delay>5.0</delay>
                  </motor>
                  <ignitionconfiguration configid="cfg-1">
                    <ignitionevent>automatic</ignitionevent>
                    <ignitiondelay>0.0</ignitiondelay>
                  </ignitionconfiguration>
                </motormount>
              </innertube>
            </subcomponents>
          </bodytube>
        </subcomponents>
      </stage>
    </subcomponents>
  </rocket>

  <simulations>
    <simulation status="notsimulated">
      <name>Simulation 1</name>
      <simulator>RK4Simulator</simulator>
      <calculator>BarrowmanCalculator</calculator>
      <conditions>
        <configid>cfg-1</configid>
        <launchrodlength>1.5</launchrodlength>
        <launchintowind>false</launchintowind>
        <launchrodangle>5.0</launchrodangle>
        <launchroddirection>45.0</launchroddirection>
        <windaverage>3.0</windaverage>
        <windturbulence>0.1</windturbulence>
        <winddirection>0.7853981633974483</winddirection>
        <wind model="average">
          <speed>3.0</speed>
          <direction>0.7853981633974483</direction>
          <standarddeviation>0.3</standarddeviation>
        </wind>
        <wind model="multilevel" altituderef="AGL">
          <windlevel altitude="0.0" speed="3.0" direction="0.7853981633974483" standarddeviation="0.3"/>
          <windlevel altitude="500.0" speed="7.0" direction="1.5707963267948966" standarddeviation="1.4"/>
        </wind>
        <windmodeltype>MultiLevel</windmodeltype>
        <launchaltitude>1500.0</launchaltitude>
        <launchlatitude>40.7</launchlatitude>
        <launchlongitude>12.34</launchlongitude>
        <geodeticmethod>spherical</geodeticmethod>
        <simulationsteppermethod>rk4</simulationsteppermethod>
        <atmosphere model="isa"/>
        <timestep>0.05</timestep>
        <maxtime>1200.0</maxtime>
      </conditions>
    </simulation>
  </simulations>
</openrocket>
`;

const findByType = (t: RocketTree, type: string): ComponentNode | undefined => {
  const walk = (ns: ComponentNode[]): ComponentNode | undefined => {
    for (const n of ns) {
      if (n.type === type) return n;
      const hit = walk(n.children ?? []);
      if (hit) return hit;
    }
    return undefined;
  };
  return walk(t.components);
};

describe('a desktop-authored .ork', () => {
  const res = importOrk(DESKTOP_ORK);

  it('opens with its structure intact', () => {
    expect(res.name).toBe('Desktop minimal');
    expect(res.ignored).toEqual([]);
    expect(res.motor?.designation).toBe('C6');
    expect(findByType(res.tree, 'railbutton')).toBeDefined();
    expect(findByType(res.tree, 'parachute')).toBeDefined();
  });

  it('reads the multilevel altitude reference from the <wind altituderef> attribute', () => {
    expect(res.launch?.windAltitudeReference).toBe('agl');
    expect(res.launch?.windLevels).toHaveLength(2);
    expect(res.launch?.windLevels?.[1]?.directionDeg).toBeCloseTo(90, 10);
  });

  it('reads the launch fields the desktop wrote', () => {
    expect(res.launch?.launchIntoWind).toBe(false);
    expect(res.launch?.launchRodDirectionDeg).toBe(45);
    expect(res.launch?.windDirectionDeg).toBeCloseTo(45, 10);
    expect(res.launch?.longitudeDeg).toBe(12.34);
    expect(res.launch?.launchAltitudeM).toBe(1500);
  });

  it('reads the parachute packed size', () => {
    const c = findByType(res.tree, 'parachute')!;
    expect(c['length']).toBe(0.06);
    expect(c['packedRadius']).toBe(0.02);
  });

  it('reads the rail button geometry and material', () => {
    const b = findByType(res.tree, 'railbutton')!;
    expect(b['outerDiameter']).toBe(0.0135);
    expect(b['innerDiameter']).toBe(0.0065);
    expect(b['height']).toBe(0.012);
    expect(b['baseHeight']).toBe(0.003);
    expect(b['flangeHeight']).toBe(0.0025);
    expect(b['screwHeight']).toBe(0.001);
    expect(b['materialName']).toBe('Aluminum');
    expect(b.density).toBe(2700);
    expect(b['materialGroup']).toBe('Metals');
    expect(b['instanceCount']).toBe(2);
  });

  it('writes all of it back in the desktop form', () => {
    const xml = exportOrk({
      name: res.name,
      tree: res.tree,
      motors: res.motors,
      launch: res.launch as never,
      configs: res.configs,
      activeConfigId: res.chosenConfigId,
    });
    expect(xml).toContain('<wind model="multilevel" altituderef="AGL">');
    expect(xml).toContain('<launchintowind>false</launchintowind>');
    expect(xml).toContain('<launchroddirection>45</launchroddirection>');
    expect(xml).toContain('<launchlongitude>12.34</launchlongitude>');
    expect(xml).toMatch(/<winddirection>0\.78539816339744\d*<\/winddirection>/);
    expect(xml).toContain('<packedlength>0.06</packedlength>');
    expect(xml).toContain('<packedradius>0.02</packedradius>');
    expect(xml).toContain('<innerdiameter>0.0065</innerdiameter>');
    expect(xml).toContain('<height>0.012</height>');
    expect(xml).toContain('<baseheight>0.003</baseheight>');
    expect(xml).toContain('<flangeheight>0.0025</flangeheight>');
    expect(xml).toContain('<screwheight>0.001</screwheight>');
    expect(xml).toContain('<material type="bulk" density="2700" group="Metals">Aluminum</material>');
    // And the desktop can read it back the same way.
    const again = importOrk(xml);
    expect(again.launch?.windAltitudeReference).toBe('agl');
    expect(findByType(again.tree, 'parachute')!['packedRadius']).toBe(0.02);
    expect(findByType(again.tree, 'railbutton')!['height']).toBe(0.012);
  });
});
