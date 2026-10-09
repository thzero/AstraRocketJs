// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { renderWithProviders } from '../../testing/renderWithProviders';
import { ShapeDescription, richText } from '../../../src/components/design/ShapeDescription';
import type { ComponentNode } from '../../../src/engine/openRocketEngine';
import en from '../../../src/i18n/locales/en.json';

/**
 * The shape description, in OpenRocket's own words.
 *
 * The strings are vendored from the desktop's `l10n/messages*.properties`, so
 * two things matter: that the right one is picked for the part and the shape,
 * and that their markup is turned into elements rather than handed to
 * `dangerouslySetInnerHTML`. The second is why `richText` is tested on its own:
 * it is the only part of this that could ever render something it was given.
 */
const part = (type: string, shape: string) => ({ id: 'x', type, shape }) as unknown as ComponentNode;

describe('richText', () => {
  it('builds elements from the three tags the strings use', () => {
    render(<p data-testid="t">{richText('a <b>bold</b> and <i>italic</i> and x<sup>k</sup>')}</p>);
    const el = screen.getByTestId('t');
    expect(el.querySelector('b')?.textContent).toBe('bold');
    expect(el.querySelector('i')?.textContent).toBe('italic');
    expect(el.querySelector('sup')?.textContent).toBe('k');
  });

  it('renders anything else as text, tags included', () => {
    render(<p data-testid="t">{richText('<script>alert(1)</script> <img src=x>')}</p>);
    const el = screen.getByTestId('t');
    expect(el.querySelector('script')).toBeNull();
    expect(el.querySelector('img')).toBeNull();
    expect(el.textContent).toContain('<script>alert(1)</script>');
  });

  it('keeps the contents of an unclosed or stray tag', () => {
    expect(render(<p data-testid="a">{richText('<b>open')}</p>).container.textContent).toBe('open');
    expect(render(<p data-testid="b">{richText('close</b> up')}</p>).container.textContent).toBe('close up');
  });
});

describe('ShapeDescription', () => {
  it('describes a nose cone shape', () => {
    renderWithProviders(<ShapeDescription node={part('nosecone', 'ellipsoid')} />);
    expect(screen.getByText(/ellipsoidal nose cone/i)).toBeTruthy();
  });

  it('describes the SAME shape differently on a transition', () => {
    renderWithProviders(<ShapeDescription node={part('transition', 'ellipsoid')} />);
    // The transition text is the one that explains what clipping does.
    expect(screen.getByText(/not clipped/i)).toBeTruthy();
  });

  it('says nothing for a part that has no shape', () => {
    const { container } = renderWithProviders(<ShapeDescription node={part('bodytube', 'ogive')} />);
    expect(container.textContent).toBe('');
  });

  it('has a description for every shape the pickers offer, on both parts', () => {
    // The shape lists and the description block have to stay in step: a shape
    // added to one and not the other shows an empty box or a missing key.
    const shapes = ['ogive', 'conical', 'ellipsoid', 'power', 'parabolic', 'haack'];
    for (const part of ['nosecone', 'transition'] as const) {
      for (const s of shapes) {
        expect((en.shapeDesc as Record<string, Record<string, string>>)[part]?.[s], `${part}.${s}`).toBeTruthy();
      }
    }
  });
});
