// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { PropertyPanel } from '../../../src/components/design/PropertyPanel';
import { renderWithProviders } from '../../testing/renderWithProviders';
import { serveData } from '../../testing/serveData';
import type { ComponentNode } from '../../../src/engine/openRocketEngine';

beforeAll(serveData);

/**
 * A shock cord is weighed by its line material: the bridge flies
 * `lineMaterialName` and `lineDensity`, and the desktop shock cord dialog has a
 * selector for it. Without a picker, a cord's material could not be changed.
 */
describe('shock cord material', () => {
  it('offers the line catalog and writes the choice to the cord', async () => {
    const onChange = vi.fn();
    renderWithProviders(
      <PropertyPanel
        node={{ id: 'c', type: 'shockcord', cordLength: 0.5, length: 0.03 } as unknown as ComponentNode}
        onChange={onChange}
        onCommit={() => {}}
        onRemove={() => {}}
      />,
    );
    const picker = screen.getByLabelText('Shock cord material') as HTMLSelectElement;
    await waitFor(() => expect(picker.querySelectorAll('optgroup option').length).toBeGreaterThan(0));
    const choice = picker.querySelector('optgroup option') as HTMLOptionElement;
    fireEvent.change(picker, { target: { value: choice.value } });
    const patch = onChange.mock.calls.at(-1)![0] as { lineMaterialName: string; lineDensity: number };
    expect(patch.lineMaterialName).toBe(choice.value);
    expect(patch.lineDensity).toBeGreaterThan(0);
  });
});
