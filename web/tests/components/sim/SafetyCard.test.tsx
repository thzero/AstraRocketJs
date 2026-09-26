// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import { SimSummary } from '../../../src/components/sim/SimSummary';
import { ConfirmDialog } from '../../../src/components/common/ConfirmDialog';
import { useConfirmStore } from '../../../src/state/confirmStore';
import { renderWithProviders, readSettings, seedSettings } from '../../testing/renderWithProviders';
import type { FlightResult } from '../../../src/engine/openRocketEngine';

/**
 * The "Before you fly" card folds, and the fold sticks.
 *
 * Two rules it has to keep. The fold is GATED by an acknowledgment, because
 * the fold is remembered and that click is the last time the notes get asked
 * for on this browser. And the card never disappears: the heading and its ⚠
 * stay on screen in both states, so what folds away is the explanation.
 */

/** The card plus the app-wide modal it drives, which App mounts at the root. */
function panel() {
  return (
    <>
      <SimSummary sim={sim} />
      <ConfirmDialog />
    </>
  );
}

const head = () => screen.getByRole('button', { name: /Before you fly/ });

/** Click the heading and settle the acknowledgment the way the user would. */
async function fold(acknowledge: boolean) {
  fireEvent.click(head());
  fireEvent.click(screen.getByRole('button', { name: acknowledge ? 'I understand' : 'Cancel' }));
  // The toggle awaits the confirm promise, so the settings write lands a
  // microtask after the click.
  await act(async () => {});
}

const sim = {
  summary: {
    maxAltitude: 100,
    maxVelocity: 50,
    maxAcceleration: 100,
    maxMachNumber: 0.2,
    timeToApogee: 4,
    flightTime: 30,
    groundHitVelocity: 5,
    launchRodVelocity: 20,
    deploymentVelocity: null,
    optimumDelay: null,
  },
  events: [],
  series: { time: [0, 1], altitude: [0, 100], velocity: [0, 50], stability: [2, 2], cpLocation: [0.5, 0.5] },
} as unknown as FlightResult;

describe('SafetyCard folding', () => {
  // RTL's cleanup unmounts but leaves localStorage, and the fold is PERSISTED -
  // so without this each test would inherit the previous one's fold and the
  // toggles would run backwards.
  beforeEach(() => {
    localStorage.clear();
    // A request left open by a failed test would cancel the next one's.
    useConfirmStore.setState({ request: null });
  });

  it('starts unfolded, showing what the model never had', () => {
    renderWithProviders(panel());
    expect(screen.getByText('Not modeled at all')).toBeTruthy();
    expect(head().getAttribute('aria-expanded')).toBe('true');
  });

  it('asks for an acknowledgment before folding, rather than folding silently', () => {
    renderWithProviders(panel());
    fireEvent.click(head());
    expect(screen.getByRole('alertdialog', { name: 'Acknowledge the safety notes' })).toBeTruthy();
    // Still open behind the dialog: nothing has been folded yet.
    expect(screen.getByText('Not modeled at all')).toBeTruthy();
    expect(readSettings().showSafetyCard).toBeUndefined();
  });

  it('folds the body away once acknowledged, keeping the heading and its glyph', async () => {
    renderWithProviders(panel());
    await fold(true);
    expect(screen.queryByText('Not modeled at all')).toBeNull();
    // The caution is still on screen and still reads as a warning.
    expect(head().getAttribute('aria-expanded')).toBe('false');
    expect(head().textContent).toContain('⚠');
  });

  it('leaves it open when the acknowledgment is canceled', async () => {
    renderWithProviders(panel());
    await fold(false);
    expect(screen.getByText('Not modeled at all')).toBeTruthy();
    expect(head().getAttribute('aria-expanded')).toBe('true');
    expect(readSettings().showSafetyCard).toBeUndefined();
  });

  it('remembers the fold, so it does not spring open on the next tab change', async () => {
    renderWithProviders(panel());
    await fold(true);
    expect(readSettings().showSafetyCard).toBe(false);
  });

  it('needs no acknowledgment to open it back up', async () => {
    seedSettings({ showSafetyCard: false });
    renderWithProviders(panel());
    fireEvent.click(head());
    await act(async () => {});
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByText('Not modeled at all')).toBeTruthy();
  });

  it('honors a stored fold on mount', () => {
    seedSettings({ showSafetyCard: false });
    renderWithProviders(panel());
    expect(screen.queryByText('Not modeled at all')).toBeNull();
    expect(head()).toBeTruthy();
  });

  it('never removes the card entirely, whatever the setting says', () => {
    seedSettings({ showSafetyCard: false });
    renderWithProviders(panel());
    expect(screen.getByLabelText('Before you fly')).toBeTruthy();
  });
});
