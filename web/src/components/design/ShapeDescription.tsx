import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { ComponentNode } from '../../engine/openRocketEngine';
import { str } from '../../tree/nodeProps';

/**
 * What the selected nose cone or transition shape is, under the shape picker.
 *
 * The desktop shows this beside its shape selector and it is the only place
 * the app explains what a shape parameter of 0.75 on a parabolic series does,
 * or why an unclipped transition looks the way it does. The strings and their
 * translations are OpenRocket's own (`Shape.<name>.desc1` for a nose cone,
 * `desc2` for a transition, from `core/src/main/resources/l10n/messages*`), so
 * the wording matches the desktop in every language we ship. See
 * `engine-java/ATTRIBUTION.md`. One word differs: the upstream English for the
 * parabolic series misspells "produces", which is corrected here rather than
 * taught to the spell checker.
 *
 * They carry a little markup: `<b>` for the shape names a parameter value
 * produces, `<i>` for the dimensions it is written in terms of, and `<sup>`
 * for the power series exponent. It is rendered by building elements from a
 * three-tag whitelist rather than by handing the string to
 * `dangerouslySetInnerHTML`, which would put vendored text on a path where a
 * future string could carry anything.
 */

const TAG = /<(\/?)(b|i|sup)>/gi;

/** OpenRocket's `<b>` / `<i>` / `<sup>` markup as React elements. */
export function richText(src: string): ReactNode[] {
  const out: ReactNode[] = [];
  const open: { tag: string; kids: ReactNode[] }[] = [];
  const push = (n: ReactNode) => (open.length ? open[open.length - 1]!.kids : out).push(n);
  let last = 0;
  let key = 0;
  for (const m of src.matchAll(TAG)) {
    if (m.index > last) push(src.slice(last, m.index));
    last = m.index + m[0].length;
    const tag = m[2]!.toLowerCase();
    if (m[1]) {
      // A stray close tag is text, not a crash.
      const top = open[open.length - 1];
      if (!top || top.tag !== tag) continue;
      open.pop();
      const El = tag as 'b' | 'i' | 'sup';
      push(<El key={key++}>{top.kids}</El>);
    } else {
      open.push({ tag, kids: [] });
    }
  }
  if (last < src.length) push(src.slice(last));
  // An unclosed tag keeps its contents rather than dropping them.
  while (open.length) {
    const top = open.pop()!;
    (open.length ? open[open.length - 1]!.kids : out).push(...top.kids);
  }
  return out;
}

export function ShapeDescription({ node }: { node: ComponentNode }) {
  const { t } = useTranslation();
  if (node.type !== 'nosecone' && node.type !== 'transition') return null;
  const shape = str(node, 'shape', node.type === 'nosecone' ? 'ogive' : 'conical');
  const key = `shapeDesc.${node.type}.${shape}`;
  const text = t(key, { defaultValue: '' });
  if (!text || text === key) return null;
  return (
    <p className="rounded-md bg-raised/60 px-2 py-1.5 text-[11px] leading-snug text-ink-muted ring-1 ring-line/5">
      {richText(text)}
    </p>
  );
}
