import AxeBuilder from '@axe-core/playwright';
import type { Page } from './base';
import type { Theme } from '../src/services/app/theme';

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
