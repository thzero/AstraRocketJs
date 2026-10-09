// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useExportTemplates, USER_PREFIX } from '../../../src/components/canvas/useExportTemplates';
import {
  getTemplateStore,
  setTemplateStore,
  type TemplateStore,
  type UserTemplate,
} from '../../../src/services/exports/templateStore';

/**
 * The dialog's opening listing and an import race. An import that lands first
 * selects its template; the opening listing, resolving later without it, must
 * not take it away again.
 */
const original = getTemplateStore();
afterEach(() => setTemplateStore(original));

describe('useExportTemplates', () => {
  it('keeps an imported template when the opening listing resolves after it', async () => {
    const rows: UserTemplate[] = [];
    let releaseOpening!: (v: UserTemplate[]) => void;
    let calls = 0;
    const store: TemplateStore = {
      list: () => {
        calls++;
        // The first call is the opening listing, held until released, and it
        // answers with the store as it was before the import.
        if (calls === 1) return new Promise((r) => (releaseOpening = r));
        return Promise.resolve([...rows]);
      },
      add: async (tpl) => {
        rows.push(tpl);
      },
      remove: async () => {},
    };
    setTemplateStore(store);

    const { result } = renderHook(() => useExportTemplates());
    const file = new File(['{{#points}}{{t}}{{/points}}'], 'mine.csv.mustache');
    await act(() => result.current.onImport(file));
    expect(result.current.resolved.kind).toBe('user');

    await act(async () => releaseOpening([]));
    expect(result.current.templates.map((x) => x.id)).toHaveLength(1);
    expect(result.current.selected.startsWith(USER_PREFIX)).toBe(true);
    expect(result.current.resolved.kind).toBe('user');
  });
});
