import { test as base, expect, type Page } from '@playwright/test';

/** Mirrors `KEY` in src/services/settings.ts. */
const SETTINGS_KEY = 'astrarrocketjs:settings:v1';

export type WipState = 'acknowledged' | 'shown';

/**
 * The shared `test`, which arrives with the pre-1.0 work-in-progress notice
 * already out of the way.
 *
 * Every spec used to open with its own copy of
 *
 *     page.getByRole('button', { name: 'I understand' })
 *       .click({ timeout: 10_000 })
 *       .catch(() => {});
 *
 * — twenty definitions and seventy-six calls, each swallowing its own failure.
 * That `.catch` is why a slow boot never reported "the notice would not go
 * away": it reported, twenty steps later, that some unrelated click had been
 * intercepted by `div.fixed.inset-0.z-[60]`, which is the notice's backdrop.
 *
 * The notice is gated on a stored flag (WorkInProgressDialog.tsx:16), so this
 * sets the flag rather than racing the button, and e2e/wip-gate.spec.ts is now
 * the one place that exercises the gate itself. A spec that wants to SEE the
 * notice asks for it:
 *
 *     test.use({ wip: 'shown' });
 *
 * The seed MERGES into whatever is already stored, and has to keep doing so:
 * it runs on every navigation, `page.reload()` included, and a dozen specs
 * reload precisely to prove a preference survived. Overwriting the blob would
 * erase the thing they assert.
 */
export const test = base.extend<{ wip: WipState }>({
  wip: ['acknowledged', { option: true }],
  // `run`, not Playwright's usual `use`: eslint's react-hooks rule reads a bare
  // `use(...)` as the React hook and rejects it outside a component.
  page: async ({ page, wip }, run) => {
    if (wip === 'acknowledged') {
      await page.addInitScript((key: string) => {
        const stored = (): Record<string, unknown> => {
          try {
            return (JSON.parse(localStorage.getItem(key) || '{}') as Record<string, unknown>) ?? {};
          } catch {
            return {}; // a corrupt blob; the app discards it too, so start clean
          }
        };
        try {
          localStorage.setItem(key, JSON.stringify({ ...stored(), wipAcknowledged: true }));
        } catch {
          // An opaque origin (about:blank) has no usable storage. The real
          // navigation into the app runs this again, where it does.
        }
      }, SETTINGS_KEY);
    }
    await run(page);
  },
});

export { expect };
export type { Page } from '@playwright/test';

/**
 * A diagnostic that does NOT print on a green run.
 *
 * `console.log` in a spec lands in GitHub's annotation stream every time the
 * suite passes (playwright.config.ts uses the `github` reporter under CI), so
 * two dozen of them turned every successful run into a wall of numbers. A
 * Playwright annotation carries the same information into the report, where it
 * is there when you are reading a failure and invisible when you are not.
 */
export const note = (...parts: unknown[]): void => {
  test.info().annotations.push({
    type: 'note',
    description: parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' '),
  });
};

/**
 * Wait for the DEBOUNCED autosave to reach IndexedDB, rather than guessing.
 *
 * Several specs slept 700 ms before `page.reload()` to cover a 500 ms debounce
 * plus an async IndexedDB write. That is a guess at two variable delays, and on
 * a loaded machine it loses — which is how `recovery.spec.ts` failed twice in
 * one afternoon while passing in isolation. This polls the actual store, so it
 * returns as soon as the write lands and fails loudly if it never does.
 *
 * `needle` is matched against every stored value; `atLeast` counts occurrences,
 * so "two simulations" can be expressed as a per-simulation marker seen twice.
 */
export async function autosaved(page: Page, needle: string, atLeast = 1): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(
          (n) =>
            new Promise<number>((resolve) => {
              const req = indexedDB.open('astrarrocketjs');
              req.onerror = () => resolve(-1);
              req.onsuccess = () => {
                let tx;
                try {
                  tx = req.result.transaction('kv', 'readonly');
                } catch {
                  return resolve(-1); // store not created yet
                }
                const all = tx.objectStore('kv').getAll();
                all.onerror = () => resolve(-1);
                all.onsuccess = () =>
                  resolve(
                    all.result
                      .filter((v): v is string => typeof v === 'string')
                      .reduce((sum, v) => sum + v.split(n).length - 1, 0),
                  );
              };
            }),
          needle,
        ),
      { timeout: 15_000, message: `autosave never wrote ${atLeast}x ${needle}` },
    )
    .toBeGreaterThanOrEqual(atLeast);
}
