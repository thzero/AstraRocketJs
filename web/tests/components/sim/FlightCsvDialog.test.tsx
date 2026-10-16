// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { FlightCsvDialog } from '../../../src/components/sim/FlightCsvDialog';
import * as saveFile from '../../../src/services/files/saveFile';
import { renderWithProviders, seedSettings } from '../../testing/renderWithProviders';
import type { FlightResult } from '../../../src/engine/openRocketEngine';

const flight = {
  summary: {},
  events: [],
  series: { time: [0, 1], altitude: [0, 10] },
} as unknown as FlightResult;

/** The data rows of the exported file: every line that is not a comment. */
function exportedRows(): string[] {
  const spy = vi.spyOn(saveFile, 'download').mockImplementation(() => {});
  fireEvent.click(screen.getByRole('button', { name: 'Export' }));
  const csv = spy.mock.calls[0]![1] as string;
  return csv.split('\n').filter((l) => l && !l.startsWith('#'));
}

/**
 * The Tab separator writes a real tab character. A JSX attribute string does not
 * process escapes, so `value="\t"` is a backslash and a `t`, and a spreadsheet
 * opens such a file as a single column.
 */
describe('FlightCsvDialog separator', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  const settings = (separator: string) =>
    seedSettings({
      flightCsv: {
        columns: ['time', 'altitude'],
        separator,
        simDescription: false,
        fieldDescriptions: false,
        flightEvents: false,
      },
    });

  it('separates values with a tab character when Tab is chosen', () => {
    settings(',');
    renderWithProviders(<FlightCsvDialog result={flight} simName="Sim" onClose={() => {}} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Field separator' }), { target: { value: '\t' } });
    const rows = exportedRows();
    expect(rows.length).toBeGreaterThan(1);
    for (const row of rows) {
      expect(row.split('\t')).toHaveLength(2);
      expect(row).not.toContain('\\t');
    }
  });

  it('reads a stored backslash-t as the tab character', () => {
    settings('\\t');
    renderWithProviders(<FlightCsvDialog result={flight} simName="Sim" onClose={() => {}} />);
    expect((screen.getByRole('combobox', { name: 'Field separator' }) as HTMLSelectElement).value).toBe('\t');
    for (const row of exportedRows()) expect(row.split('\t')).toHaveLength(2);
  });
});

/**
 * Emptying the comment box is a step on the way to another character. The "#"
 * fallback waits until the field is left, or Backspace then "%" reads "#%".
 */
describe('FlightCsvDialog comment character', () => {
  afterEach(() => localStorage.clear());

  const box = () => screen.getByRole('textbox', { name: 'Comment character' }) as HTMLInputElement;

  it('takes a replacement typed into an emptied box as it is', () => {
    renderWithProviders(<FlightCsvDialog result={flight} simName="Sim" onClose={() => {}} />);
    fireEvent.focus(box());
    fireEvent.change(box(), { target: { value: '' } });
    expect(box().value).toBe('');
    fireEvent.change(box(), { target: { value: '%' } });
    fireEvent.blur(box());
    expect(box().value).toBe('%');
  });

  it('falls back to "#" when the box is left empty', () => {
    renderWithProviders(<FlightCsvDialog result={flight} simName="Sim" onClose={() => {}} />);
    fireEvent.change(box(), { target: { value: ';' } });
    fireEvent.change(box(), { target: { value: '' } });
    fireEvent.blur(box());
    expect(box().value).toBe('#');
  });
});
