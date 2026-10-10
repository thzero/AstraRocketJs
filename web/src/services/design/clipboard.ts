import type { ComponentNode, RocketTree } from '../../engine/openRocketEngine';
import { reid } from './componentActions';
import { canHost, findNode, findParent, isRecoveryDevice, stageNodes, syncDerived } from './treeEdit';

/**
 * Cut, copy, paste and duplicate on the parts tree, as desktop OpenRocket's
 * Edit menu does them (RocketActions in its swing module).
 *
 * The rules are desktop's: a paste goes inside the selected part when that part
 * can hold it, as its last child; otherwise right after the selected part, in
 * its parent, when the parent can hold it; otherwise nowhere. Duplicate puts the
 * copy at the end of the original's parent. What can hold what is the kernel's
 * rule (`canHost`). The design itself is the parent of the stages, so a stage
 * pastes beside a stage.
 *
 * Pure tree functions; the clipboard itself lives in the workspace store.
 */

/** Where a paste lands: the parent (null for the design itself) and the index. */
export interface PastePlace {
  parentId: string | null;
  index: number;
}

/** Whether `id` can be cut or deleted: anything but the design's last stage. */
export function canRemove(tree: RocketTree, id: string): boolean {
  const node = findNode(tree, id);
  if (!node) return false;
  return node.type !== 'stage' || stageNodes(tree).length > 1;
}

/** Where `clip` would be pasted with `selectedId` selected, or null if nowhere. */
export function pastePlace(tree: RocketTree, clip: ComponentNode, selectedId: string | null): PastePlace | null {
  if (!selectedId) return canHost('rocket', clip.type) ? { parentId: null, index: tree.components.length } : null;
  const selected = findNode(tree, selectedId);
  if (!selected) return null;
  if (canHost(selected.type, clip.type)) return { parentId: selectedId, index: selected.children?.length ?? 0 };
  const parent = findParent(tree, selectedId);
  const siblings = parent ? (parent.children ?? []) : tree.components;
  if (!canHost(parent ? parent.type : 'rocket', clip.type)) return null;
  return { parentId: parent ? (parent.id as string) : null, index: siblings.findIndex((n) => n.id === selectedId) + 1 };
}

/** The stage a node is in (itself, for a stage). */
function stageOf(tree: RocketTree, id: string): ComponentNode | null {
  let node = findNode(tree, id);
  while (node && node.type !== 'stage') node = node.id ? findParent(tree, node.id) : null;
  return node;
}

function* walk(nodes: ComponentNode[]): Generator<ComponentNode> {
  for (const n of nodes) {
    yield n;
    if (n.children) yield* walk(n.children);
  }
}

/**
 * A pasted or duplicated part: the new tree, the copy's id, and each new id
 * against the id it was copied from (see `reid`).
 */
export interface PastedCopy {
  tree: RocketTree;
  id: string;
  origins: Map<string, string>;
}

/**
 * Put a fresh-id copy of `clip` at `place`. A stage holds at most one drogue
 * (see `setStageDrogue`), so a copy that would make a second one lands as a
 * plain recovery device.
 */
function insertCopy(tree: RocketTree, clip: ComponentNode, place: PastePlace): PastedCopy {
  const origins = new Map<string, string>();
  const copy = reid(structuredClone(clip), origins);
  const next = structuredClone(tree);
  const siblings = place.parentId ? (findNode(next, place.parentId)!.children ??= []) : next.components;
  siblings.splice(place.index, 0, copy);
  const id = copy.id as string;
  const stage = stageOf(next, id);
  if (stage?.children) {
    const copied = new Set([...walk([copy])]);
    const drogues = [...walk(stage.children)].filter((n) => isRecoveryDevice(n.type) && n['drogue'] === true);
    if (drogues.some((n) => !copied.has(n)))
      for (const n of drogues) if (copied.has(n)) delete (n as Record<string, unknown>)['drogue'];
  }
  return { tree: syncDerived(next), id, origins };
}

/** Paste `clip` at the selection, or null when it has nowhere to go. */
export function pasteNode(tree: RocketTree, clip: ComponentNode, selectedId: string | null): PastedCopy | null {
  const place = pastePlace(tree, clip, selectedId);
  return place ? insertCopy(tree, clip, place) : null;
}

/** A copy of `id` at the end of its parent's children, or null if it is not in the tree. */
export function duplicateNode(tree: RocketTree, id: string): PastedCopy | null {
  const node = findNode(tree, id);
  if (!node) return null;
  const parent = findParent(tree, id);
  const place = {
    parentId: parent ? (parent.id as string) : null,
    index: (parent?.children ?? tree.components).length,
  };
  return insertCopy(tree, node, place);
}
