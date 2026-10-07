// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { TermRow } from '../../../src/components/common/TermRow';
import { renderWithProviders } from '../../testing/renderWithProviders';

describe('TermRow', () => {
  it('pairs the label as a term with the value as its definition', () => {
    const { getByRole } = renderWithProviders(
      <dl>
        <TermRow label="Distance">120 m</TermRow>
      </dl>,
    );
    expect(getByRole('term').textContent).toBe('Distance');
    expect(getByRole('definition').textContent).toBe('120 m');
  });

  it('adds a second definition only when a detail is given', () => {
    const { getAllByRole } = renderWithProviders(
      <dl>
        <TermRow label="Lands" detail="120 m, NE">
          40.1, -105.2
        </TermRow>
        <TermRow label="Bearing">45°</TermRow>
      </dl>,
    );
    expect(getAllByRole('definition').map((d) => d.textContent)).toEqual(['40.1, -105.2', '120 m, NE', '45°']);
  });
});
