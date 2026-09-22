import type { ReactNode } from 'react';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';

/**
 * The app version these docs were built alongside, read from web/package.json
 * by docusaurus.config.ts (the same value the footer prints).
 *
 * The comparison appendix has to say which AstraRocketJs it compared, and a
 * version typed into three pages in two languages is six copies of a number
 * that changes on every release.
 */
export default function AppVersion(): ReactNode {
  const { siteConfig } = useDocusaurusContext();
  const version = siteConfig.customFields?.appVersion as string | undefined;
  return version ? <>v{version}</> : null;
}
