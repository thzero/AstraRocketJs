import { describe, it, expect } from 'vitest';
import { COMPONENT_PART_KEYS, componentName, warningText, warningHelp, warningKeyOf } from './warningText';
import { localeTranslator } from '../testing/localeTranslator';
import en from '../i18n/locales/en.json';
import es from '../i18n/locales/es.json';

// Stands in for i18n: knows one key, returns the key itself for anything else
// (which is what i18next does without a `defaultValue`).
const t = (key: string) => (key === 'warn.DISCONTINUITY' ? 'Body diameter discontinuity' : key);

describe('warningText', () => {
  it('translates the key and keeps the component names', () => {
    expect(warningText('[Warning.DISCONTINUITY]:  "Nose cone", "Body tube"', t)).toBe(
      'Body diameter discontinuity: "Nose cone", "Body tube"',
    );
  });

  it('keeps a measured value, which is the detail worth reading', () => {
    expect(warningText('[Warning.DISCONTINUITY] (24.6 m/s):  "Parachute"', t)).toBe(
      'Body diameter discontinuity (24.6 m/s): "Parachute"',
    );
  });

  it('falls back to a readable form of an untranslated key', () => {
    // A warning nobody has a string for is still a warning the user needs.
    expect(warningText('[Warning.OPEN_AIRFRAME_FORWARD]:  "Body tube"', t)).toBe('Open airframe forward: "Body tube"');
    expect(warningText('[Warning.LargeAOA.str2] (30°)', t)).toBe('Large AOA (30°)');
  });

  it('leaves a message that carries no key alone', () => {
    expect(warningText('Something the kernel said plainly', t)).toBe('Something the kernel said plainly');
  });

  it('reads a component name that is itself an untranslated key', () => {
    // A part the user never renamed keeps the kernel's default name, which is a
    // bundle lookup too — so the sources arrive as "[Parachute.Parachute]".
    expect(warningText('[Warning.DISCONTINUITY] (1 m/s):  "[Parachute.Parachute]"', t)).toBe(
      'Body diameter discontinuity (1 m/s): "Parachute"',
    );
    expect(warningText('[Warning.DISCONTINUITY]:  "[NoseCone.NoseCone]"', t)).toBe(
      'Body diameter discontinuity: "Nose Cone"',
    );
  });

  it('handles a key with no trailing detail', () => {
    expect(warningText('[Warning.DISCONTINUITY]', t)).toBe('Body diameter discontinuity');
  });
});

describe('warningHelp', () => {
  // The longer "why this matters". OpenRocket explains its recovery-speed
  // warnings; ours said only what tripped, which is a number you have to already
  // understand in order to act on.
  const help = (key: string) => (key === 'warnHelp.RECOVERY_HIGH_SPEED' ? 'The shock can zipper the airframe.' : key);

  it('finds the explanation for a keyed message', () => {
    expect(warningHelp('[Warning.RECOVERY_HIGH_SPEED] (24.6 m/s):  "Parachute"', help)).toBe(
      'The shock can zipper the airframe.',
    );
  });

  it('is null when there is no explanation, rather than echoing the key', () => {
    expect(warningHelp('[Warning.DISCONTINUITY]:  "Nose cone"', help)).toBeNull();
    expect(warningHelp('plain text', help)).toBeNull();
  });
});

describe('warningKeyOf', () => {
  it('reads the key from the MESSAGE, which is the one vocabulary both paths share', () => {
    // `EngineWarning.key` is not this string — the bridge rewrites a few typed
    // warnings to names of its own, and design warnings carry no key field.
    expect(warningKeyOf('[Warning.RECOVERY_MAIN_LOW_SPEED] (2 m/s)')).toBe('RECOVERY_MAIN_LOW_SPEED');
    expect(warningKeyOf('no key here')).toBeNull();
  });
});

describe('componentName', () => {
  const inEnglish = localeTranslator(en);
  const inSpanish = localeTranslator(es);

  it('names a never-renamed part in the language it is asked for', () => {
    // The kernel has no resource bundles, so its default name arrives as the
    // key it would have been looked up under. This app has its own string for
    // the same part, and the export's language can differ from the app's.
    expect(componentName('[Parachute.Parachute]', inEnglish)).toBe('Parachute');
    expect(componentName('[Parachute.Parachute]', inSpanish)).toBe(es.part.parachute);
    expect(componentName('[BodyTube.BodyTube]', inEnglish)).toBe(en.part.bodytube);
    expect(componentName('[BodyTube.BodyTube]', inSpanish)).toBe(es.part.bodytube);
    // The two halves of a kernel key do not always agree, which is why the
    // table is keyed by the whole thing.
    expect(componentName('[EllipticalFinSet.Ellipticalfinset]', inEnglish)).toBe('Elliptical fin set');
  });

  it('degrades to the readable half for a key nothing here names', () => {
    // The design root and a couple of internals have no part of their own in
    // this app. Better a humanized key than a bracketed one.
    expect(componentName('[Sleeve.Sleeve]', inEnglish)).toBe('Sleeve');
    expect(componentName('[RecoveryDevice.RecoveryDevice]', inEnglish)).toBe('Recovery Device');
  });

  it('returns a name the user typed unchanged', () => {
    // Only the bracket form is a key. Rewriting somebody's own name for their
    // own part would be the worse bug, in any language.
    for (const name of ['Main chute', 'Drogue', '18" nylon', 'Chute [spare]']) {
      expect(componentName(name, inSpanish)).toBe(name);
    }
  });

  it('points every kernel name at a string that actually exists', () => {
    // The table is transcribed from the kernel's `getComponentName()` overrides
    // by hand, and `part.*` keys are built dynamically elsewhere, so nothing
    // else would notice one of them being renamed out from under it: the
    // component would quietly start reading as a humanized key again. This is
    // the check that fails instead.
    const missing = Object.entries(COMPONENT_PART_KEYS).filter(([, key]) => inEnglish(key) === key);
    expect(missing).toEqual([]);
  });
});
