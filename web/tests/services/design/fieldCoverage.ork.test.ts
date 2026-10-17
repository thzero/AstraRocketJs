// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { FIELDS, type Field } from '../../../src/services/design/componentFields';
import { exportOrk, importOrk } from '../../../src/services/files/orkFile';
import type { ComponentNode, RocketTree } from '../../../src/engine/openRocketEngine';

/**
 * Every field the Design tab shows survives a .ork save and reopen.
 *
 * Driven by FIELDS, not a hand-picked list: a field added to the panel with no
 * reader or writer behind it fails here. Some fields are only written beside a
 * partner (a fin tab needs all of its dimensions, an overhang or a mount's own
 * ignition needs the mount flag), so the partner is set too.
 */

const TOP = new Set(['nosecone', 'transition', 'bodytube']);
const TAB = { tabLength: 0.02, tabHeight: 0.005, tabOffset: 0.001, tabOffsetMethod: 'top' };
const PARTNER: Record<string, Record<string, unknown>> = {
  motorOverhang: { motorMount: true },
  ignitionEvent: { motorMount: true },
  ignitionDelay: { motorMount: true },
  tabLength: TAB,
  tabHeight: TAB,
  tabOffset: TAB,
  tabOffsetMethod: TAB,
  clusterScale: { cluster: '3-ring' },
  clusterRotation: { cluster: '3-ring' },
  // <shapeclipped> is written only for a shape that can be clipped.
  clipped: { shape: 'ellipsoid' },
};

/**
 * Probe values for fields the generic ones cannot reach. A rail button's height
 * loads before its base and flange, so the setter clamps it against the
 * constructor's 2 mm each (as the desktop loader does): a height under 4 mm
 * does not survive a reopen on either side. A fin cant reads back clamped to
 * the kernel's 15 degrees (FinSet.MAX_CANT_RADIANS), so its probe stays inside it.
 */
const VALUES: Record<string, unknown[]> = {
  'railbutton.height': [0.0131],
  'trapezoidfinset.cant': [0.21],
  'ellipticalfinset.cant': [0.22],
  'freeformfinset.cant': [0.23],
};

/**
 * Probe values by field kind. Numbers are offset by the field's index; a bool
 * or select takes two values, so one stuck at either default still fails.
 */
const valuesFor = (f: Field, i: number): unknown[] => {
  switch (f.kind) {
    case 'length':
    case 'distance':
      return [0.0031 + i * 0.0001];
    case 'mass':
      return [0.0123 + i * 0.0001];
    case 'number':
      return [0.37 + i * 0.01];
    case 'angle':
      return [0.21 + i * 0.01];
    case 'count':
      return [3];
    case 'bool':
      return [true, false];
    case 'select':
      return f.options.length > 1 ? [f.options[0], f.options[f.options.length - 1]] : [];
    case 'text':
      return ['a comment'];
    default:
      // bore and derived rows are views onto other keys, checked through those.
      return [];
  }
};

const flatten = (nodes: ComponentNode[]): ComponentNode[] =>
  nodes.flatMap((n) => [n, ...flatten((n.children ?? []) as ComponentNode[])]);

const roundTrip = (type: string, patch: Record<string, unknown>): ComponentNode | undefined => {
  const part = { type, id: 'probe', name: 'Probe', ...patch } as ComponentNode;
  const body = {
    type: 'bodytube',
    id: 'body',
    length: 0.3,
    outerRadius: 0.026,
    thickness: 0.0005,
    children: TOP.has(type) ? [] : [part],
  };
  const tree = {
    components: [{ type: 'stage', id: 's1', name: 'S', children: TOP.has(type) ? [part, body] : [body] }],
  } as unknown as RocketTree;
  const back = flatten(importOrk(exportOrk({ name: 'Coverage', tree })).tree.components as ComponentNode[]);
  return back.find((n) => n.name === 'Probe');
};

describe('every Design tab field round-trips through .ork', () => {
  const cases = Object.entries(FIELDS)
    .filter(([type]) => type !== 'stage')
    .flatMap(([type, fields]) =>
      fields.flatMap((f, i) =>
        (VALUES[`${type}.${f.key}`] ?? valuesFor(f, i)).map((v) => ({
          name: `${type}.${f.key} = ${String(v)}`,
          type,
          key: f.key,
          v,
          // A select at its first option may be left out of the node as the default.
          absentMeans: f.kind === 'select' ? f.options[0] : f.kind === 'bool' ? false : undefined,
        })),
      ),
    );

  it.each(cases)('$name', ({ type, key, v, absentMeans }) => {
    const got = roundTrip(type, { ...(PARTNER[key] ?? {}), [key]: v })?.[key];
    if (typeof v === 'number') expect(got).toBeCloseTo(v, 9);
    else expect(got ?? absentMeans).toBe(v);
  });
});
