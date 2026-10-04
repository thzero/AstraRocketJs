import { useId, type KeyboardEvent } from 'react';

/**
 * The ARIA tabs pattern for a row of tab buttons and the one panel they switch.
 *
 * A tablist promises more than `aria-selected`: each tab names the panel it
 * controls, the panel names its tab, and the row is ONE tab stop that the arrow
 * keys move along (Home and End jump to the ends). Without those, a screen
 * reader announces tabs that lead nowhere and Tab walks every tab in turn.
 *
 * Selection follows focus: an arrow key opens the tab it lands on, which suits
 * panels that are cheap to show.
 *
 * Spread `tab(key)` on each tab button and `panel` on the element holding the
 * open tab's content.
 */
export function useTabs<K extends string>(keys: readonly K[], active: K, select: (key: K) => void) {
  const base = useId();
  const tabId = (key: K) => `${base}-tab-${key}`;
  const panelId = `${base}-panel`;

  const onKeyDown = (e: KeyboardEvent) => {
    const at = keys.indexOf(active);
    const next =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? keys[(at + 1) % keys.length]
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? keys[(at - 1 + keys.length) % keys.length]
          : e.key === 'Home'
            ? keys[0]
            : e.key === 'End'
              ? keys[keys.length - 1]
              : undefined;
    if (next === undefined) return;
    e.preventDefault();
    select(next);
    // Every tab is always rendered, so the target exists now, before the
    // re-render that marks it selected.
    document.getElementById(tabId(next))?.focus();
  };

  return {
    tab: (key: K) => ({
      role: 'tab' as const,
      id: tabId(key),
      'aria-selected': key === active,
      'aria-controls': panelId,
      tabIndex: key === active ? 0 : -1,
      onClick: () => select(key),
      onKeyDown,
    }),
    panel: { role: 'tabpanel' as const, id: panelId, 'aria-labelledby': tabId(active) },
  };
}
