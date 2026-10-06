// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { CardGroup } from '../../../src/components/common/CardGroup';
import { renderWithProviders } from '../../testing/renderWithProviders';

describe('CardGroup', () => {
  it('heads its children with the title', () => {
    const { getByRole, getByText } = renderWithProviders(
      <CardGroup title="Launch rod">
        <span>Length</span>
      </CardGroup>,
    );
    const heading = getByRole('heading', { level: 3, name: 'Launch rod' });
    expect(heading.closest('section')?.contains(getByText('Length'))).toBe(true);
  });
});
