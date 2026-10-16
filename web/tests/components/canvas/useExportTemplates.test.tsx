// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { useConfirmStore } from '../../../src/state/confirmStore';
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
afterEach(() => {
  setTemplateStore(original);
  useConfirmStore.setState({ request: null });
});

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

  const failing = (over: Partial<TemplateStore>): TemplateStore => ({
    list: async () => [{ id: 'mine', name: 'mine', ext: 'csv', source: 'x' }],
    add: async () => {},
    remove: async () => {},
    ...over,
  });

  it('reports a refused store write on import as a save failure, not a read failure', async () => {
    setTemplateStore(
      failing({
        add: async () => {
          throw new Error('refused');
        },
      }),
    );
    const { result } = renderHook(() => useExportTemplates());
    await act(() => result.current.onImport(new File(['{{t}}'], 'mine.csv.mustache')));
    expect(result.current.error).toBe('Could not save that template in this browser.');
  });

  it('reports a file that cannot be read as a read failure', async () => {
    setTemplateStore(failing({}));
    const { result } = renderHook(() => useExportTemplates());
    const file = new File(['x'], 'mine.csv.mustache');
    file.text = () => Promise.reject(new Error('unreadable'));
    file.arrayBuffer = () => Promise.reject(new Error('unreadable'));
    await act(() => result.current.onImport(file));
    expect(result.current.error).toBe('Could not read that template file.');
  });

  it('asks before deleting a template and keeps it on cancel', async () => {
    let removed = 0;
    setTemplateStore(failing({ remove: async () => void removed++ }));
    const { result } = renderHook(() => useExportTemplates());
    await act(async () => {});
    act(() => result.current.setSelected(`${USER_PREFIX}mine`));
    let done!: Promise<void>;
    act(() => {
      done = result.current.deleteSelected();
    });
    const request = useConfirmStore.getState().request;
    expect(request?.danger).toBe(true);
    await act(async () => {
      useConfirmStore.getState().settle(false);
      await done;
    });
    expect(removed).toBe(0);
  });

  it('reports a failed delete as a delete failure, not full storage', async () => {
    setTemplateStore(
      failing({
        remove: async () => {
          throw new Error('refused');
        },
      }),
    );
    const { result } = renderHook(() => useExportTemplates());
    await act(async () => {});
    act(() => result.current.setSelected(`${USER_PREFIX}mine`));
    let done!: Promise<void>;
    act(() => {
      done = result.current.deleteSelected();
    });
    await act(async () => {
      useConfirmStore.getState().settle(true);
      await done;
    });
    expect(result.current.error).toBe('Could not delete that template.');
  });
});
