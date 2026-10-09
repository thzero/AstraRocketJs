// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useHelpFrame } from '../../../src/components/layout/useHelpFrame';
import { helpTarget } from '../../../src/services/app/helpDocs';

/**
 * The docs frame takes the app's theme. Docusaurus has light and dark only, so
 * daylight maps to light.
 */
describe('useHelpFrame theme', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('data-theme');
    document.body.innerHTML = '';
  });

  it.each([
    ['dark', 'dark'],
    ['light', 'light'],
    ['daylight', 'light'],
  ])('shows the docs %s app theme as %s', (app, docs) => {
    document.documentElement.setAttribute('data-theme', app);
    const frame = document.createElement('iframe');
    document.body.appendChild(frame);
    const { result } = renderHook(() => useHelpFrame(helpTarget('index', 'en'), 'en', () => {}));
    (result.current.frameRef as { current: HTMLIFrameElement | null }).current = frame;
    result.current.onFrameLoad();
    const html = frame.contentDocument!.documentElement;
    expect(html.getAttribute('data-theme')).toBe(docs);
    expect(html.getAttribute('data-theme-choice')).toBe(docs);
  });
});
