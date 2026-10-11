// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { PropertyPanel } from '../../../src/components/design/PropertyPanel';
import { renderWithProviders } from '../../testing/renderWithProviders';
import { serveData } from '../../testing/serveData';
import type { ComponentNode } from '../../../src/engine/openRocketEngine';

beforeAll(serveData);

/**
 * A parachute may have no shroud lines: Parachute.setLineCount takes 0 and the
 * desktop spinner starts there. A floor of one would snap an imported 0 to 1
 * on the first edit.
 */
describe('shroud line count', () => {
  it('accepts zero', () => {
    const onChange = vi.fn();
    const node = { id: 'p', type: 'parachute', lineCount: 6 } as unknown as ComponentNode;
    renderWithProviders(<PropertyPanel node={node} onChange={onChange} onCommit={() => {}} onRemove={() => {}} />);
    const box = screen.getByLabelText('Shroud lines');
    fireEvent.change(box, { target: { value: '0' } });
    fireEvent.blur(box);
    expect(onChange).toHaveBeenCalledWith({ lineCount: 0 });
  });
});
