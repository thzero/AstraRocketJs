// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { useState } from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { useTabs } from '../../../src/components/common/useTabs';

afterEach(cleanup);

const KEYS = ['one', 'two', 'three'] as const;

function Tabs() {
  const [tab, setTab] = useState<(typeof KEYS)[number]>('one');
  const tabs = useTabs(KEYS, tab, setTab);
  return (
    <>
      <div role="tablist">
        {KEYS.map((k) => (
          <button key={k} {...tabs.tab(k)}>
            {k}
          </button>
        ))}
      </div>
      <div {...tabs.panel}>panel {tab}</div>
    </>
  );
}

const tab = (name: string) => screen.getByRole('tab', { name });

describe('useTabs', () => {
  it('ties each tab to the panel, and the panel to the open tab', () => {
    render(<Tabs />);
    const panel = screen.getByRole('tabpanel');
    for (const k of KEYS) expect(tab(k).getAttribute('aria-controls')).toBe(panel.id);
    expect(panel.getAttribute('aria-labelledby')).toBe(tab('one').id);
    fireEvent.click(tab('two'));
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(tab('two').id);
  });

  it('makes the row one tab stop: only the open tab is in the Tab order', () => {
    render(<Tabs />);
    expect(KEYS.map((k) => tab(k).tabIndex)).toEqual([0, -1, -1]);
  });

  it('moves along the row with the arrow keys, wrapping, and opens what it lands on', () => {
    render(<Tabs />);
    tab('one').focus();
    fireEvent.keyDown(tab('one'), { key: 'ArrowRight' });
    expect(document.activeElement).toBe(tab('two'));
    expect(tab('two').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tabpanel').textContent).toBe('panel two');
    fireEvent.keyDown(tab('two'), { key: 'ArrowLeft' });
    fireEvent.keyDown(tab('one'), { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(tab('three'));
  });

  it('jumps to the ends with Home and End, and ignores other keys', () => {
    render(<Tabs />);
    fireEvent.keyDown(tab('one'), { key: 'End' });
    expect(document.activeElement).toBe(tab('three'));
    fireEvent.keyDown(tab('three'), { key: 'Home' });
    expect(document.activeElement).toBe(tab('one'));
    fireEvent.keyDown(tab('one'), { key: 'a' });
    expect(tab('one').getAttribute('aria-selected')).toBe('true');
  });
});
