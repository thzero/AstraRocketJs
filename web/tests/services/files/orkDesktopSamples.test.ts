// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { KERNEL_TEST_TIMEOUT_MS } from '../../testing/kernelTimeout';
import { serveData } from '../../testing/serveData';

vi.setConfig({ testTimeout: KERNEL_TEST_TIMEOUT_MS, hookTimeout: KERNEL_TEST_TIMEOUT_MS });

/**
 * The `.ork` and `.rkt` files the app saves, through the store's own save
 * paths, for the default design and every bundled example opened and saved
 * again.
 *
 * Each file is checked here for what this side can see. With ORK_SAMPLES_DIR
 * set, the files are also written there, so `npm run check:ork` can open them
 * in the pinned desktop OpenRocket: `npm run audit` in web does that, because only
 * the desktop can say whether it accepts what the writers emit. The desktop's
 * GeneralRocketLoader reads a RockSim file as well as its own.
 */

const saved = vi.hoisted(() => ({ archives: [] as Uint8Array[], rkt: [] as string[] }));
vi.mock('../../../src/services/files/saveOrk', async (orig) => {
  const real = await orig<typeof import('../../../src/services/files/saveOrk')>();
  return {
    ...real,
    downloadOrk: (input: Parameters<typeof real.orkArchive>[0]) => {
      saved.archives.push(real.orkArchive(input));
    },
    downloadRkt: async (...[name, tree]: Parameters<typeof real.downloadRkt>) => {
      const { exportRkt } = await import('../../../src/services/files/rktExport');
      const { xml, skipped } = exportRkt(name, tree);
      saved.rkt.push(xml);
      return skipped;
    },
  };
});

import { __setEngineForTests } from '../../../src/engine/openRocketEngine';
import { useWorkspaceStore } from '../../../src/state/store';

const EXAMPLES = join(__dirname, '../../../public/examples');
const OUT = process.env.ORK_SAMPLES_DIR;

/**
 * Left out of the desktop check: its nose cones carry part digests from the
 * OpenRocket 26 build that wrote the example, which the 24.12 release does not
 * have, so the desktop warns on the bundled file itself. The app keeps a
 * loaded part link as it found it.
 */
const DESKTOP_WARNS_ON_SOURCE = new Set(['pods-powered-with-recovery-deployment.ork']);

const s = () => useWorkspaceStore.getState();

/** Save the open design the way File > Save does, returning the archive. */
async function save(): Promise<Uint8Array> {
  saved.archives.length = 0;
  await s().saveOrk();
  expect(s().err).toBeNull();
  expect(saved.archives).toHaveLength(1);
  return saved.archives[0]!;
}

/** Save the open design the way File > Export > RockSim does, returning the XML. */
async function saveRkt(): Promise<string> {
  saved.rkt.length = 0;
  await s().saveRkt();
  expect(saved.rkt).toHaveLength(1);
  return saved.rkt[0]!;
}

function checkRkt(name: string, xml: string): void {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  expect(doc.querySelector('parsererror'), name).toBeNull();
  expect(doc.documentElement.tagName, name).toBe('RockSimDocument');
  if (OUT) writeFileSync(join(OUT, name), xml);
}

function check(name: string, archive: Uint8Array): void {
  const xml = strFromU8(unzipSync(archive)['rocket.ork']!);
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  expect(doc.querySelector('parsererror'), name).toBeNull();
  // A motor with no name is one the desktop looks up and reports missing.
  for (const d of doc.querySelectorAll('motormount > motor > designation')) {
    expect(d.textContent, name).not.toBe('');
  }
  if (OUT && !DESKTOP_WARNS_ON_SOURCE.has(name)) writeFileSync(join(OUT, name), archive);
}

beforeAll(async () => {
  /* eslint-disable @typescript-eslint/no-explicit-any -- the TeaVM bundle is untyped */
  (globalThis as any).$rt_putStdoutCustom ??= () => {};
  (globalThis as any).$rt_putStderrCustom ??= () => {};
  __setEngineForTests(await import('../../../src/engine/vendor/openrocket-engine.mjs' as string));
  /* eslint-enable @typescript-eslint/no-explicit-any */
  serveData();
  if (OUT) mkdirSync(OUT, { recursive: true });
});

describe('.ork files the app saves', () => {
  it('for the default design', async () => {
    s().resetWorkspace();
    expect(s().err).toBeNull();
    check('default-design.ork', await save());
    checkRkt('default-design.rkt', await saveRkt());
  });

  it.each(readdirSync(EXAMPLES).filter((f) => f.endsWith('.ork')))(
    'for the example %s, opened and saved',
    async (f) => {
      await s().openOrkFile(new Blob([readFileSync(join(EXAMPLES, f))]));
      expect(s().err).toBeNull();
      check(f, await save());
      checkRkt(f.replace(/\.ork$/, '.rkt'), await saveRkt());
    },
  );
});
