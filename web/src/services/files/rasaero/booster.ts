import type { ComponentNode } from '../../../engine/openRocketEngine';
import { IN, fmt, type Cdx1Writer } from './units';
import { finXml } from './sustainer';
import { num } from '../../../tree/nodeProps';
import { isFinSet } from '../../../tree/tubefins';

/**
 * Boosters (each lower stage) as <Booster> elements. A leading widening
 * transition is the shoulder into the stage above; a trailing narrowing one
 * is the boat tail.
 */
export function writeBoosters(w: Cdx1Writer, stagesIn: ComponentNode[]): void {
  const { emit } = w;
  for (let i = 1; i < stagesIn.length; i++) {
    const st = stagesIn[i]!;
    const kids = st.children ?? [];
    const tubes = kids.filter((c) => c.type === 'bodytube');
    if (tubes.length === 0) {
      throw new Error(`Stage "${st.name}" has no body tube — RASAero boosters need one.`);
    }
    const bodyLen = tubes.reduce((s, t) => s + num(t, 'length', 0.1), 0);
    const externals = kids.filter((c) => c.type === 'bodytube' || c.type === 'transition');
    const first = externals[0];
    const shoulder =
      first && first.type === 'transition' && num(first, 'foreRadius', 0) <= num(first, 'aftRadius', 0) ? first : null;
    const last = externals[externals.length - 1];
    const boattail =
      last && last !== shoulder && last.type === 'transition' && num(last, 'foreRadius', 0) > num(last, 'aftRadius', 0)
        ? last
        : null;
    const extraTrans = kids.filter((c) => c.type === 'transition' && c !== shoulder && c !== boattail);
    if (extraTrans.length > 0) {
      throw new Error(
        `RASAero boosters support only a shoulder and a boat tail — stage "${st.name}" has other transitions; export as .ork.`,
      );
    }
    const shoulderLen = shoulder ? num(shoulder, 'length', 0) : 0;
    const btLen = boattail ? num(boattail, 'length', 0) : 0;
    const finParents = kids.filter((c) => (c.children ?? []).some((k) => isFinSet(k.type)));
    if (finParents.length > 1) {
      throw new Error(`RASAero allows ONE fin set per booster — stage "${st.name}" has several; export as .ork.`);
    }
    emit('<Booster>');
    emit('<PartType>Booster</PartType>');
    emit(`<Length>${fmt(bodyLen * IN)}</Length>`);
    emit(`<Diameter>${fmt(num(tubes[0]!, 'outerRadius', 0.012) * 2 * IN)}</Diameter>`);
    emit(
      `<InsideDiameter>${fmt((shoulder ? num(shoulder, 'foreRadius', 0.012) : num(tubes[0]!, 'outerRadius', 0.012)) * 2 * IN)}</InsideDiameter>`,
    );
    emit('<LaunchLugDiameter>0</LaunchLugDiameter>');
    emit('<LaunchLugLength>0</LaunchLugLength>');
    emit('<RailGuideDiameter>0</RailGuideDiameter>');
    emit('<RailGuideHeight>0</RailGuideHeight>');
    emit('<LaunchShoeArea>0</LaunchShoeArea>');
    // The booster body starts after the shoulder (which slides into the stage above).
    emit(`<Location>${fmt((w.locM + shoulderLen) * IN)}</Location>`);
    emit('<Color>Black</Color>');
    emit(`<ShoulderLength>${fmt(shoulderLen * IN)}</ShoulderLength>`);
    emit('<NozzleExitDiameter>0</NozzleExitDiameter>');
    emit(`<BoattailLength>${fmt(btLen * IN)}</BoattailLength>`);
    emit(`<BoattailRearDiameter>${fmt(boattail ? num(boattail, 'aftRadius', 0) * 2 * IN : 0)}</BoattailRearDiameter>`);
    finXml(w, finParents[0] ?? tubes[0]!);
    emit('</Booster>');
    w.locM += shoulderLen + bodyLen + btLen;
  }
}
