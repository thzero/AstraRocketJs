import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from './base';
import type { Theme } from '../src/services/app/theme';
import type { AeroPane, ConfigsTab, Tool, TwoDView, ViewMode } from '../src/state/tabs';

/** Every applied theme, keyed by the app's own type so a new one is scanned too. */
const THEME_SET: Record<Theme, true> = { dark: true, light: true, daylight: true };
export const THEMES = Object.keys(THEME_SET) as Theme[];

/** What axe found on the page as it is, one line per element, WCAG 2.1 A and AA. */
export async function axeViolations(page: Page, where: string): Promise<string[]> {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  return result.violations.flatMap((v) =>
    v.nodes.map((n) => {
      const colors = n.any[0]?.data as { fgColor?: string; bgColor?: string; contrastRatio?: number } | undefined;
      const detail = colors?.contrastRatio
        ? ` (${colors.fgColor} on ${colors.bgColor}, ${colors.contrastRatio}:1)`
        : '';
      return `${where}: ${v.id}${detail} at ${n.target.join(' ')}`;
    }),
  );
}

/*
 * The names of the views both axe specs press, keyed by the type the app
 * switches on. A view the app gains is a new member of one of these unions, and
 * a record that lacks it fails the typecheck rather than leaving a gap in the
 * scan.
 */

export const VIEW: Record<ViewMode, string> = {
  '2d': '2D',
  '3d': '3D',
  drag: 'Aero',
  flight: 'Flight',
  path: '3D path',
  ground: 'Ground track',
  environment: 'Environment',
};
export const TWO_D: Record<TwoDView, string> = { side: 'Side', aft: 'Aft' };
export const AERO_PANE: Record<AeroPane, string> = { charts: 'Charts', components: 'Per component' };
export const CONFIGS: Record<ConfigsTab, string> = { motors: 'Motors', recovery: 'Recovery', separation: 'Staging' };
export const TOOL: Record<Tool, string> = {
  landing: 'Landing estimator',
  rail: 'Off the rail',
  chute: 'Parachute sizing',
};

/** Press a toggle button by its exact name and wait for it to report pressed. */
export async function press(page: Page, name: string): Promise<void> {
  const toggle = page.getByRole('button', { name, exact: true });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
}

/**
 * Wait for the Aero view's sweep to draw its charts, so axe reads them rather
 * than "Computing…". The sweep runs in the engine and can outlast the default
 * expect timeout on a busy worker.
 */
export async function aeroChartsDrawn(page: Page): Promise<void> {
  await expect(page.getByRole('img', { name: /peak .* at Mach/ }).first()).toBeVisible({ timeout: 20_000 });
}
