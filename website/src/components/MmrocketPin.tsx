import type { ReactNode } from 'react';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';

/** The mmrocket-sim release, as docusaurus.config.ts read it out of
 *  engine-java/extract/MMROCKET-SIM. */
type Pin = { ref: string; shortRef: string; version: string; date: string; repoUrl: string; commitUrl: string };

/**
 * The mmrocket-sim commit the RASAero-style extensions were last reviewed
 * against, linked, with its release version and date. Renders inline:
 *
 *     ...last reviewed against <MmrocketPin />.
 *     => ...last reviewed against v0.137 (4a9b8f7, 2026-09-21).
 *
 * Same rule as <UpstreamPin />: the value is read from the file that records it
 * rather than typed into the page, so the comparison appendix cannot come to
 * name a review that never happened. That file is where a reviewer writes the
 * new ref down, and it is the only place this exists.
 */
export default function MmrocketPin(): ReactNode {
  const { siteConfig } = useDocusaurusContext();
  const pin = siteConfig.customFields?.mmrocket as Pin | undefined;
  if (!pin) return null;
  return (
    <>
      v{pin.version} (
      <a href={pin.commitUrl} target="_blank" rel="noreferrer">
        <code>{pin.shortRef}</code>
      </a>
      , {pin.date})
    </>
  );
}
