import { asStageNodes } from './orkTree';
import { escapeXml } from './xmlUtil';
import { uuid } from './uuid';
import { appName } from './appInfo';
import type { OrkTreeExportInput } from './orkTypes';
import { createOrkWriter } from './ork/exportWriter';
import { motorConfigurationsXml, resolveWriteConfigs } from './ork/exportMotorConfigs';
import { stageXml } from './ork/exportWriters';
import { simulationsXml } from './ork/exportSimulation';
import { designInfoXml } from './ork/exportDesignInfo';

/**
 * .ork EXPORT: the document frame (declaration, <rocket> header, design
 * metadata, stages, simulations, design info) assembled from the block writers
 * under `ork/`. Every component element is written by the per-type table in
 * `ork/exportWriters.ts`; the flight-configuration table, the simulation block
 * and the design-info block each have their own module.
 */
export function exportOrk({
  name,
  tree,
  motors,
  motor,
  mountId,
  launch,
  configs,
  activeConfigId,
  designInfo,
}: OrkTreeExportInput): string {
  const { writeConfigs, defaultId } = resolveWriteConfigs({ motors, motor, mountId, configs, activeConfigId });
  const w = createOrkWriter(writeConfigs, defaultId);
  const { emit } = w;

  emit(0, "<?xml version='1.0' encoding='utf-8'?>");
  // The creator is the app's own name (appInfo), not a literal: the literal
  // had drifted from the app's actual name and was naming a program that does
  // not exist in every file this app saved.
  emit(0, `<openrocket version="1.10" creator="${escapeXml(appName())}">`);
  emit(1, '<rocket>');
  emit(2, `<name>${escapeXml(name)}</name>`);
  emit(2, `<id>${uuid()}</id>`);
  emit(2, '<axialoffset method="absolute">0.0</axialoffset>');
  emit(2, '<position type="absolute">0.0</position>');
  // Design-level metadata (Rocket configuration) — emit only what's set so an
  // untouched design stays clean; the loader keys on element name, not order.
  const metaField = (key: 'comment' | 'designer' | 'revision') => {
    const v = tree[key];
    if (typeof v === 'string' && v.trim()) emit(2, `<${key}>${escapeXml(v)}</${key}>`);
  };
  metaField('comment');
  metaField('designer');
  metaField('revision');
  emit(2, `<designtype>${escapeXml(tree.designType || 'original')}</designtype>`);
  // Stage nodes at the top level export as sibling <stage> blocks (the
  // desktop model); legacy flat trees wrap into one implicit stage.
  const stageNodes = asStageNodes(tree);
  motorConfigurationsXml(w, 2, stageNodes.length);
  emit(2, '<referencetype>maximum</referencetype>');
  emit(2, '<subcomponents>');
  for (let i = 0; i < stageNodes.length; i++) {
    stageXml(w, 3, stageNodes[i]!, i);
  }
  emit(2, '</subcomponents>');
  emit(1, '</rocket>');
  simulationsXml(w, 1, launch);
  designInfoXml(w, 1, designInfo);
  emit(0, '</openrocket>');
  return w.lines.join('\n') + '\n';
}
