// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { DesignWarnings } from './DesignWarnings';
import { renderWithProviders } from '../../testing/renderWithProviders';
import { useWorkspaceStore } from '../../state/store';
import type { StaticInfo } from '../../engine/openRocketEngine';

const setInfo = (warningTexts: string[]) =>
  useWorkspaceStore.setState({ info: { warnings: warningTexts.length, warningTexts } as StaticInfo });

/**
 * Design warnings were exported by the engine and read by nothing: the field was
 * parsed into `StaticInfo` and dropped, so the app silently withheld the class of
 * warning OpenRocket shows most often.
 */
describe('DesignWarnings', () => {
  beforeEach(() => setInfo([]));

  it('renders nothing when the design is clean', () => {
    // No jest-dom matchers in this project, so assert on the DOM directly.
    const { container } = renderWithProviders(<DesignWarnings />);
    expect(container.innerHTML).toBe('');
  });

  it('translates the kernel key and keeps the component names', () => {
    // TeaVM ships no resource bundles, so the kernel hands back its own lookup
    // key. What follows it is real content the kernel built.
    setInfo(['[Warning.DISCONTINUITY]:  "Nose cone", "Body tube"']);
    renderWithProviders(<DesignWarnings />);
    expect(screen.getByText('Body diameter discontinuity: "Nose cone", "Body tube"')).toBeTruthy();
  });

  it('counts them, and shows every one', () => {
    setInfo(['[Warning.DISCONTINUITY]:  "Nose cone"', '[Warning.ZERO_AREA_FIN]:  "Fins"']);
    renderWithProviders(<DesignWarnings />);
    expect(screen.getByLabelText('Design warnings (2)')).toBeTruthy();
    expect(screen.getByText('Fin has zero area: "Fins"')).toBeTruthy();
  });
});
