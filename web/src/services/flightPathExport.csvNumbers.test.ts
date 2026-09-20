import { describe, it, expect } from 'vitest';
import { renderUserTemplate, type FlightPathModel } from './flightPathExport';

/**
 * The CSV escaper guards against spreadsheet formula injection by prefixing
 * `'` to any value that starts with `= + - @`. The pre-formatted numeric
 * fields go through the same escaper, so every western-hemisphere longitude
 * and every below-pad altitude came out as `'-80.600000`: text, not a number,
 * in every spreadsheet and in GPS Visualizer. The only CSV test used positive
 * coordinates.
 */
describe('CSV escaper and negative numbers', () => {
  const m = { title: '' } as unknown as FlightPathModel;
  const csv = (title: string) => renderUserTemplate('{{title}}', 'csv', { ...m, title });

  it('leaves a negative number alone', () => {
    expect(csv('-80.600000')).toBe('-80.600000');
    expect(csv('-3')).toBe('-3');
    expect(csv('-.5')).toBe('-.5');
  });

  it('still neutralizes the formula triggers', () => {
    expect(csv('=HYPERLINK("x")')).toBe(`'=HYPERLINK(""x"")`);
    expect(csv('+1+1')).toBe(`'+1+1`);
    expect(csv('@SUM(A1)')).toBe(`'@SUM(A1)`);
    expect(csv('\tcmd')).toBe(`'\tcmd`);
  });

  it('a minus that does not lead a number is still a trigger', () => {
    expect(csv('-cmd|calc')).toBe(`'-cmd|calc`);
    expect(csv('- 1')).toBe(`'- 1`);
  });
});
