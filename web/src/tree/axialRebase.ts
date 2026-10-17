import type { ComponentNode, ComponentPosition, RocketTree } from '../engine/openRocketEngine';
import { isAssembly } from './assembly';
import { isChainType } from './componentKinds';
import { num } from './nodeProps';
import { tabOffsetAt, tabPosition } from './finPlanform';
import { axialLength, axialStart, partLength, startFromPosition } from './position';

/**
 * Changing how a position is measured keeps the part where it is.
 *
 * The method is a lens on the position, not the position itself: the kernel's
 * `RocketComponent.setAxialMethod` rewrites the offset through
 * `getAxialOffset(newMethod)`, and `FinSet.setTabOffsetMethod` does the same for
 * the tab. Keeping the number instead moves the part (a ring at "top" 20 mm
 * switched to "bottom" would sit 20 mm past its tube's end) and writes a file
 * that differs from the desktop's for the same clicks.
 */

/** Where a part sits in the rocket frame: its leading edge and its axial length. */
export interface AxialFrame {
  start: number;
  length: number;
}

/**
 * Every part's rocket-frame frame, keyed by id.
 *
 * Laid out the way the drawings lay the tree out: stages flatten into one
 * nose-to-tail chain whose members stack, a pod set's or booster's airframe
 * parts stack from its front, and everything else sits by its position
 * against its parent. An `absolute` offset is measured from the rocket's
 * origin, as the kernel measures it. A part inside a pod set or a
 * booster is placed by its first copy, as `getComponentLocations()[0]` is.
 */
export function axialFrames(tree: RocketTree): Map<string, AxialFrame> {
  const out = new Map<string, AxialFrame>();
  const visit = (n: ComponentNode, start: number, length: number): void => {
    if (n.id) out.set(n.id, { start, length });
    let chained = start;
    for (const c of n.children ?? []) {
      if (isAssembly(n.type) && isChainType(c.type)) {
        const len = partLength(c);
        visit(c, chained, len);
        chained += len;
        continue;
      }
      const own = axialLength(c);
      visit(c, axialStart(c, own, start, length), own);
    }
  };
  let x = 0;
  for (const stage of tree.components) {
    const kids = stage.type === 'stage' ? (stage.children ?? []) : [stage];
    const stageStart = x;
    const stageLen = kids.reduce((sum, n) => sum + (isChainType(n.type) ? partLength(n) : 0), 0);
    if (stage.type === 'stage' && stage.id) out.set(stage.id, { start: stageStart, length: stageLen });
    for (const n of kids) {
      if (isChainType(n.type)) {
        const len = partLength(n);
        visit(n, x, len);
        x += len;
      } else {
        const own = axialLength(n);
        visit(n, axialStart(n, own, stageStart, stageLen), own);
      }
    }
  }
  return out;
}

/** The rocket-frame frame of the part `id`, or null when it is not in the tree. */
export function axialFrameOf(tree: RocketTree, id: string): AxialFrame | null {
  return axialFrames(tree).get(id) ?? null;
}

/**
 * Where a part's parent starts in the rocket frame, which an `absolute` offset
 * is measured against: 0 for a part with no parent or an id-less one, which
 * only a hand-built tree has.
 */
export function parentStartOf(tree: RocketTree, parent: ComponentNode | null | undefined): number {
  return (parent?.id ? axialFrameOf(tree, parent.id)?.start : undefined) ?? 0;
}

/**
 * `pos` re-expressed under `method`, the part staying put: the kernel's
 * `getAxialOffset(method)` (AxialMethod.getAsOffset) from the leading edge the
 * current method gives.
 *
 * @param childLen the part's axial length (a fin set's root chord)
 * @param parent the parent's rocket-frame start and axial length
 */
export function rebasePosition(
  pos: ComponentPosition,
  method: ComponentPosition['method'],
  childLen: number,
  parent: AxialFrame,
): ComponentPosition {
  if (method === pos.method) return pos;
  // Leading edge, from the parent's leading edge.
  const rel = startFromPosition(pos, childLen, parent.length, parent.start);
  const offset =
    method === 'absolute'
      ? rel + parent.start
      : method === 'middle'
        ? rel + (childLen - parent.length) / 2
        : method === 'bottom'
          ? rel + (childLen - parent.length)
          : rel;
  return { method, offset };
}

/**
 * The patch that switches a fin set's tab reference to `method` and keeps the
 * tab where it is, as `FinSet.setTabOffsetMethod` does. An unset method is the
 * kernel's default, the middle.
 */
export function rebaseTabOffset(node: ComponentNode, method: string): Partial<ComponentNode> {
  const from = typeof node['tabOffsetMethod'] === 'string' ? node['tabOffsetMethod'] : 'middle';
  const tabLen = num(node, 'tabLength', 0);
  const root = axialLength(node);
  const front = tabPosition(num(node, 'tabOffset', 0), tabLen, root, from);
  return { tabOffsetMethod: method, tabOffset: tabOffsetAt(front, tabLen, root, method) };
}
