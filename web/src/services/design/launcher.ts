import type { ComponentNode, RocketTree } from '../../engine/openRocketEngine';

/**
 * What the design is launched from, as its own guides say.
 *
 * The kernel flies a rod and a rail alike (its event is `LAUNCHROD` and its field
 * `launchRodLength` either way), so the word is the only difference most of the
 * app sees. The design already answers which: launch lugs ride a rod and rail
 * buttons ride a rail, which is also how the guide-aware clearance model tells
 * them apart. A design with neither, or with both, is called a launcher.
 */
export type LauncherKind = 'rail' | 'rod';

export function launcherKind(tree: RocketTree): LauncherKind | null {
  let lug = false;
  let button = false;
  const walk = (nodes: readonly ComponentNode[] | undefined) => {
    for (const n of nodes ?? []) {
      if (n.type === 'launchlug') lug = true;
      else if (n.type === 'railbutton') button = true;
      walk(n.children);
    }
  };
  walk(tree.components);
  return lug === button ? null : button ? 'rail' : 'rod';
}

/**
 * A translator that names the launcher the way the design does.
 *
 * The launcher strings carry i18next context variants (`_rail`, `_rod`), with the
 * plain key as the neutral "launcher" wording. Passing the context on every
 * lookup is harmless for the keys without variants, so a component can use this
 * in place of its plain `t` for everything it renders.
 */
export function withLauncher<T extends (key: string, options?: Record<string, unknown>) => string>(
  t: T,
  kind: LauncherKind | null,
): T {
  if (!kind) return t;
  return ((key: string, options?: Record<string, unknown>) => t(key, { context: kind, ...options })) as T;
}
