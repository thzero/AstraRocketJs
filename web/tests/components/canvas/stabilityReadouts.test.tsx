// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import type { StaticInfo } from '../../../src/engine/api';
import { StabilityBadge } from '../../../src/components/canvas/StabilityBadge';
import { InfoOverlay } from '../../../src/components/canvas/InfoOverlay';
import { StabilityOverlay } from '../../../src/components/canvas/SchematicOverlay';
import { renderWithProviders } from '../../testing/renderWithProviders';

/**
 * A figure the kernel could not compute is shown as missing, never as a
 * verdict or a mark at NaN: the badge does not call the design "Unstable" in
 * red, the info card gives no warning glyph, and the drawing places no CG or CP
 * marker it has no station for.
 */
afterEach(cleanup);

const info = (over: Partial<StaticInfo> = {}): StaticInfo =>
  ({
    length: 0.6,
    refDiameter: 0.05,
    massEmpty: 0.2,
    mass: 0.25,
    cgEmpty: 0.3,
    cg: 0.32,
    cp: 0.42,
    stabilityCalibers: 2,
    stabilityPercent: 16,
    cd: 0.5,
    cna: 9,
    pitchInertia: 0.01,
    rollInertia: 0.0001,
    ...over,
  }) as StaticInfo;

describe('an uncomputable stability margin', () => {
  it('is neither a verdict nor the danger tone on the stats strip', () => {
    renderWithProviders(<StabilityBadge info={info({ stabilityCalibers: NaN })} expanded onToggle={() => {}} />);
    expect(screen.queryByText(/Unstable/)).toBeNull();
    expect(document.querySelector('.text-danger-400')).toBeNull();
  });

  it('still reads its verdict when it is a real number', () => {
    renderWithProviders(<StabilityBadge info={info({ stabilityCalibers: 0.4 })} expanded onToggle={() => {}} />);
    expect(screen.getByText(/Marginal|Unstable/)).toBeTruthy();
  });

  it('carries no warning glyph or danger tone on the info card', () => {
    renderWithProviders(<InfoOverlay info={info({ stabilityCalibers: NaN })} />);
    expect(document.querySelector('.text-danger-400')).toBeNull();
    expect(document.body.textContent).not.toContain('⚠');
  });
});

describe('an uncomputable CG or CP on the drawing', () => {
  it('draws no marker at NaN', () => {
    const { container } = renderWithProviders(
      <svg>
        <StabilityOverlay
          info={info({ cp: NaN, cg: NaN, stabilityCalibers: NaN, stabilityPercent: NaN })}
          showMarkers
          ctx={{ scale: 500, cy: 100, x0: 20 }}
          scale={500}
          vHalf={0.03}
          w={640}
          h={200}
        />
      </svg>,
    );
    expect(container.innerHTML).not.toContain('NaN');
  });
});
