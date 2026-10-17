// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import en from '../../../src/i18n/locales/en.json';
import { FieldRow } from '../../../src/components/design/DimensionFields';
import { FIELDS, type Field } from '../../../src/services/design/componentFields';
import { badDimensions, REQUIRED_COMPONENT_FIELDS } from '../../../src/services/design/requiredComponent';
import { renderWithProviders } from '../../testing/renderWithProviders';
import type { ComponentNode, RocketTree } from '../../../src/engine/openRocketEngine';

/**
 * The panel flags a field as missing exactly when the run refuses it. Which
 * values the run refuses is the kernel's answer (requiredComponent.kernel.test.ts
 * flies each one); this holds the panel to the same list.
 */

afterEach(cleanup);

const flagged = (node: Record<string, unknown>, field: Field): boolean => {
  renderWithProviders(<FieldRow node={node as unknown as ComponentNode} field={field} onChange={() => {}} />);
  return screen.queryAllByText(en.sims.missingField, { exact: false }).length > 0;
};

const blocks = (node: Record<string, unknown>, key: string): boolean =>
  badDimensions({
    components: [{ type: 'stage', id: 's', children: [{ id: 'p', ...node }] }],
  } as unknown as RocketTree).some((b) => b.field === key);

const required = Object.entries(REQUIRED_COMPONENT_FIELDS).flatMap(([type, keys]) =>
  keys.map((key) => ({ type, key, field: FIELDS[type]?.find((f) => f.key === key) })),
);

describe('a field the run refuses at 0', () => {
  it.each(required)('is flagged in the panel at 0: $type $key', ({ type, key, field }) => {
    expect(field?.required).toBe(true);
    const node = { type, [key]: 0 };
    expect(blocks(node, key)).toBe(true);
    expect(flagged(node, field!)).toBe(true);
  });
});

describe('a transition closed to a point at both ends', () => {
  it('is neither flagged nor refused, as the kernel flies it', () => {
    const fore = FIELDS['transition']!.find((f) => f.key === 'foreRadius')!;
    const node = { type: 'transition', length: 0.05, thickness: 0.001, foreRadius: 0, aftRadius: 0 };
    expect(fore.required).toBeUndefined();
    expect(blocks(node, 'foreRadius')).toBe(false);
    expect(flagged(node, fore)).toBe(false);
  });
});
