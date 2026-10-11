// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import i18n from '../../src/i18n';
import { KeyedError, englishText, errorReason, errorText, keyedText, type Translate } from '../../src/i18n/keyedError';
import { importNoteText, keyedNote } from '../../src/services/files/importNote';
import { addCustom } from '../../src/services/materials/materials';
import { updateCustomPart } from '../../src/services/parts/customParts';
import { parseDesignFile } from '../../src/services/files/designFile';
import { exportCdx1 } from '../../src/services/files/rasaeroExport';
import { parseEng } from '../../src/services/motors/engParser';
import { parseRse } from '../../src/services/motors/rseParser';
import { samplesToMotorSpec } from '../../src/services/motors/thrustcurve';
import { OpenRocketDesign, __setEngineForTests, type RocketTree } from '../../src/engine/openRocketEngine';
import de from '../../src/i18n/locales/de.json';
import fr from '../../src/i18n/locales/fr.json';
import ja from '../../src/i18n/locales/ja.json';
import ru from '../../src/i18n/locales/ru.json';

/**
 * Errors a user reads are thrown as keys and translated where they are caught.
 * Each service family below throws for real and is rendered the way a catch
 * site renders it (`errorText(e, i18n.t)`) in a language other than English.
 */

afterEach(async () => {
  await i18n.changeLanguage('en');
});

/** What the thrown value says, rendered as a catch site renders it. */
function caught(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    return errorText(e, i18n.t);
  }
  throw new Error('expected a throw');
}

async function caughtAsync(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return errorText(e, i18n.t);
  }
  throw new Error('expected a rejection');
}

describe('KeyedError', () => {
  it('carries its key and values, with the English sentence as its message for logs', () => {
    const e = new KeyedError('errors.thrustcurve.noData', { motor: 'H128W' });
    expect(e).toBeInstanceOf(Error);
    expect(e.key).toBe('errors.thrustcurve.noData');
    expect(e.values).toEqual({ motor: 'H128W' });
    expect(e.message).toBe('No thrust-curve data available for H128W.');
  });

  it('fills a nested keyed value in English too', () => {
    const e = new KeyedError('errors.remote.motors', { reason: { key: 'errors.remote.badShape' } });
    expect(e.message).toBe('Could not load the motor catalog (unexpected catalog shape).');
  });

  it('falls back to the key for one en.json lacks, as i18next does', () => {
    expect(englishText('errors.noSuchKey')).toBe('errors.noSuchKey');
  });
});

describe('errorText', () => {
  it('translates a keyed error and passes any other error through as its message', () => {
    const t: Translate = (key, values) => `${key}:${JSON.stringify(values ?? {})}`;
    expect(errorText(new KeyedError('errors.thrustcurve.noData', { motor: 'C6' }), t)).toBe(
      'errors.thrustcurve.noData:{"motor":"C6"}',
    );
    expect(errorText(new Error('kernel said no'), t)).toBe('kernel said no');
    expect(errorText('bare string', t)).toBe('bare string');
  });

  it('translates nested keyed values before the outer key', () => {
    const t: Translate = (key, values) => (values ? `${key}(${Object.values(values).join(',')})` : key.toUpperCase());
    const e = new KeyedError('outer', { reason: { key: 'inner' }, n: 3 });
    expect(errorText(e, t)).toBe('outer(INNER,3)');
  });

  it('follows the language showing when it renders, not the one at the throw', async () => {
    const e = new KeyedError('errors.material.nameRequired');
    await i18n.changeLanguage('de');
    expect(errorText(e, i18n.t)).toBe(de.errors.material.nameRequired);
    await i18n.changeLanguage('ja');
    expect(errorText(e, i18n.t)).toBe(ja.errors.material.nameRequired);
  });
});

describe('errorReason', () => {
  it('keeps a keyed error as data and any other error as its message', () => {
    expect(errorReason(new KeyedError('errors.export.noPrintable'))).toEqual({ key: 'errors.export.noPrintable' });
    expect(errorReason(new KeyedError('errors.file.tooDeep', { format: '.rkt' }))).toEqual({
      key: 'errors.file.tooDeep',
      values: { format: '.rkt' },
    });
    expect(errorReason(new Error('boom'))).toBe('boom');
  });

  it('rides inside an import note and is translated with it', async () => {
    const note = keyedNote('importNote.motorFetchFailed', {
      motor: 'J350',
      reason: errorReason(new KeyedError('errors.thrustcurve.timeout')),
    });
    await i18n.changeLanguage('fr');
    expect(importNoteText(note, i18n.t)).toBe(
      fr.importNote.motorFetchFailed.replace('{{motor}}', 'J350').replace('{{reason}}', fr.errors.thrustcurve.timeout),
    );
  });

  it('keyedText renders a keyed value without its values', () => {
    expect(keyedText({ key: 'errors.file.archiveEmpty' }, (k) => `<${k}>`)).toBe('<errors.file.archiveEmpty>');
  });
});

describe('each service family, rendered in another language', () => {
  it('materials', async () => {
    await i18n.changeLanguage('de');
    expect(await caughtAsync(addCustom('  ', 'bulk', 1000))).toBe(de.errors.material.nameRequired);
  });

  it('saved parts', async () => {
    await i18n.changeLanguage('fr');
    expect(await caughtAsync(updateCustomPart('x', { mfr: 'Me', partNo: ' ', desc: '' }, {}))).toBe(
      fr.errors.savedPart.partNoRequired,
    );
  });

  it('design files', async () => {
    await i18n.changeLanguage('ja');
    expect(caught(() => parseDesignFile('<nothing/>'))).toBe(ja.errors.file.notDesign);
  });

  it('the RASAero export', async () => {
    await i18n.changeLanguage('ru');
    const stage = (id: string) => ({ type: 'stage', id, children: [{ type: 'bodytube', id: `${id}b` }] });
    const tree = { name: 'x', components: ['a', 'b', 'c', 'd'].map(stage) } as unknown as RocketTree;
    expect(caught(() => exportCdx1({ tree, name: 'x' }))).toBe(ru.errors.rasaero.tooManyStages.replace('{{max}}', '3'));
  });

  it('a RASAero refusal names an unnamed part by its translated type', async () => {
    await i18n.changeLanguage('de');
    const tree = {
      name: 'x',
      components: [
        {
          type: 'stage',
          id: 's',
          children: [
            { type: 'nosecone', id: 'n', shape: 'ogive' },
            { type: 'bodytube', id: 'b', children: [{ type: 'ellipticalfinset', id: 'f' }] },
          ],
        },
      ],
    } as unknown as RocketTree;
    expect(caught(() => exportCdx1({ tree, name: 'x' }))).toBe(
      de.errors.rasaero.ellipticalFins.replace('{{name}}', de.part.ellipticalfinset),
    );
  });

  it('motor files, a nested field name included', async () => {
    await i18n.changeLanguage('de');
    expect(caught(() => parseEng(''))).toBe(de.errors.motorFile.engNoData);
    const rse =
      '<engine-database><engine-list><engine mfg="Cesaroni" code="J350" len="186" initWt="822" propWt="447">' +
      '<data><eng-data t="0" f="0"/><eng-data t="1" f="5"/></data></engine></engine-list></engine-database>';
    expect(caught(() => parseRse(rse))).toBe(
      de.errors.motorFile.rseMissing.replace('{{what}}', de.errors.motorFile.attrDiameter),
    );
  });

  it('thrustcurve.org motors', async () => {
    await i18n.changeLanguage('ja');
    const motor = {
      motorId: 'm',
      designation: 'C6',
      commonName: 'C6',
      manufacturerAbbrev: 'Estes',
      diameter: 18,
      length: 70,
      totalWeightG: NaN,
      propWeightG: 10,
      availability: 'regular',
    };
    const samples = [
      { time: 0, thrust: 1 },
      { time: 1, thrust: 1 },
    ];
    expect(caught(() => samplesToMotorSpec(motor, samples, 0))).toBe(
      ja.errors.thrustcurve.noWeight.replace('{{motor}}', 'C6'),
    );
  });

  it('the engine', async () => {
    __setEngineForTests(null);
    await i18n.changeLanguage('fr');
    const tree = { name: 'x', components: [{ type: 'stage', id: 's', children: [] }] } as unknown as RocketTree;
    expect(caught(() => OpenRocketDesign.buildTree(tree))).toBe(fr.errors.engine.notReady);
  });
});
