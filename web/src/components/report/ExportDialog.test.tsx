// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState } from 'react';
import { fireEvent, screen } from '@testing-library/react';

// The real one drives the engine. This dialog's job is the SELECTION UI on top
// of it, so hand it a fixed model and assert on what the user can do with it.
const assembleReport = vi.hoisted(() => vi.fn());
vi.mock('../../services/reportModel', async (orig) => ({
  ...(await orig<typeof import('../../services/reportModel')>()),
  assembleReport,
}));

import { ExportDialog } from './ExportDialog';
import { renderWithProviders } from '../../testing/renderWithProviders';
import { useWorkspaceStore } from '../../state/store';
import type { ReportModel } from '../../services/reportModel';

const model = (): ReportModel =>
  ({
    name: 'Test Rocket',
    stages: [{ id: 's1', type: 'stage', name: 'Sustainer', children: [{ id: 'f1', type: 'trapezoidfinset' }] }],
    whole: {},
    stageSummaries: [{}],
    configs: [],
    partsByStage: [{ stage: 'Sustainer', rows: [] }],
    finSetsByStage: [{ stage: 'Sustainer', sets: [] }],
  }) as unknown as ReportModel;

beforeEach(() => {
  assembleReport.mockReset().mockReturnValue(model());
  useWorkspaceStore.getState().resetWorkspace();
  // `ready` is `!!info && !!rocket`; the dialog only assembles once both land.
  useWorkspaceStore.setState({ info: {}, rocket: {} } as never);
});

const open = () => {
  const onClose = vi.fn();
  renderWithProviders(<ExportDialog open onClose={onClose} />);
  return onClose;
};

/**
 * The dialog wired the way the app wires it: `onClose` actually closes it.
 * Needed for the selection test — the loss only shows once `open` goes false
 * and the once-per-open assemble latch resets.
 */
function Live() {
  const [isOpen, setOpen] = useState(true);
  return <ExportDialog open={isOpen} onClose={() => setOpen(false)} />;
}
const openLive = () => renderWithProviders(<Live />);

/** The print-settings popover's own panel, found by its heading. */
const settingsPopover = () =>
  screen.queryByRole('heading', { name: 'Print settings' })?.closest('[role="dialog"]') ?? null;
/** Its backdrop — the element whose click used to bubble into the dialog. */
const settingsBackdrop = () => settingsPopover()!.parentElement as HTMLElement;

describe('ExportDialog', () => {
  it('shows the assembled design and its per-stage checkboxes', () => {
    open();
    expect(screen.getByText('Test Rocket')).toBeTruthy();
    expect(screen.getByText('Sustainer')).toBeTruthy();
  });

  /**
   * The report-settings popover is rendered as a CHILD of the export dialog's
   * own full-screen overlay, and that overlay's onClick is `onClose`. So a
   * click on the popover's backdrop used to bubble into it and shut the whole
   * Export dialog — and since reopening resets the once-per-open assemble
   * latch, every include/exclude checkbox the user had set came back from
   * defaults. Adjusting a report setting silently discarded the selection.
   */
  it('dismissing the settings popover does not close the dialog behind it', () => {
    const onClose = open();

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    const pop = settingsPopover();
    expect(pop).toBeTruthy();

    fireEvent.click(settingsBackdrop());
    expect(settingsPopover()).toBeNull(); // the popover went away
    expect(onClose).not.toHaveBeenCalled(); // the dialog did not
    expect(screen.getByText('Test Rocket')).toBeTruthy();
  });

  it('keeps the selection across opening and dismissing the settings popover', () => {
    openLive();
    // Turn one stage's parts list off, then round-trip through the popover.
    const parts = screen.getByLabelText('Parts detail') as HTMLInputElement;
    fireEvent.click(parts);
    expect((screen.getByLabelText('Parts detail') as HTMLInputElement).checked).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    fireEvent.click(settingsBackdrop());

    expect((screen.getByLabelText('Parts detail') as HTMLInputElement).checked).toBe(false);
    // One assemble for the one open, not a second from a hidden reopen.
    expect(assembleReport).toHaveBeenCalledTimes(1);
  });

  it('closes on the overlay itself, and on Escape', () => {
    const onClose = open();
    fireEvent.click(document.querySelector('.dialog-overlay')!);
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
