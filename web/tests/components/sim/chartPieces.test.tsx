// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { LegendSwatch, SeriesPath, peakOf } from '../../../src/components/sim/chartAxes';
import { CATEGORICAL, seriesColor } from '../../../src/components/common/chartPalette';
import '../../testing/renderWithProviders';

const X = (t: number) => t * 10;
const Y = (f: number) => 100 - f;

describe('peakOf', () => {
  it('takes the first of the tallest samples', () => {
    expect(
      peakOf([
        [0, 1],
        [1, 5],
        [2, 5],
      ]),
    ).toEqual([1, 5]);
  });
});

describe('SeriesPath', () => {
  const pts: [number, number][] = [
    [0, 0],
    [1, 40],
    [2, 10],
  ];

  it('labels the curve just above its peak in the series color', () => {
    const { container } = render(
      <svg>
        <SeriesPath pts={pts} X={X} Y={Y} color="#123456" strokeWidth={2} label="F15" labelLift={5} labelClass="x" />
      </svg>,
    );
    const text = container.querySelector('text')!;
    expect(text.textContent).toBe('F15');
    expect(text.getAttribute('x')).toBe('10');
    expect(text.getAttribute('y')).toBe('55');
    expect(text.getAttribute('fill')).toBe('#123456');
    expect(container.querySelector('path')!.getAttribute('stroke-width')).toBe('2');
  });

  it('draws the curve alone without a label', () => {
    const { container } = render(
      <svg>
        <SeriesPath pts={pts} X={X} Y={Y} color="#123456" strokeWidth={1.5} labelLift={4} labelClass="x" />
      </svg>,
    );
    expect(container.querySelector('text')).toBeNull();
  });
});

describe('LegendSwatch', () => {
  it('draws a swatch of the given length, dashed on request', () => {
    const { container } = render(
      <LegendSwatch color="#eab308" width={14} dash>
        Burn
      </LegendSwatch>,
    );
    const line = container.querySelector('line')!;
    expect(line.getAttribute('x2')).toBe('14');
    expect(line.getAttribute('stroke-dasharray')).toBe('3 2');
    expect(container.textContent).toBe('Burn');
  });
});

describe('seriesColor', () => {
  it('walks the categorical palette and grays out past the sixth motor', () => {
    expect(seriesColor(0)).toBe(CATEGORICAL[0]);
    expect(seriesColor(5)).toBe(CATEGORICAL[5]);
    expect(seriesColor(6)).toBe('#94a3b8');
  });
});
