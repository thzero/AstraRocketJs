// @vitest-environment jsdom
// cspell:ignore randomseed recoveryspeedwarning droguelowspeedwarning Lowspeedwarning recoverydroguemainhighspeedwarning recoverydroguemainlowspeedwarning Allumage -- OpenRocket .ork element names, and a French extension name
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { unzipSync } from 'fflate';
import { exportOrk, importOrk } from '../../../src/services/files/orkFile';
import { wireLoadedOrk } from '../../../src/services/files/wireLoadedOrk';
import { defaultRocketTree } from '../../../src/services/design/defaultRocket';
import { isOutdated, simStatus, type SimPrefs } from '../../../src/services/flight/simulations';
import type { FlightSummary } from '../../../src/engine/openRocketEngine';
import type { LaunchConditions } from '../../../src/services/design/orkTree';
import type { LoadedOrk } from '../../../src/services/files/loadOrk';
import type { OrkExportSimulation } from '../../../src/services/files/orkTypes';
import { noteTexts } from '../../testing/importNotes';
import i18n from '../../../src/i18n';

/**
 * Every simulation, with its result summary, through a .ork and back.
 *
 * The file is the desktop's: one <simulation> each, the summary as attributes
 * of <flightdata>, and the status the desktop's loader reads (any summary loads
 * as LOADED unless the status says outdated). `npm run check:ork` opens a file
 * like this in a real OpenRocket; these pin the shape on this side.
 */

const tree = defaultRocketTree();
const configs = [
  { id: 'cfg-c6', name: 'C6', motors: {} },
  { id: 'cfg-d12', name: 'D12', motors: {} },
];
const launch = { launchRodLengthM: 1, launchRodAngleDeg: 0, windAverage: 2, launchAltitudeM: 1400 } as LaunchConditions;
const summary: FlightSummary = {
  maxAltitude: 333.5,
  maxVelocity: 114,
  maxAcceleration: 229,
  maxMachNumber: 0.34,
  timeToApogee: 6.9,
  flightTime: 101.2,
  groundHitVelocity: 3.5,
  launchRodVelocity: 18.1,
  deploymentVelocity: 0.4,
  optimumDelay: null,
};

const write = (simulations: OrkExportSimulation[]) =>
  exportOrk({ name: 'Sims', tree, configs, activeConfigId: 'cfg-c6', launch, simulations });

describe('writing every simulation', () => {
  const xml = write([
    { name: 'Calm day', configId: 'cfg-c6', launch, summary, status: 'uptodate' },
    { name: 'Old run', configId: 'cfg-d12', launch: { ...launch, windAverage: 6 }, summary, status: 'outdated' },
    { name: 'Not flown', configId: 'cfg-d12', launch, status: 'notsimulated' },
  ]);

  it('writes one <simulation> each, in order, with its own configuration', () => {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const sims = [...doc.querySelectorAll('simulations > simulation')];
    expect(sims.map((s) => s.querySelector('name')!.textContent)).toEqual(['Calm day', 'Old run', 'Not flown']);
    expect(sims.map((s) => s.querySelector('conditions > configid')!.textContent)).toEqual([
      'cfg-c6',
      'cfg-d12',
      'cfg-d12',
    ]);
    expect(sims.map((s) => s.getAttribute('status'))).toEqual(['uptodate', 'outdated', 'notsimulated']);
  });

  it('writes the summary as the desktop does, leaving out a figure it does not have', () => {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const [first, , last] = [...doc.querySelectorAll('simulations > simulation')];
    const fd = first!.querySelector(':scope > flightdata')!;
    expect(fd.getAttribute('maxaltitude')).toBe('333.5');
    expect(fd.getAttribute('launchrodvelocity')).toBe('18.1');
    expect(fd.hasAttribute('optimumdelay')).toBe(false);
    // A simulation that never ran carries no summary at all.
    expect(last!.querySelector(':scope > flightdata')).toBeNull();
  });

  it('points a simulation at the default configuration when its own is not in the file', () => {
    const doc = new DOMParser().parseFromString(
      write([{ name: 'Orphan', configId: 'gone', launch, status: 'notsimulated' }]),
      'application/xml',
    );
    expect(doc.querySelector('simulation > conditions > configid')!.textContent).toBe('cfg-c6');
  });
});

describe('reading them back', () => {
  it('keeps each name, configuration, launch and summary', () => {
    const res = importOrk(
      write([
        { name: 'Calm day', configId: 'cfg-c6', launch, summary, status: 'uptodate' },
        { name: 'Windy', configId: 'cfg-d12', launch: { ...launch, windAverage: 6 }, summary, status: 'outdated' },
        { name: 'Not flown', configId: 'cfg-d12', launch, status: 'notsimulated' },
      ]),
    );
    const sims = res.simulations!;
    expect(sims.map((s) => [s.name, s.configId, s.outdated])).toEqual([
      ['Calm day', 'cfg-c6', false],
      ['Windy', 'cfg-d12', true],
      ['Not flown', 'cfg-d12', false],
    ]);
    expect(sims[1]!.launch?.windAverage).toBe(6);
    expect(sims[0]!.summary).toEqual(summary);
    expect(sims[2]!.summary).toBeUndefined();
  });

  it('reads an empty summary attribute as missing, not as zero', () => {
    const xml = write([{ name: 'Calm day', configId: 'cfg-c6', launch, summary, status: 'uptodate' }]).replace(
      'maxaltitude="333.5"',
      'maxaltitude=""',
    );
    expect(xml).toContain('maxaltitude=""');
    expect(importOrk(xml).simulations![0]!.summary!.maxAltitude).toBeNaN();
  });
});

describe('opening a file with simulations', () => {
  const prefs = { timeStep: 0.05 } as SimPrefs;
  const fileSims = importOrk(
    write([
      { name: 'Calm day', configId: 'cfg-c6', launch, summary, status: 'uptodate' },
      { name: 'Windy', configId: 'cfg-d12', launch, summary, status: 'outdated' },
    ]),
  ).simulations;
  const loaded = {
    name: 'Sims',
    notes: [],
    tree,
    motors: {},
    configs: configs.map((c) => ({ ...c, motors: {} })),
    chosenConfigId: 'cfg-d12',
    simulations: fileSims,
  } as unknown as LoadedOrk;

  it('makes one simulation per file simulation, opening on the default configuration', () => {
    const w = wireLoadedOrk(loaded, launch, prefs);
    expect(w.sims.map((s) => [s.name, s.configId])).toEqual([
      ['Calm day', 'cfg-c6'],
      ['Windy', 'cfg-d12'],
    ]);
    expect(w.activeId).toBe(w.sims[1]!.id);
  });

  it('shows a current summary as from the file, and ages it like a result', () => {
    const w = wireLoadedOrk(loaded, launch, prefs);
    const [calm, windy] = w.sims;
    const cfg = (id: string) => w.configs.find((c) => c.id === id)!;
    const status = (s: typeof calm) => simStatus(s!, {}, w.tree, isOutdated(s!, w.tree, cfg(s!.configId), prefs));
    expect(calm!.fileSummary?.summary.maxAltitude).toBe(333.5);
    expect(status(calm)).toBe('fromFile');
    // The file itself said this one was out of date.
    expect(status(windy)).toBe('outdated');
    // Any edit to what it flies makes the file's figures stale.
    expect(status({ ...calm!, launch: { ...calm!.launch, windAverage: 9 } })).toBe('outdated');
  });

  it('falls back to one simulation per configuration for a file with none', () => {
    const w = wireLoadedOrk({ ...loaded, simulations: undefined }, launch, prefs);
    expect(w.sims.map((s) => s.configId)).toEqual(['cfg-c6', 'cfg-d12']);
    expect(w.sims.every((s) => !s.fileSummary)).toBe(true);
  });
});

/**
 * Desktop simulation extensions (air-start, roll control, scripts) cannot run
 * here, but a design opened and saved here must not lose them: the file goes
 * back to desktop with them intact, and the import says they were not run.
 * Read from desktop's own example file.
 */
describe('desktop simulation extensions', () => {
  const example = readFileSync(resolve(__dirname, '../../../public/examples/simulation-extensions.ork'));
  const res = importOrk(example.buffer.slice(example.byteOffset, example.byteOffset + example.byteLength));
  const carried = res.simulations!.flatMap((s) => s.xmlExtra ?? []);

  it('reads every extension as raw XML, and says they are not run', () => {
    expect(carried.filter((x) => x.startsWith('<extension ')).length).toBe(3);
    expect(noteTexts(res.notes).some((n) => /Simulation extensions are not run here/.test(n))).toBe(true);
  });

  it('names them as desktop does, and an unknown id as it stands', () => {
    const note = noteTexts(res.notes).find((n) => /Simulation extensions are not run here/.test(n))!;
    expect(note).toContain('Air-start');
    expect(note).not.toMatch(/AirStart|RollControl/);
    // An id from the file that names an Object.prototype member reads as itself.
    const odd = importOrk(
      new TextDecoder()
        .decode(Object.values(unzipSync(new Uint8Array(example)))[0])
        .replace(/extensionid="[^"]*"/, 'extensionid="constructor"'),
    );
    expect(noteTexts(odd.notes).join(' ')).toContain('constructor');
    expect(noteTexts(odd.notes).join(' ')).not.toContain('native code');
  });

  it('translates the names desktop translates, and names a script by its language', async () => {
    const xml = new TextDecoder()
      .decode(Object.values(unzipSync(new Uint8Array(example)))[0])
      .replace(
        /<extension extensionid="[^"]*RollControl">[\s\S]*?<\/extension>/,
        '<extension extensionid="info.openrocket.core.simulation.extension.impl.ScriptingExtension"><entry key="language" type="string">Python</entry></extension>',
      );
    await i18n.changeLanguage('fr');
    try {
      const note = noteTexts(importOrk(xml).notes).join(' ');
      expect(note).toContain('Allumage en vol');
      expect(note).toContain('Script Python');
      expect(note).not.toContain('Air-start');
    } finally {
      await i18n.changeLanguage('en');
    }
  });

  it('keeps them on the simulations it opens, with or without a saved result', () => {
    const loaded = {
      ...res,
      motors: {},
      configs: configs.map((c) => ({ ...c, motors: {} })),
      chosenConfigId: 'cfg-c6',
    } as unknown as LoadedOrk;
    const w = wireLoadedOrk(loaded, launch, { timeStep: 0.05 } as SimPrefs);
    expect(w.sims.flatMap((s) => s.xmlExtra ?? [])).toEqual(carried);
  });

  it('writes them back unchanged, after the conditions and before the flight data', () => {
    const xml = write([
      { name: 'With extension', configId: 'cfg-c6', launch, summary, status: 'uptodate', xmlExtra: carried },
    ]);
    for (const raw of carried) expect(xml).toContain(raw);
    const at = xml.indexOf(carried[0]!);
    expect(at).toBeGreaterThan(xml.indexOf('</conditions>'));
    expect(at).toBeLessThan(xml.indexOf('<flightdata'));
    // And they read back the same, so a second round trip keeps them too.
    expect(importOrk(xml).simulations![0]!.xmlExtra).toEqual(carried);
  });
});

/**
 * The conditions a saved result was flown under. The desktop re-flies a
 * simulation from its `<conditions>`, so a result written up to date has to
 * carry the step, limit and warning thresholds the run used, and a desktop
 * file's own conditions this app does not model have to survive a save.
 */
describe('simulation options in the conditions', () => {
  const prefs = {
    timeStep: 0.01,
    maxTime: 600,
    randomSeed: 42,
    deploymentSpeedWarn: 18,
    mainHighSpeedWarn: 25,
    mainLowSpeedWarn: 12,
    drogueLowSpeedWarn: 2.5,
  };
  const cond = (xml: string, tag: string) =>
    new DOMParser().parseFromString(xml, 'application/xml').querySelector(`simulation > conditions > ${tag}`)
      ?.textContent;

  it('writes the preferences the run used', () => {
    const xml = exportOrk({
      name: 'Sims',
      tree,
      configs,
      activeConfigId: 'cfg-c6',
      launch,
      simulations: [{ name: 'Calm day', configId: 'cfg-c6', launch, summary, status: 'uptodate' }],
      simPrefs: prefs,
    });
    expect(cond(xml, 'timestep')).toBe('0.01');
    expect(cond(xml, 'maxtime')).toBe('600');
    expect(cond(xml, 'randomseed')).toBe('42');
    expect(cond(xml, 'recoveryspeedwarning')).toBe('18');
    expect(cond(xml, 'drogueLowspeedwarning')).toBe('2.5');
    expect(cond(xml, 'recoverydroguemainhighspeedwarning')).toBe('25');
    expect(cond(xml, 'recoverydroguemainlowspeedwarning')).toBe('12');
  });

  const desktopFile = write([{ name: 'Calm day', configId: 'cfg-c6', launch, summary, status: 'uptodate' }]).replace(
    '<timestep>',
    '<simulationsteppermethod>rk6</simulationsteppermethod><randomseed>1234</randomseed><timestep>',
  );

  it('carries the conditions children it does not model back inside the conditions', () => {
    const sim = importOrk(desktopFile).simulations![0]!;
    const xml = exportOrk({
      name: 'Sims',
      tree,
      configs,
      activeConfigId: 'cfg-c6',
      launch,
      simulations: [
        { name: sim.name, configId: 'cfg-c6', launch, summary, status: 'uptodate', xmlExtra: sim.xmlExtra },
      ],
    });
    expect(cond(xml, 'simulationsteppermethod')).toBe('rk6');
    // No seed of its own, so the file's stands.
    expect(cond(xml, 'randomseed')).toBe('1234');
    expect(xml.match(/<timestep>/g)).toHaveLength(1);
    expect(xml).not.toMatch(/<\/conditions>\s*<conditions>/);
  });

  it('writes a fixed seed of its own in place of the file one', () => {
    const sim = importOrk(desktopFile).simulations![0]!;
    const xml = exportOrk({
      name: 'Sims',
      tree,
      configs,
      activeConfigId: 'cfg-c6',
      launch,
      simulations: [
        { name: sim.name, configId: 'cfg-c6', launch, summary, status: 'uptodate', xmlExtra: sim.xmlExtra },
      ],
      simPrefs: prefs,
    });
    expect(xml.match(/<randomseed>/g)).toHaveLength(1);
    expect(cond(xml, 'randomseed')).toBe('42');
  });
});

/**
 * Desktop keeps a time step, a maximum time and the recovery warnings per
 * simulation (`SimulationConditionsHandler` reads them into that simulation's
 * options), so each simulation's own go out in its conditions and come back as
 * its own overrides, where they differ from the app's globals.
 */
describe("each simulation's own run settings", () => {
  const globals = {
    timeStep: 0.05,
    maxTime: 1200,
    deploymentSpeedWarn: 20,
    mainHighSpeedWarn: 30.48,
    mainLowSpeedWarn: 15.24,
    drogueLowSpeedWarn: 3.048,
  } as SimPrefs;
  const fine = { ...globals, timeStep: 0.01 };
  const xml = write([
    { name: 'Fine', configId: 'cfg-c6', launch, status: 'notsimulated', prefs: fine },
    { name: 'Plain', configId: 'cfg-d12', launch, status: 'notsimulated', prefs: globals },
  ]);
  const steps = [...new DOMParser().parseFromString(xml, 'application/xml').querySelectorAll('conditions > timestep')];

  it('are written into that simulation', () => {
    expect(steps.map((e) => e.textContent)).toEqual(['0.01', '0.05']);
  });

  it('come back as overrides where they differ from the globals', () => {
    const fileSims = importOrk(xml).simulations;
    const w = wireLoadedOrk(
      {
        name: 'Sims',
        notes: [],
        tree,
        motors: {},
        configs: configs.map((c) => ({ ...c, motors: {} })),
        chosenConfigId: 'cfg-c6',
        simulations: fileSims,
      } as unknown as LoadedOrk,
      launch,
      globals,
    );
    expect(w.sims[0]!.prefs).toEqual({ timeStep: 0.01 });
    expect(w.sims[1]!.prefs).toBeUndefined();
  });

  it('are refused outside the bounds Settings holds them to', () => {
    const bad = xml.replace('<timestep>0.01</timestep>', '<timestep>1000000</timestep>');
    expect(importOrk(bad).simulations?.[0]?.prefs?.timeStep).toBeUndefined();
  });
});
