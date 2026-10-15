import type { ComponentNode } from '../../../engine/openRocketEngine';
import { IN, fmt, type Cdx1Writer } from './units';
import { finXml, partName } from './sustainer';
import { KeyedError } from '../../../i18n/keyedError';
import { num } from '../../../tree/nodeProps';
import { isFinSet } from '../../../tree/tubefins';
import { isChainType } from '../../../tree/componentKinds';
import { partLength } from '../../../tree/position';

/**
 * Boosters (each lower stage) as <Booster> elements. A leading widening
 * transition is the shoulder into the stage above; a trailing narrowing one
 * on the last stage is the boat tail. A RASAero booster has a boat tail only
 * on the last stage (`BoosterDTO`, error32), so a trailing transition on any
 * other stage refuses the export rather than becoming one.
 */
export function writeBoosters(w: Cdx1Writer, stagesIn: ComponentNode[]): void {
  const { emit } = w;
  for (let i = 1; i < stagesIn.length; i++) {
    const st = stagesIn[i]!;
    const lastStage = i === stagesIn.length - 1;
    const kids = st.children ?? [];
    const tubes = kids.filter((c) => c.type === 'bodytube');
    if (tubes.length === 0) {
      throw new KeyedError('errors.rasaero.boosterNoTube', { stage: partName(st) });
    }
    const bodyLen = tubes.reduce((s, t) => s + partLength(t), 0);
    const externals = kids.filter((c) => c.type === 'bodytube' || c.type === 'transition');
    const first = externals[0];
    const shoulder =
      first && first.type === 'transition' && num(first, 'foreRadius', 0) <= num(first, 'aftRadius', 0) ? first : null;
    const last = externals[externals.length - 1];
    const trailing =
      last && last !== shoulder && last.type === 'transition' && num(last, 'foreRadius', 0) > num(last, 'aftRadius', 0)
        ? last
        : null;
    if (trailing && !lastStage) {
      throw new KeyedError('errors.rasaero.boosterBoattail', { stage: partName(st) });
    }
    const boattail = lastStage ? trailing : null;
    const extraTrans = kids.filter((c) => c.type === 'transition' && c !== shoulder && c !== boattail);
    if (extraTrans.length > 0) {
      throw new KeyedError('errors.rasaero.boosterTransitions', { stage: partName(st) });
    }
    const shoulderLen = shoulder ? num(shoulder, 'length', 0) : 0;
    const btLen = boattail ? num(boattail, 'length', 0) : 0;
    const finParents = kids.filter((c) => (c.children ?? []).some((k) => isFinSet(k.type)));
    if (finParents.length > 1) {
      throw new KeyedError('errors.rasaero.boosterFins', { stage: partName(st) });
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
    // Where the booster's first part starts, its shoulder when it has one, as
    // desktop's `BoosterDTO` writes `firstChild.getAxialOffset(ABSOLUTE)`.
    emit(`<Location>${fmt(w.locM * IN)}</Location>`);
    emit('<Color>Black</Color>');
    emit(`<ShoulderLength>${fmt(shoulderLen * IN)}</ShoulderLength>`);
    emit('<NozzleExitDiameter>0</NozzleExitDiameter>');
    emit(`<BoattailLength>${fmt(btLen * IN)}</BoattailLength>`);
    emit(`<BoattailRearDiameter>${fmt(boattail ? num(boattail, 'aftRadius', 0) * 2 * IN : 0)}</BoattailRearDiameter>`);
    const finParent = finParents[0] ?? tubes[0]!;
    // Where the fin set's part starts from the nose tip: the stage's start plus
    // the parts ahead of it in the stage.
    const ahead = kids.slice(0, kids.indexOf(finParent)).filter((c) => isChainType(c.type));
    // The booster is one body as long as all its tubes, and RASAero measures
    // the fin's Location from that body's bottom, so the tubes after the one
    // the fins are on lie between them, as desktop's `BoosterDTO` adds them
    // (`finLocationOffset`).
    const at = tubes.indexOf(finParent);
    const behind = at < 0 ? 0 : tubes.slice(at + 1).reduce((s, t) => s + partLength(t), 0);
    finXml(w, finParent, w.locM + ahead.reduce((s, c) => s + partLength(c), 0), behind);
    emit('</Booster>');
    w.locM += shoulderLen + bodyLen + btLen;
  }
}
