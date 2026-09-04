import type { ComponentNode } from '../engine/openRocketEngine';

/**
 * Typed accessors for a ComponentNode's open-ended parameter bag
 * (`[param: string]: unknown`). Each reads one key, returning the value when it
 * has the expected type and the fallback otherwise — the guard-and-cast that
 * every consumer used to hand-roll as a local `num` / `numVal` helper.
 */

/** Numeric parameter, or `fb` (default 0) when absent / non-numeric. */
export const num = (n: ComponentNode, key: string, fb = 0): number =>
  typeof n[key] === 'number' ? (n[key] as number) : fb;

/** Like {@link num} but yields `undefined` (not a fallback) when non-numeric. */
export const numOpt = (n: ComponentNode, key: string): number | undefined =>
  typeof n[key] === 'number' ? (n[key] as number) : undefined;

/** String parameter, or `fb` (default '') when absent / non-string. */
export const str = (n: ComponentNode, key: string, fb = ''): string =>
  typeof n[key] === 'string' ? (n[key] as string) : fb;

/** Boolean parameter, or `fb` (default false) when absent / non-boolean. */
export const bool = (n: ComponentNode, key: string, fb = false): boolean =>
  typeof n[key] === 'boolean' ? (n[key] as boolean) : fb;
