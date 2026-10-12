// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { PropertyPanel } from '../../../src/components/design/PropertyPanel';
import { renderWithProviders } from '../../testing/renderWithProviders';
import { serveData } from '../../testing/serveData';
import type { ComponentNode } from '../../../src/engine/openRocketEngine';
import { MAX_LINE_COUNT } from '../../../src/tree/nodeProps';

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

  // The importers' ceiling, which engineBoundary.test.ts holds to the bridge:
  // the editor admits every count a file can carry, and no more.
  it('takes the shared ceiling, not the instance ceiling', () => {
    const onChange = vi.fn();
    const node = { id: 'p', type: 'parachute', lineCount: 6 } as unknown as ComponentNode;
    renderWithProviders(<PropertyPanel node={node} onChange={onChange} onCommit={() => {}} onRemove={() => {}} />);
    const box = screen.getByLabelText('Shroud lines');
    fireEvent.change(box, { target: { value: '100' } });
    fireEvent.blur(box);
    expect(onChange).toHaveBeenLastCalledWith({ lineCount: 100 });
    fireEvent.change(box, { target: { value: String(MAX_LINE_COUNT + 500) } });
    fireEvent.blur(box);
    expect(onChange).toHaveBeenLastCalledWith({ lineCount: MAX_LINE_COUNT });
  });
});
