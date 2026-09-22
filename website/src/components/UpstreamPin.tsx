import type { ReactNode } from 'react';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';

/** The pinned OpenRocket commit, as docusaurus.config.ts read it out of
 *  engine-java/extract/UPSTREAM. */
type Pin = { ref: string; shortRef: string; date: string; commitUrl: string };

/**
 * WHICH OpenRocket this build is: the pinned commit, linked, with its date.
 * Renders inline, so a page can write it into a sentence in its own language:
 *
 *     ...is pinned to OpenRocket commit <UpstreamPin />.
 *     => ...is pinned to OpenRocket commit 98f05af97 (2026-09-21).
 *
 * The value comes from `engine-java/extract/UPSTREAM` at build time (see
 * customFields in docusaurus.config.ts). That is the only place the ref is
 * written down and the only file a version bump touches, which is the point:
 * a SHA typed into a page here and another typed into the app would be two more
 * copies to keep in step, and nothing would notice when they stopped being.
 */
export default function UpstreamPin(): ReactNode {
  const { siteConfig } = useDocusaurusContext();
  const pin = siteConfig.customFields?.upstream as Pin | undefined;
  if (!pin) return null;
  return (
    <>
      <a href={pin.commitUrl} target="_blank" rel="noreferrer">
        <code>{pin.shortRef}</code>
      </a>{' '}
      ({pin.date})
    </>
  );
}
