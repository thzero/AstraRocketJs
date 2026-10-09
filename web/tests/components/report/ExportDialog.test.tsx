// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState } from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react';

// The real one drives the engine. This dialog's job is the selection UI on top
// of it, so hand it a fixed model and assert on what the user can do with it.
const assembleReport = vi.hoisted(() => vi.fn());
vi.mock('../../../src/services/report/reportModel', async (orig) => ({
  ...(await orig<typeof import('../../../src/services/report/reportModel')>()),
  assembleReport,
}));

const downloadReportPdf = vi.hoisted(() => vi.fn());
vi.mock('../../../src/services/report/reportPdf', () => ({ downloadReportPdf }));

import { ExportDialog } from '../../../src/components/report/ExportDialog';
import { renderWithProviders } from '../../testing/renderWithProviders';
import { useWorkspaceStore } from '../../../src/state/store';
import type { ReportModel } from '../../../src/services/report/reportModel';

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
  downloadReportPdf.mockReset();
  useWorkspaceStore.getState().resetWorkspace();
  // `ready` is `!!info && !!rocket`; the dialog only assembles once both land.
  useWorkspaceStore.setState({ info: {}, rocket: {} } as never);
});

const open = () => {
  const onClose = vi.fn();
  renderWithProviders(<ExportDialog onClose={onClose} />);
  return onClose;
};

/**
 * The dialog wired the way the app wires it: mounted only while open, and
 * `onClose` actually closes it. Needed for the selection test: the loss only
 * shows once the dialog really closes and reopens as a fresh instance.
 */
function Live() {
  const [isOpen, setOpen] = useState(true);
  return <>{isOpen && <ExportDialog onClose={() => setOpen(false)} />}</>;
}
const openLive = () => renderWithProviders(<Live />);

/** The print-settings popover's own panel, found by its heading. */
const settingsPopover = () =>
  screen.queryByRole('heading', { name: 'Print settings' })?.closest('[role="dialog"]') ?? null;
/** Its backdrop - the element whose click must not bubble into the dialog. */
const settingsBackdrop = () => settingsPopover()!.parentElement as HTMLElement;

describe('ExportDialog', () => {
  it('shows the assembled design and its per-stage checkboxes', () => {
    open();
    expect(screen.getByText('Test Rocket')).toBeTruthy();
    expect(screen.getByText('Sustainer')).toBeTruthy();
  });

  /**
   * The report-settings popover is rendered as a child of the export dialog's
   * own full-screen overlay, and that overlay's onClick is `onClose`. Left to
   * bubble, a click on the popover's backdrop shuts the whole Export dialog, and
   * since reopening resets the once-per-open assemble latch, every include/exclude
   * checkbox comes back from defaults, so adjusting a report setting discards the
   * selection.
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

  /**
   * Escape dismisses the topmost surface. Gated only on `open`, it would close
   * the whole dialog from inside the popover, and reopening resets the
   * once-per-open assemble latch, so every include/exclude checkbox would come
   * back from defaults. That is the same loss the popover's backdrop handler
   * guards against for the click path.
   *
   * The popover has to be open when Escape is pressed, or the test passes either
   * way.
   */
  it('Escape closes the settings popover, not the dialog behind it', () => {
    const onClose = open();
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(settingsPopover()).toBeTruthy();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(settingsPopover()).toBeNull(); // the popover went away
    expect(onClose).not.toHaveBeenCalled(); // the dialog did not

    // A second Escape, now that it is the topmost surface, does close it.
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps the selection when the popover is dismissed with Escape', () => {
    openLive();
    const parts = screen.getByLabelText('Parts detail') as HTMLInputElement;
    fireEvent.click(parts);

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    fireEvent.keyDown(window, { key: 'Escape' });

    expect((screen.getByLabelText('Parts detail') as HTMLInputElement).checked).toBe(false);
    expect(assembleReport).toHaveBeenCalledTimes(1);
  });

  /**
   * The popover is a sibling of the trapped panel, so a trap anchored on the
   * panel cannot reach its controls: with it open, Tab would go on cycling the
   * dialog behind it and the fill color, paper size and orientation would be
   * unreachable by keyboard.
   */
  it('moves the focus trap to the popover while it is open', () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    const pop = settingsPopover()!;
    // The trap focuses the topmost surface's first focusable child.
    expect(pop.contains(document.activeElement)).toBe(true);
  });

  it('closes on the overlay itself, and on Escape', () => {
    const onClose = open();
    fireEvent.click(document.querySelector('.dialog-overlay')!);
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  /**
   * "Update simulation data" runs the simulation first. Swallowing a failed run
   * would write the PDF from the previous run's numbers with nothing on the page
   * to say so. The user asked for fresh data: say why there is none, and write
   * nothing.
   */
  it('reports a failed simulation and writes no PDF', async () => {
    useWorkspaceStore.setState({ runSim: async () => Promise.reject(new Error('kernel choked')) } as never);
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Save as PDF' }));
    await waitFor(() => expect(useWorkspaceStore.getState().err).toContain('kernel choked'));
    expect(downloadReportPdf).not.toHaveBeenCalled();
  });

  // The run resolves on a timeout, a refusal or a cancel rather than rejecting,
  // with the previous numbers still in place.
  it.each(['failed', 'skipped', 'canceled', 'dropped', 'busy'])(
    'writes no PDF when the simulation comes back %s',
    async (outcome) => {
      useWorkspaceStore.setState({ runSim: async () => outcome } as never);
      open();
      fireEvent.click(screen.getByRole('button', { name: 'Save as PDF' }));
      // Busy until the save settles, so the button reads "Save as PDF" again only then.
      await screen.findByRole('button', { name: 'Save as PDF' });
      expect(downloadReportPdf).not.toHaveBeenCalled();
    },
  );

  it('writes the PDF once the simulation has landed', async () => {
    useWorkspaceStore.setState({ runSim: async () => 'landed' } as never);
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Save as PDF' }));
    await waitFor(() => expect(downloadReportPdf).toHaveBeenCalledTimes(1));
  });

  it('does not close on the overlay or Escape while the export is running', async () => {
    // A run that never finishes keeps the dialog busy for the whole test.
    useWorkspaceStore.setState({ runSim: () => new Promise<void>(() => {}) } as never);
    const onClose = open();
    fireEvent.click(screen.getByRole('button', { name: 'Save as PDF' }));
    await screen.findByRole('button', { name: 'Loading…' });

    fireEvent.click(document.querySelector('.dialog-overlay')!);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });
});

/**
 * The report's background run must leave the workbench where it was: the run
 * itself moves the view to Flight and the tab to Results.
 */
describe('ExportDialog background run', () => {
  it('puts the view, the tab and the design pane back after the run', async () => {
    useWorkspaceStore.setState({ view: '3d', tab: 'design', designPane: 'stats' } as never);
    useWorkspaceStore.setState({
      runSim: async () => {
        useWorkspaceStore.setState({ view: 'flight', tab: 'results' } as never);
        return 'landed';
      },
    } as never);
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Save as PDF' }));
    await waitFor(() => expect(downloadReportPdf).toHaveBeenCalledTimes(1));
    const s = useWorkspaceStore.getState();
    expect([s.view, s.tab, s.designPane]).toEqual(['3d', 'design', 'stats']);
  });
});

/** A label binds to one control: the fill checkbox and its color are two. */
describe('ExportDialog print settings labels', () => {
  it('names the fill color input and keeps the fill label on the checkbox alone', () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    const fill = screen.getByRole('checkbox', { name: 'Template fill color' });
    expect(fill.closest('label')).toBeNull();
    expect(screen.getByLabelText('Choose the fill color').getAttribute('type')).toBe('color');
  });
});
