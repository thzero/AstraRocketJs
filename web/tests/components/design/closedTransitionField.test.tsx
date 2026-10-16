// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import en from '../../../src/i18n/locales/en.json';
import { FieldRow } from '../../../src/components/design/DimensionFields';
import { FIELDS } from '../../../src/services/design/componentFields';
import { badDimensions } from '../../../src/services/design/requiredComponent';
import { renderWithProviders } from '../../testing/renderWithProviders';
import type { ComponentNode, RocketTree } from '../../../src/engine/openRocketEngine';

/**
 * The panel flags a field as missing exactly when the run refuses it. A
 * transition closed to a point at one end flies (closedTransition.kernel.test.ts
 * builds one in the kernel), so its 0 end is not missing while the other end has
 * a radius; with both ends at 0 the run refuses the part, and both are flagged.
 */
const fore = FIELDS['transition']!.find((f) => f.key === 'foreRadius')!;

const flagged = (node: Record<string, unknown>): boolean => {
  renderWithProviders(<FieldRow node={node as unknown as ComponentNode} field={fore} onChange={() => {}} />);
  return screen.queryAllByText(en.sims.missingField, { exact: false }).length > 0;
};

const blocks = (node: Record<string, unknown>): boolean =>
  badDimensions({
    components: [{ type: 'stage', id: 's', children: [{ id: 't', length: 0.05, thickness: 0.001, ...node }] }],
  } as unknown as RocketTree).some((b) => b.field === 'foreRadius');

describe('a closed transition end in the panel', () => {
  it('is not flagged while the other end has a radius, as the run accepts it', () => {
    const node = { type: 'transition', foreRadius: 0, aftRadius: 0.02 };
    expect(blocks(node)).toBe(false);
    expect(flagged(node)).toBe(false);
  });

  it('is flagged when both ends are 0, as the run refuses it', () => {
    const node = { type: 'transition', foreRadius: 0, aftRadius: 0 };
    expect(blocks(node)).toBe(true);
    expect(flagged(node)).toBe(true);
  });
});
