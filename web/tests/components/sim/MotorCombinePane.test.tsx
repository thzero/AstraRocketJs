// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { MotorCombinePane } from '../../../src/components/sim/MotorCombinePane';
import { renderWithProviders } from '../../testing/renderWithProviders';
import type { CatalogMotor } from '../../../src/services/motors/motorDb';

/**
 * Two combine panes in one document each fill from their own gradient: a fixed
 * id would make `url(#id)` resolve to whichever rendered first.
 */
describe('MotorCombinePane gradient', () => {
  const motor = (designation: string) =>
    ({
      designation,
      manufacturer: 'M',
      curves: [
        {
          samples: [
            [0, 0],
            [0.5, 10],
            [1, 0],
          ],
        },
      ],
    }) as unknown as CatalogMotor;

  it('gives each pane its own fill id', () => {
    const { container } = renderWithProviders(
      <>
        <MotorCombinePane motors={[motor('A'), motor('B')]} />
        <MotorCombinePane motors={[motor('C'), motor('D')]} />
      </>,
    );
    const ids = [...container.querySelectorAll('linearGradient')].map((g) => g.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    for (const id of ids) expect(container.querySelector(`path[fill="url(#${id})"]`)).not.toBeNull();
  });
});
