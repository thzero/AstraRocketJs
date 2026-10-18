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
import { readSettings, renderWithProviders, seedSettings } from '../../testing/renderWithProviders';
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
  // The dialog assembles the report on mount only when `info` and `rocket` are both set.
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

    fireEvent.pointerDown(settingsBackdrop());
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
    const overlay = document.querySelector('.dialog-overlay')!;
    fireEvent.pointerDown(overlay);
    fireEvent.click(overlay);
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

    const overlay = document.querySelector('.dialog-overlay')!;
    fireEvent.pointerDown(overlay);
    fireEvent.click(overlay);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });
});

/**
 * Cancel and the close button end the export: the run the save is waiting on is
 * stopped, and nothing downloads once it settles.
 */
describe('ExportDialog cancel', () => {
  it.each(['Cancel', 'Close'])('%s stops the run and writes no PDF', async (name) => {
    let finish: (outcome: string) => void = () => {};
    const cancelRun = vi.fn();
    useWorkspaceStore.setState({
      runSim: () => new Promise<string>((resolve) => (finish = resolve)),
      cancelRun,
    } as never);
    const onClose = open();
    fireEvent.click(screen.getByRole('button', { name: 'Save as PDF' }));
    await screen.findByRole('button', { name: 'Loading…' });

    fireEvent.click(screen.getAllByRole('button', { name })[0]!);
    expect(onClose).toHaveBeenCalled();
    expect(cancelRun).toHaveBeenCalledTimes(1);

    // A run that lands anyway, after the close, still writes nothing.
    finish('landed');
    await screen.findByRole('button', { name: 'Save as PDF' });
    expect(downloadReportPdf).not.toHaveBeenCalled();
  });

  /**
   * The writer waits once more of its own, on the font fetch, after the dialog
   * has handed over. It asks `canceled` after that wait, so the hook has to read
   * the dialog's live state rather than be left out.
   */
  it('a close during the font fetch reaches the writer', async () => {
    let hooks: { canceled?: () => boolean } = {};
    let fontsLoaded: () => void = () => {};
    downloadReportPdf.mockImplementation(async (...args: unknown[]) => {
      hooks = (args[5] ?? {}) as typeof hooks;
      await new Promise<void>((resolve) => (fontsLoaded = resolve));
    });
    useWorkspaceStore.setState({ runSim: async () => 'landed' } as never);
    const onClose = open();
    fireEvent.click(screen.getByRole('button', { name: 'Save as PDF' }));
    await waitFor(() => expect(downloadReportPdf).toHaveBeenCalledTimes(1));
    expect(hooks.canceled?.()).toBe(false);

    fireEvent.click(screen.getAllByRole('button', { name: 'Cancel' })[0]!);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(hooks.canceled?.()).toBe(true);
    fontsLoaded();
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

/**
 * A flight dropped because the design changed under it writes nothing, and the
 * run itself says nothing about it, so the dialog does.
 */
describe('ExportDialog dropped run', () => {
  it('says why no PDF was written', async () => {
    useWorkspaceStore.setState({ runSim: async () => 'dropped', err: null } as never);
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Save as PDF' }));
    await waitFor(() => expect(useWorkspaceStore.getState().err).toMatch(/design changed/));
    expect(downloadReportPdf).not.toHaveBeenCalled();
  });
});

/** The popover's Reset covers what the popover shows, and not the report units. */
describe('ExportDialog print settings reset', () => {
  it('leaves the report units alone', () => {
    seedSettings({
      report: {
        units: 'metric',
        templateFill: '#ff0000',
        templateStroke: '#00ff00',
        paper: 'a4',
        orientation: 'landscape',
      },
    } as never);
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    const report = readSettings()['report'] as Record<string, string>;
    expect(report['units']).toBe('metric');
    expect(report['paper']).toBe('letter');
    expect(report['templateFill']).toBe('');
  });
});
