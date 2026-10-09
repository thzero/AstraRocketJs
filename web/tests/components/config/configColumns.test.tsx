// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act, render } from '@testing-library/react';
import i18n from '../../../src/i18n';
import { recoveryColumns } from '../../../src/components/config/configColumns';
import { newFlightConfig } from '../../../src/services/flight/flightConfigs';
import type { RocketTree } from '../../../src/engine/openRocketEngine';
import type { FieldUnit } from '../../../src/prefs/useUnits';

const tree = {
  components: [
    {
      type: 'stage',
      id: 's1',
      children: [
        {
          type: 'bodytube',
          id: 'b1',
          children: [{ type: 'parachute', id: 'p1', name: 'Main', deployEvent: 'apogee', deployDelay: 0 }],
        },
      ],
    },
  ],
} as unknown as RocketTree;

const alt = () => ({ fmtSym: (v: number) => `${v} m` }) as unknown as FieldUnit;

const cell = (deployDelay: number) => {
  const config = { ...newFlightConfig(), deployments: { p1: { deployDelay } } };
  const [col] = recoveryColumns(tree, i18n.t.bind(i18n), alt);
  return render(<>{col!.cell(config)}</>).container;
};

afterEach(() => act(() => void i18n.changeLanguage('en')));

/**
 * A configuration's own value has to read as its own without color: the editor
 * card says so in words, and so must the table.
 */
describe('configuration table cells', () => {
  it('mark an override in words and with a mark, not by color alone', () => {
    const el = cell(1.5);
    expect(el.querySelector('.sr-only')?.textContent).toContain('Overridden');
    expect(el.querySelector('sup')?.textContent).toBe('*');
  });

  it('print a delay in the reader locale', async () => {
    await act(() => i18n.changeLanguage('de'));
    expect(cell(1.5).textContent).toContain('+1,5s');
  });
});
