// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { AppearanceSection } from '../../../src/components/design/AppearanceSection';
import { renderWithProviders } from '../../testing/renderWithProviders';
import type { ComponentNode } from '../../../src/engine/openRocketEngine';
import { DEFAULT_PART_COLORS } from '../../../src/services/design/partColors';

/**
 * Desktop's Appearance tab (`AppearancePanel`) without the texture: the figure
 * style the 2D views draw, and the 3D appearance with its own "Use default",
 * color, shine and opacity, plus the inside and the edges on a part that has
 * an inside. Every control lands as one undo step.
 */

const render = (node: Record<string, unknown>) => {
  const onCommitChange = vi.fn();
  renderWithProviders(<AppearanceSection node={node as unknown as ComponentNode} onCommitChange={onCommitChange} />);
  return onCommitChange;
};

const PAINTED = { paint: '#102030', alpha: 255, shine: 0.4 };

describe('the figure style', () => {
  it('commits a picked color once, when the picker closes', () => {
    const commit = render({ type: 'bodytube', id: 'b', color: '#000000' });
    const el = screen.getByLabelText('Component color') as HTMLInputElement;
    fireEvent.input(el, { target: { value: '#111111' } });
    fireEvent.input(el, { target: { value: '#222222' } });
    expect(commit).not.toHaveBeenCalled();
    fireEvent.change(el, { target: { value: '#333333' } });
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith({ color: '#333333' });
  });

  it('is on the default while the part has no color, with the picker disabled', () => {
    const commit = render({ type: 'bodytube', id: 'b' });
    expect((screen.getByLabelText('Component color') as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText('Use default color'));
    expect(commit).toHaveBeenCalledWith({ color: expect.stringMatching(/^#[0-9a-f]{6}$/) });
  });

  it('goes back to the default when ticked', () => {
    const commit = render({ type: 'bodytube', id: 'b', color: '#abcdef' });
    fireEvent.click(screen.getByLabelText('Use default color'));
    expect(commit).toHaveBeenCalledWith({ color: undefined });
  });

  it('takes a typed hex color on blur, and puts back a box that is not one', () => {
    const commit = render({ type: 'bodytube', id: 'b', color: '#000000' });
    const box = screen.getByLabelText('Component color, Hex color') as HTMLInputElement;
    fireEvent.change(box, { target: { value: 'nonsense' } });
    fireEvent.blur(box);
    expect(commit).not.toHaveBeenCalled();
    expect(box.value).toBe('#000000');
    fireEvent.change(box, { target: { value: '#ABC' } });
    fireEvent.blur(box);
    expect(commit).toHaveBeenCalledWith({ color: '#aabbcc' });
  });
});

describe('the 3D appearance', () => {
  it("shows the type's default, disabled, while the part has none, and starts from it when cleared", () => {
    const commit = render({ type: 'bodytube', id: 'b' });
    const color = screen.getByLabelText('Color') as HTMLInputElement;
    expect((color as HTMLInputElement).disabled).toBe(true);
    expect(color.value).toBe(DEFAULT_PART_COLORS.body);
    // ESTES_BT's shine.
    expect((screen.getByLabelText('Shine') as HTMLInputElement).value).toBe('30');
    fireEvent.click(screen.getByLabelText('Use default'));
    expect(commit).toHaveBeenCalledWith({ appearance: { paint: DEFAULT_PART_COLORS.body, alpha: 255, shine: 0.3 } });
  });

  it('goes back to the default when ticked', () => {
    const commit = render({ type: 'bodytube', id: 'b', appearance: PAINTED });
    fireEvent.click(screen.getByLabelText('Use default'));
    expect(commit).toHaveBeenCalledWith({ appearance: undefined });
  });

  it('commits the paint, the shine and the opacity, the opacity as the paint alpha', () => {
    const commit = render({ type: 'bodytube', id: 'b', appearance: PAINTED });
    fireEvent.change(screen.getByLabelText('Color'), { target: { value: '#ff0000' } });
    expect(commit).toHaveBeenLastCalledWith({ appearance: { ...PAINTED, paint: '#ff0000' } });
    const shine = screen.getByLabelText('Shine');
    fireEvent.focus(shine);
    fireEvent.change(shine, { target: { value: '75' } });
    fireEvent.blur(shine);
    expect(commit).toHaveBeenLastCalledWith({ appearance: { ...PAINTED, shine: 0.75 } });
    const opacity = screen.getByLabelText('Opacity');
    fireEvent.focus(opacity);
    fireEvent.change(opacity, { target: { value: '50' } });
    fireEvent.blur(opacity);
    // AppearanceBuilder.setOpacity: (int) (0.5 * 255).
    expect(commit).toHaveBeenLastCalledWith({ appearance: { ...PAINTED, alpha: 127 } });
  });

  it('does not write back an opacity the box only rounded', () => {
    const commit = render({ type: 'bodytube', id: 'b', appearance: { ...PAINTED, alpha: 128 } });
    const opacity = screen.getByLabelText('Opacity') as HTMLInputElement;
    expect(opacity.value).toBe('50.2');
    fireEvent.focus(opacity);
    fireEvent.blur(opacity);
    expect(commit).not.toHaveBeenCalled();
  });
});

describe('the inside', () => {
  it('is offered only on a part that has one', () => {
    render({ type: 'centeringring', id: 'r' });
    expect(screen.queryByLabelText(/separate appearance/)).toBeNull();
  });

  it('edits the outside until the two are set apart, then offers an inside tab', () => {
    const commit = render({ type: 'bodytube', id: 'b' });
    // The one Inside button is the edge choice; there is no tab yet.
    expect(screen.getAllByRole('button', { name: 'Inside' })).toHaveLength(1);
    fireEvent.click(screen.getByLabelText('Use separate appearance for outside and inside'));
    expect(commit).toHaveBeenCalledWith({ separateInsideOutside: true });
  });

  it('edits the inside appearance on the inside tab', () => {
    const commit = render({
      type: 'bodytube',
      id: 'b',
      appearance: PAINTED,
      separateInsideOutside: true,
    });
    // The edge choice and the tab both name the two sides.
    const [, insideTab] = screen.getAllByRole('button', { name: 'Inside' });
    fireEvent.click(insideTab!);
    expect((screen.getByLabelText('Use default') as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByLabelText('Use default'));
    expect(commit).toHaveBeenCalledWith({
      insideAppearance: { paint: DEFAULT_PART_COLORS.body, alpha: 255, shine: 0.3 },
    });
  });

  it('picks the edges only while the two are apart', () => {
    render({ type: 'bodytube', id: 'b' });
    expect((screen.getByRole('button', { name: 'Inside' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('sets the edges to the inside', () => {
    const commit = render({ type: 'bodytube', id: 'b', separateInsideOutside: true });
    fireEvent.click(screen.getAllByRole('button', { name: 'Inside' })[0]!);
    expect(commit).toHaveBeenCalledWith({ edgesSameAsInside: true });
  });

  it('calls a fin set its left and right sides', () => {
    render({ type: 'trapezoidfinset', id: 'f', separateInsideOutside: true });
    expect(
      (screen.getByLabelText('Use separate appearance for left and right sides') as HTMLInputElement).checked,
    ).toBe(true);
    expect(screen.getAllByRole('button', { name: 'Right side' })).toHaveLength(2);
  });
});
