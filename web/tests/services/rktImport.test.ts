// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { importRkt } from '../../src/services/rktImport';
import type { ComponentNode } from '../../src/engine/openRocketEngine';

/**
 * A `.rkt` in RockSim's own layout, written element for element from
 * `RockSimCommonConstants.java` and the `importt/` handlers — the same posture
 * `orkDesktopFixture.test.ts` takes for `.ork`. A round trip through our own
 * writer would only prove the reader understands the writer; this proves it
 * understands RockSim.
 *
 * The numbers are deliberately awkward (24.8 mm, 3.2 mm walls) so a factor-of-2
 * or factor-of-1000 slip shows up as a wrong value rather than a plausible one.
 * RockSim is millimeters and grams throughout, and every circular dimension in
 * the file is a DIAMETER.
 */
const RKT = `<?xml version="1.0" encoding="UTF-8"?>
<RockSimDocument>
  <FileVersion>4</FileVersion>
  <DesignInformation>
    <RocketDesign>
      <Name>Fixture Bird</Name>
      <StageCount>1</StageCount>
      <Stage3Parts>
        <NoseCone>
          <Name>Nose</Name>
          <KnownMass>9.5</KnownMass>
          <Density>1050</Density>
          <DensityType>0</DensityType>
          <Material>Polystyrene</Material>
          <KnownCG>40</KnownCG>
          <UseKnownCG>1</UseKnownCG>
          <Len>100</Len>
          <BaseDia>24.8</BaseDia>
          <WallThickness>1.5</WallThickness>
          <ConstructionType>1</ConstructionType>
          <ShapeCode>1</ShapeCode>
          <ShapeParameter>0.75</ShapeParameter>
          <ShoulderOD>23.6</ShoulderOD>
          <ShoulderLen>20</ShoulderLen>
          <FinishCode>1</FinishCode>
          <AttachedParts/>
        </NoseCone>
        <BodyTube>
          <Name>Airframe</Name>
          <Len>300</Len>
          <OD>24.8</OD>
          <ID>24.0</ID>
          <IsInsideTube>0</IsInsideTube>
          <IsMotorMount>0</IsMotorMount>
          <FinishCode>2</FinishCode>
          <Material>Kraft phenolic</Material>
          <AttachedParts>
            <FinSet>
              <Name>Fins</Name>
              <ShapeCode>0</ShapeCode>
              <FinCount>3</FinCount>
              <RootChord>60</RootChord>
              <TipChord>30</TipChord>
              <SemiSpan>45</SemiSpan>
              <SweepDistance>25</SweepDistance>
              <Thickness>3.2</Thickness>
              <CantAngle>1.5</CantAngle>
              <RadialAngle>30</RadialAngle>
              <TabLength>40</TabLength>
              <TabDepth>5</TabDepth>
              <TabOffset>10</TabOffset>
              <Xb>-60</Xb>
              <LocationMode>2</LocationMode>
              <Material>Basswood</Material>
            </FinSet>
            <LaunchLug>
              <Name>Lug</Name>
              <Len>35</Len>
              <OD>4.8</OD>
              <ID>4.0</ID>
              <RadialAngle>90</RadialAngle>
              <Xb>100</Xb>
              <LocationMode>0</LocationMode>
            </LaunchLug>
            <BodyTube>
              <Name>Motor mount</Name>
              <IsInsideTube>1</IsInsideTube>
              <IsMotorMount>1</IsMotorMount>
              <EngineOverhang>3</EngineOverhang>
              <Len>70</Len>
              <OD>18.7</OD>
              <ID>18.0</ID>
              <Xb>-70</Xb>
              <LocationMode>2</LocationMode>
              <AttachedParts>
                <Ring>
                  <Name>Aft ring</Name>
                  <UsageCode>0</UsageCode>
                  <Len>3</Len>
                  <OD>24.0</OD>
                  <ID>18.7</ID>
                  <Xb>0</Xb>
                  <LocationMode>2</LocationMode>
                </Ring>
                <Ring>
                  <Name>Thrust ring</Name>
                  <UsageCode>2</UsageCode>
                  <Len>3</Len>
                  <OD>18.0</OD>
                  <ID>14.0</ID>
                </Ring>
              </AttachedParts>
            </BodyTube>
            <Parachute>
              <Name>Chute</Name>
              <Dia>400</Dia>
              <DragCoefficient>0.8</DragCoefficient>
              <ShroudLineCount>6</ShroudLineCount>
              <ShroudLineLen>350</ShroudLineLen>
              <SpillHoleDia>40</SpillHoleDia>
              <ShroudLineMassPerMM>0.0001</ShroudLineMassPerMM>
              <ShroudLineMaterial>Braided nylon</ShroudLineMaterial>
              <Density>0.67</Density>
              <DensityType>1</DensityType>
              <Material>Ripstop nylon</Material>
            </Parachute>
            <MassObject>
              <Name>Shock cord</Name>
              <TypeCode>1</TypeCode>
              <Len>1000</Len>
              <KnownMass>6</KnownMass>
            </MassObject>
            <MassObject>
              <Name>Altimeter</Name>
              <TypeCode>0</TypeCode>
              <Len>50</Len>
              <Dia>20</Dia>
              <KnownMass>22</KnownMass>
            </MassObject>
            <RingTail>
              <Name>Not supported</Name>
            </RingTail>
          </AttachedParts>
        </BodyTube>
      </Stage3Parts>
      <Stage2Parts/>
      <Stage1Parts/>
    </RocketDesign>
  </DesignInformation>
</RockSimDocument>`;

const res = importRkt(RKT);
const stage = res.tree.components[0]!;
const byName = (nodes: ComponentNode[] | undefined, name: string): ComponentNode => {
  const walk = (list: ComponentNode[] | undefined): ComponentNode | undefined => {
    for (const n of list ?? []) {
      if (n.name === name) return n;
      const hit = walk(n.children);
      if (hit) return hit;
    }
    return undefined;
  };
  const found = walk(nodes);
  if (!found) throw new Error(`no component named ${name}`);
  return found;
};

describe('importRkt', () => {
  it('reads the design name and makes one stage per declared stage', () => {
    expect(res.name).toBe('Fixture Bird');
    // StageCount is 1, so the two empty blocks in the file must NOT become
    // booster stages — they are there in every RockSim file, used or not.
    expect(res.tree.components).toHaveLength(1);
    expect(stage.type).toBe('stage');
    expect(stage.name).toBe('Sustainer');
  });

  it('converts millimeters to meters and diameters to radii', () => {
    const nose = byName(stage.children, 'Nose');
    expect(nose.type).toBe('nosecone');
    expect(nose['length']).toBeCloseTo(0.1, 9);
    expect(nose['aftRadius']).toBeCloseTo(0.0124, 9); // 24.8 mm ACROSS
    expect(nose['thickness']).toBeCloseTo(0.0015, 9);
    expect(nose['shoulderRadius']).toBeCloseTo(0.0118, 9);
    expect(nose['shoulderLength']).toBeCloseTo(0.02, 9);
  });

  it('maps the shape, finish and construction codes', () => {
    const nose = byName(stage.children, 'Nose');
    expect(nose['shape']).toBe('ogive'); // ShapeCode 1
    expect(nose['shapeParameter']).toBe(0.75);
    expect(nose['finish']).toBe('smooth'); // FinishCode 1 == RockSim "gloss"
    expect(nose['filled']).toBeUndefined(); // ConstructionType 1 == hollow
    // FinishCode 2 is RockSim's "matt", which is our default — not stored.
    expect(byName(stage.children, 'Airframe')['finish']).toBeUndefined();
  });

  it('takes a measured mass and CG only when UseKnownCG says to', () => {
    const nose = byName(stage.children, 'Nose');
    expect(nose['overrideMass']).toBeCloseTo(0.0095, 9); // grams
    expect(nose['overrideCGX']).toBeCloseTo(0.04, 9);
    // The tube carries neither, so nothing must be invented for it.
    const tube = byName(stage.children, 'Airframe');
    expect(tube['overrideMass']).toBeUndefined();
    expect(tube['overrideCGX']).toBeUndefined();
  });

  it('derives a wall thickness from the two diameters', () => {
    const tube = byName(stage.children, 'Airframe');
    expect(tube.type).toBe('bodytube');
    expect(tube['outerRadius']).toBeCloseTo(0.0124, 9);
    expect(tube['thickness']).toBeCloseTo(0.0004, 9); // (24.8 - 24.0) / 2 mm
  });

  it('reads a trapezoidal fin set, its cant, its rotation and its tab', () => {
    const fins = byName(stage.children, 'Fins');
    expect(fins.type).toBe('trapezoidfinset');
    expect(fins['finCount']).toBe(3);
    expect(fins['rootChord']).toBeCloseTo(0.06, 9);
    expect(fins['tipChord']).toBeCloseTo(0.03, 9);
    expect(fins['height']).toBeCloseTo(0.045, 9);
    expect(fins['sweep']).toBeCloseTo(0.025, 9);
    expect(fins['thickness']).toBeCloseTo(0.0032, 9);
    expect(fins['cant']).toBeCloseTo((1.5 * Math.PI) / 180, 12);
    expect(fins['angleOffset']).toBeCloseTo(Math.PI / 6, 12);
    expect(fins['tabLength']).toBeCloseTo(0.04, 9);
    expect(fins['tabHeight']).toBeCloseTo(0.005, 9);
    expect(fins['tabOffset']).toBeCloseTo(0.01, 9);
    expect(fins['tabOffsetMethod']).toBe('top');
  });

  it('flips the sign of a back-of-parent offset, and only that one', () => {
    // LocationMode 2 is measured the other way: PositionDependentHandler
    // negates BOTTOM and nothing else.
    expect(byName(stage.children, 'Fins').position).toEqual({ method: 'bottom', offset: 0.06 });
    expect(byName(stage.children, 'Lug').position).toEqual({ method: 'top', offset: 0.1 });
  });

  it('tells an inner tube from an airframe tube by IsInsideTube', () => {
    const mount = byName(stage.children, 'Motor mount');
    expect(mount.type).toBe('innertube');
    expect(mount['motorMount']).toBe(true);
    expect(mount['motorOverhang']).toBeCloseTo(0.003, 9);
    expect(mount['outerRadius']).toBeCloseTo(0.00935, 9);
    // An airframe tube that is NOT a mount must not be flagged as one.
    expect(byName(stage.children, 'Airframe')['motorMount']).toBeUndefined();
  });

  it('turns a Ring into the type its UsageCode names', () => {
    expect(byName(stage.children, 'Aft ring').type).toBe('centeringring');
    expect(byName(stage.children, 'Aft ring')['innerRadius']).toBeCloseTo(0.00935, 9);
    expect(byName(stage.children, 'Thrust ring').type).toBe('engineblock');
  });

  it('reads a parachute, including the surface and line densities', () => {
    const chute = byName(stage.children, 'Chute');
    expect(chute.type).toBe('parachute');
    // `Dia` really is a diameter on both sides — the one field that is NOT halved.
    expect(chute['diameter']).toBeCloseTo(0.4, 9);
    expect(chute['cd']).toBe(0.8);
    expect(chute['lineCount']).toBe(6);
    expect(chute['lineLength']).toBeCloseTo(0.35, 9);
    expect(chute['spillHoleDiameter']).toBeCloseTo(0.04, 9);
    // g/cm² → kg/m² is ×1/10; the canopy material is a SURFACE density, so it
    // must not be left on `density`, where it would be read as a bulk one.
    expect(chute['surfaceDensity']).toBeCloseTo(0.067, 9);
    expect(chute['surfaceMaterialName']).toBe('Ripstop nylon');
    expect(chute.density).toBeUndefined();
    // Line density is per MILLIMETER of cord in the file.
    expect(chute['lineDensity']).toBeCloseTo(0.0001, 9);
    expect(chute['lineMaterialName']).toBe('Braided nylon');
  });

  it('splits a MassObject into a shock cord or a mass by TypeCode', () => {
    const cord = byName(stage.children, 'Shock cord');
    expect(cord.type).toBe('shockcord');
    expect(cord['cordLength']).toBeCloseTo(1, 9);
    // 6 g over 1 m of cord.
    expect(cord['lineDensity']).toBeCloseTo(0.006, 9);

    const alt = byName(stage.children, 'Altimeter');
    expect(alt.type).toBe('masscomponent');
    expect(alt['mass']).toBeCloseTo(0.022, 9);
    expect(alt['length']).toBeCloseTo(0.05, 9);
    expect(alt['radius']).toBeCloseTo(0.01, 9);
    // The mass is the component's own, not an override on top of it.
    expect(alt['overrideMass']).toBeUndefined();
  });

  it('names what it could not bring across, and what never transfers', () => {
    expect(res.ignored).toContain('RingTail');
    expect(res.notes.join(' ')).toContain('RingTail');
    expect(res.notes.join(' ')).toMatch(/motor selections and launch conditions are not imported/i);
  });

  it('refuses a file that is not a RockSim design', () => {
    expect(() => importRkt('<openrocket><rocket/></openrocket>')).toThrow(/not a \.rkt/i);
  });
});

describe('importRkt, multi-stage', () => {
  const twoStage = RKT.replace('<StageCount>1</StageCount>', '<StageCount>2</StageCount>').replace(
    '<Stage2Parts/>',
    '<Stage2Parts><BodyTube><Name>Booster tube</Name><Len>200</Len><OD>24.8</OD><ID>24.0</ID></BodyTube></Stage2Parts>',
  );

  it('orders the stages nose-first, which is RockSim 3 → 1', () => {
    const r = importRkt(twoStage);
    expect(r.tree.components).toHaveLength(2);
    expect(r.tree.components[0]!.name).toBe('Sustainer');
    expect(byName(r.tree.components[0]!.children, 'Nose')).toBeTruthy();
    expect(r.tree.components[1]!.name).toBe('Booster 1');
    expect(byName(r.tree.components[1]!.children, 'Booster tube')).toBeTruthy();
  });
});
