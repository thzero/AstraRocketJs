/**
 * Drives the boot splash in index.html while the physics engine loads.
 *
 * The splash is plain markup so it paints before any JS; this module upgrades it
 * once the app's modules are evaluating. i18n is initialised by then — main.tsx
 * imports './i18n' statically, and ES module imports evaluate before the module
 * body runs — so everything here is translated. Only the initial string baked
 * into index.html is unavoidably English.
 *
 * Every lookup is defensive: the splash is markup React does not own, and a
 * missing node must never break boot.
 */
import i18n from './i18n';
import type { EngineLoadStatus } from './engine/openRocketEngine';

const MB = 1024 * 1024;
const mb = (bytes: number) => (bytes / MB).toFixed(1);

const cap = () => document.getElementById('boot-cap');
const bar = () => document.getElementById('boot-bar');
const setFill = (el: HTMLElement | null, width: string) => {
  const fill = el?.firstElementChild as HTMLElement | null;
  if (fill) fill.style.width = width;
};

/** Update the splash for one engine-load status. */
export function showEngineStatus(s: EngineLoadStatus): void {
  const c = cap();
  const b = bar();
  if (!c && !b) return; // React has already replaced the splash

  if (s.phase === 'starting') {
    if (c) c.textContent = i18n.t('boot.starting');
    // Compile/instantiate has no measurable progress. A full bar would claim the
    // work is finished, so sweep instead of sitting at 100%.
    b?.classList.add('indeterminate');
    setFill(b, '');
    return;
  }

  if (s.total) {
    const pct = Math.max(0, Math.min(100, Math.round((s.loaded / s.total) * 100)));
    if (c) c.textContent = i18n.t('boot.downloadingOf', { done: mb(s.loaded), total: mb(s.total) });
    b?.classList.remove('indeterminate');
    setFill(b, `${pct}%`);
    return;
  }

  // No content-length (chunked, or the JS-engine path where the bundler owns the
  // fetch): name the step and keep sweeping rather than invent a percentage.
  if (c) c.textContent = s.loaded > 0 ? i18n.t('boot.downloaded', { done: mb(s.loaded) }) : i18n.t('boot.downloading');
  b?.classList.add('indeterminate');
}

/** Report that no engine backend could be loaded. Boot continues regardless —
 *  main.tsx mounts in `.finally()` — so this shows only briefly. */
export function showEngineFailed(): void {
  const c = cap();
  if (c) c.textContent = i18n.t('boot.failed');
}
