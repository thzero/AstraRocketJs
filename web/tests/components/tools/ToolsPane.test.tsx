// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { forgetToolsPane, ToolsPane } from '../../../src/components/tools/ToolsPane';
import { forgetOffTheRail } from '../../../src/components/tools/OffTheRail';
import { forgetParachuteTool } from '../../../src/components/tools/ParachuteTool';
import { forgetLandingEstimator } from '../../../src/components/tools/LandingEstimator';
import { renderWithProviders } from '../../testing/renderWithProviders';

// The real picker loads the catalog; this one hands back a motor at once.
vi.mock('../../../src/components/sim/MotorDialog', () => ({
  MotorDialog: ({ onSelect, onClose }: { onSelect: (m: unknown) => void; onClose: () => void }) => (
    <button
      onClick={() => {
        onSelect({
          designation: 'F50',
          manufacturer: 'Test',
          diameter: 0.029,
          length: 0.1,
          times: [0, 1],
          thrusts: [50, 50],
          masses: [0.1, 0.05],
          cgX: 0.05,
          ejectionDelay: 6,
        });
        onClose();
      }}
    >
      Pick F50
    </button>
  ),
}));

beforeEach(() => {
  forgetToolsPane();
  forgetOffTheRail();
  forgetParachuteTool();
  forgetLandingEstimator();
});

const value = (label: string) => screen.getByText(label).nextElementSibling?.textContent;

describe('the Tools tab', () => {
  it('opens on the landing estimator, and switches tools from a tab list', () => {
    renderWithProviders(<ToolsPane />);
    expect(screen.getByRole('heading', { name: 'Landing estimator' })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Parachute sizing' }));
    expect(screen.getByRole('heading', { name: 'Parachute sizing' })).toBeTruthy();
    // Only the open tool is in the document.
    expect(screen.queryByRole('heading', { name: 'Landing estimator' })).toBeNull();
    expect(screen.getByRole('tab', { name: 'Parachute sizing' }).getAttribute('aria-selected')).toBe('true');
  });

  it('sizes a parachute from typed inputs, and rates a canopy given one', () => {
    renderWithProviders(<ToolsPane />);
    fireEvent.click(screen.getByRole('tab', { name: 'Parachute sizing' }));
    const result = screen.getByRole('region', { name: 'Parachute sizing result' });
    expect(result.textContent).toMatch(/Main \(/);
    expect(result.textContent).not.toMatch(/This canopy/);
    // No buttons to apply a size: there is no design here to apply it to.
    expect(screen.queryByRole('button', { name: 'Use the main diameter' })).toBeNull();
    fireEvent.change(screen.getByLabelText('Canopy diameter'), { target: { value: '60' } });
    expect(result.textContent).toMatch(/This canopy/);
  });

  it('sizes for the air at the site when a temperature is typed', () => {
    renderWithProviders(<ToolsPane />);
    fireEvent.click(screen.getByRole('tab', { name: 'Parachute sizing' }));
    const result = screen.getByRole('region', { name: 'Parachute sizing result' });
    const main = () => within(result).getByText(/^Main \(/).nextElementSibling?.textContent;
    fireEvent.change(screen.getByLabelText('Site elevation'), { target: { value: '2682' } });
    const blank = main();
    // The standard temperature at 2,682 m is about -2.4 C; typing it keeps the
    // site's own pressure, so the canopy stays the size the blank field gave.
    fireEvent.change(screen.getByLabelText('Temperature'), { target: { value: '-2.4' } });
    expect(main()).toBe(blank);
  });

  it('works out a rail exit once there is a motor', () => {
    renderWithProviders(<ToolsPane />);
    fireEvent.click(screen.getByRole('tab', { name: 'Off the rail' }));
    expect(screen.getByText("Choose a motor, and enter the rocket's mass and the rail length.")).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Choose…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Pick F50' }));
    expect(screen.getByText('Test F50')).toBeTruthy();
    // 0.5 kg airframe and a 0.1 kg motor: 50 N over 0.6 kg weight.
    expect(value('Thrust to weight, average')).toBe('8.5 : 1');
    // 12.2 m/s is under the default minimum, so the reading says so.
    expect(value('Rail exit speed')).toMatch(/^[\d.]+ m\/s · Below minimum$/);
    expect(value('Weathercock angle')).toMatch(/°$/);
    expect(screen.getByText(/^An estimate: no drag/)).toBeTruthy();
  });

  it('names an out-of-limit rail figure in words, not only in amber', () => {
    renderWithProviders(<ToolsPane />);
    fireEvent.click(screen.getByRole('tab', { name: 'Off the rail' }));
    fireEvent.click(screen.getByRole('button', { name: 'Choose…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Pick F50' }));
    expect(value('Thrust to weight, average')).toBe('8.5 : 1');
    // 50 N under 1.6 kg is about 3.2 : 1, below the 5 : 1 the rules ask for.
    const mass = screen.getByLabelText('Rocket mass without the motor') as HTMLInputElement;
    const grams = Number(mass.value) > 10;
    fireEvent.change(mass, { target: { value: grams ? '1500' : '1.5' } });
    expect(value('Thrust to weight, average')).toMatch(/Below minimum$/);
  });

  it('keeps each tool as it was left across a trip to another tab', () => {
    const { unmount } = renderWithProviders(<ToolsPane />);
    fireEvent.click(screen.getByRole('tab', { name: 'Parachute sizing' }));
    fireEvent.change(screen.getByLabelText('Canopy diameter'), { target: { value: '60' } });
    unmount();
    renderWithProviders(<ToolsPane />);
    expect(screen.getByRole('heading', { name: 'Parachute sizing' })).toBeTruthy();
    expect((screen.getByLabelText('Canopy diameter') as HTMLInputElement).value).toBe('60');
  });
});
