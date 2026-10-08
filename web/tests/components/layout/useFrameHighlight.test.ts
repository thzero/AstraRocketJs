// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useFrameHighlight } from '../../../src/components/layout/useFrameHighlight';
import type { HelpTarget } from '../../../src/services/app/helpDocs';

/**
 * The docs page can re-render its article after the frame has loaded; the
 * words a search found stay marked through that.
 */
const frame = () => ({ current: { contentDocument: document } as unknown as HTMLIFrameElement });
const marks = () => document.querySelectorAll('article mark[data-astra-help-mark]').length;
const target = { src: '/docs/motors', hash: '' } as HelpTarget;
const words = ['ejection'];

afterEach(() => {
  document.body.innerHTML = '';
});

describe('useFrameHighlight', () => {
  it('marks the words, and marks them again after the article is replaced', async () => {
    Element.prototype.scrollIntoView = () => {};
    document.body.innerHTML = '<main><article><p>Set the ejection delay.</p></article></main>';
    const { unmount } = renderHook(() => useFrameHighlight(frame(), true, words, target));
    expect(marks()).toBe(1);

    document.querySelector('main')!.innerHTML = '<article><p>Set the ejection delay here.</p></article>';
    await waitFor(() => expect(marks()).toBe(1));

    unmount();
    expect(marks()).toBe(0);
    expect(document.querySelector('article')!.textContent).toBe('Set the ejection delay here.');
  });

  it('marks the words when the article arrives after the frame is ready', async () => {
    Element.prototype.scrollIntoView = () => {};
    // The docs site can render its article after the load event: nothing to
    // mark yet, and the hook has to wait for it rather than give up.
    document.body.innerHTML = '<main></main>';
    renderHook(() => useFrameHighlight(frame(), true, words, target));
    expect(marks()).toBe(0);
    document.querySelector('main')!.innerHTML = '<article><p>Set the ejection delay.</p></article>';
    await waitFor(() => expect(marks()).toBe(1));
  });

  it('does nothing before the frame is ready', () => {
    document.body.innerHTML = '<article><p>Set the ejection delay.</p></article>';
    renderHook(() => useFrameHighlight(frame(), false, words, target));
    expect(marks()).toBe(0);
  });
});
