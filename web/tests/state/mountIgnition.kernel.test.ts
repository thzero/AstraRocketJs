import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/engine/simClient', async (orig) => ({
  ...(await orig<typeof import('../../src/engine/simClient')>()),
  simulateInWorker: vi.fn(),
}));

import { __setEngineForTests, OpenRocketDesign } from '../../src/engine/openRocketEngine';
import { useWorkspaceStore } from '../../src/state/store';
import { findMounts } from '../../src/services/design/treeEdit';
import { buildConfiguredRocket } from '../../src/services/design/buildRocket';
import { loadEngine } from '../testing/kernelGeometry';
import { KERNEL_TEST_TIMEOUT_MS } from '../testing/kernelTimeout';

vi.setConfig({ testTimeout: KERNEL_TEST_TIMEOUT_MS, hookTimeout: KERNEL_TEST_TIMEOUT_MS });

/**
 * A mount's own ignition reaches the motors desktop would give it to, and flies.
 *
 * Desktop copies the mount's ignition (`getDefaultMotorConfig()`) into a motor
 * chosen for an empty slot (`MotorConfigurationPanel.selectMotor`:
 * `new MotorConfiguration(mount, fcid, mount.getMotorConfig(fcid))`). Here every
 * slot already holds a motor, so the expected ignition is the mount's as the
 * kernel holds it after the build (`getComponentFields`), and the flight is
 * compared with one where the kernel was handed that ignition directly.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- the TeaVM bundle is untyped */
let engine: any;
beforeAll(async () => {
  engine = await loadEngine();
  __setEngineForTests(engine);
});
/* eslint-enable @typescript-eslint/no-explicit-any */

const s = () => useWorkspaceStore.getState();
const mountId = () => findMounts(s().tree)[0]!.id as string;
const motorIn = (configId: string) => s().configs.find((c) => c.id === configId)!.motors[mountId()]!;

/** The mount's own ignition as the kernel holds it. */
function kernelMountIgnition(): { ignitionEvent: string; ignitionDelay: number } {
  engine.reset();
  const h = engine.buildRocket(JSON.stringify(s().tree));
  const f = JSON.parse(engine.getComponentFields(h, mountId())) as { ignitionEvent: string; ignitionDelay: number };
  return { ignitionEvent: f.ignitionEvent, ignitionDelay: f.ignitionDelay };
}

const ignitionTime = (events: { type: string; time: number }[]) => events.find((e) => e.type === 'IGNITION')!.time;

beforeEach(() => {
  s().resetWorkspace();
  s().setSelectedId(mountId());
});

describe('mount ignition, through the kernel', () => {
  it('flies an automatic ignition with a delay in a configuration made after it', () => {
    s().patchSelected({ ignitionEvent: 'automatic', ignitionDelay: 2 });
    s().commitEdit();
    s().addConfig();
    const config = s().configs.find((c) => c.id === s().selectedConfigId)!;
    // Read first: it resets the engine, which drops every design built before it.
    const { ignitionEvent, ignitionDelay } = kernelMountIgnition();
    const flown = buildConfiguredRocket(s().tree, config).simulate({ launchRodLength: 1, randomSeed: 7 });

    // The same motor, handed the mount's ignition directly.
    const direct = OpenRocketDesign.buildTree(s().tree);
    direct.setMotorById(mountId(), config.motors[mountId()]!.spec);
    direct.setMotorIgnitionById(mountId(), ignitionEvent as 'automatic', ignitionDelay);
    const expected = direct.simulate({ launchRodLength: 1, randomSeed: 7 });

    expect(ignitionDelay).toBe(2);
    expect(ignitionTime(flown.events)).toBe(ignitionTime(expected.events));
    expect(flown.summary.maxAltitude).toBe(expected.summary.maxAltitude);
  });

  it('carries a change to the mount into a motor still on its old ignition, and not into one set otherwise', () => {
    const first = s().configs[0]!.id;
    s().addConfig();
    const second = s().selectedConfigId!;
    s().setMountIgnition(second, mountId(), 'launch', 0.5);
    s().commitEdit();

    s().patchSelected({ ignitionEvent: 'burnout', ignitionDelay: 1 });
    s().commitEdit();
    expect(motorIn(first)).toMatchObject(kernelMountIgnition());
    expect(motorIn(second)).toMatchObject({ ignitionEvent: 'launch', ignitionDelay: 0.5 });
  });
});
