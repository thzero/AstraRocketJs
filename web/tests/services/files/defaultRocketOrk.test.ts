// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { useWorkspaceStore } from '../../../src/state/store';
import { exportOrk } from '../../../src/services/files/orkFile';
import { DEFAULT_PRESETS } from '../../../src/services/design/defaultRocket';

/**
 * What the default design actually writes into a `.ork`, read out of the file.
 *
 * The other tests here prove the writer round-trips a link it was handed. They
 * do not prove the design anybody opens writes one, which is the thing the
 * desktop either recognizes or does not. This asserts on the bytes.
 *
 * The digests are not typed here. They are read from the catalog, which is where
 * `npm run sync:preset-digests` puts OpenRocket's own, so this cannot drift into
 * asserting a number nothing else believes.
 */
type PartRow = { mfr: string; partNo: string; digest?: string };
const PARTS = (
  JSON.parse(readFileSync(resolve(process.cwd(), 'public/data/components.generated.json'), 'utf8')) as {
    components: PartRow[];
  }
).components;
const digestOf = (partNo: string) => PARTS.find((p) => p.mfr === 'Estes' && p.partNo === partNo)?.digest;

describe('the default design as a .ork', () => {
  const xml = () => exportOrk({ name: 'D', tree: useWorkspaceStore.getState().tree });

  it.each([
    ['NOSE_CONE', DEFAULT_PRESETS.nose.partNo],
    ['BODY_TUBE', DEFAULT_PRESETS.body.partNo],
    ['BODY_TUBE', DEFAULT_PRESETS.mount.partNo],
    ['CENTERING_RING', DEFAULT_PRESETS.ring.partNo],
    ['PARACHUTE', DEFAULT_PRESETS.chute.partNo],
  ])('names its %s as Estes %s, with the digest the desktop checks', (type, partNo) => {
    const digest = digestOf(partNo);
    expect(digest, `${partNo} has no digest in the catalog`).toBeTruthy();
    expect(xml()).toContain(`<preset type="${type}" manufacturer="Estes" partno="${partNo}" digest="${digest}"/>`);
  });

  it('writes a link for every part of the design that has one', () => {
    // Five parts, six elements: the two centering rings are the same catalog
    // part. A seventh link here means a part gained one; a missing one means a
    // digest was lost, which nothing else would report.
    expect(xml().match(/<preset /g)).toHaveLength(6);
  });
});
