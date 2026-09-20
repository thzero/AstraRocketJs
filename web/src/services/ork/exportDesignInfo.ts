import { escapeXml } from '../xmlUtil';
import { sig4 } from '../designInfo';
import type { DesignInfo } from '../orkTypes';
import type { OrkWriter } from './exportWriter';

/**
 * Optional derived-statistics block (sibling of <rocket>) — only when the
 * caller opts in. OpenRocket recomputes this and skips it on load; older / other
 * software ignores it with a harmless "unknown element" warning.
 */
export function designInfoXml(w: OrkWriter, depth: number, designInfo: DesignInfo | undefined): void {
  if (!designInfo || (designInfo.groups.length === 0 && designInfo.finsets.length === 0)) return;
  const { emit } = w;
  emit(depth, '<designinfo>');
  for (const g of designInfo.groups) {
    const attrs =
      g.scope === 'rocket'
        ? 'scope="rocket"'
        : `scope="stage" stagenumber="${g.stageNumber ?? 0}" name="${escapeXml(g.name ?? '')}"`;
    emit(depth + 1, `<statistics ${attrs}>`);
    for (const st of g.stats) {
      emit(
        depth + 2,
        `<stat field="${escapeXml(st.field)}" value="${escapeXml(st.value)}" unit="${escapeXml(st.unit)}"/>`,
      );
    }
    emit(depth + 1, '</statistics>');
  }
  for (const f of designInfo.finsets) {
    emit(
      depth + 1,
      `<finset stagenumber="${f.stageNumber}" stage="${escapeXml(f.stage)}" name="${escapeXml(f.name)}">`,
    );
    emit(depth + 2, `<nosetoroottop unit="m">${sig4(f.topX)}</nosetoroottop>`);
    emit(depth + 2, `<nosetorootbottom unit="m">${sig4(f.bottomX)}</nosetorootbottom>`);
    emit(depth + 1, '</finset>');
  }
  emit(depth, '</designinfo>');
}
