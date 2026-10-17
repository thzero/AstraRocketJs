// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { importOrk } from '../../../src/services/files/orkFile';
import { noteTexts } from '../../testing/importNotes';

/**
 * A `<motor>` with no `<designation>` names no motor.
 *
 * Desktop's `MotorHandler` keeps the designation null, finds no motor for it
 * and leaves the mount empty with a warning. Here the reference's designation
 * is empty, never an English word standing in for one, since the designation
 * reaches the mount label and the notes in whatever language the app shows;
 * the note names the mount instead.
 */

const ork = (motor: string): string =>
  `<?xml version="1.0"?><openrocket version="1.8"><rocket><name>T</name>` +
  `<motorconfiguration configid="c1" default="true"/>` +
  `<subcomponents><stage><name>S</name><subcomponents>` +
  `<bodytube><name>Body</name><length>0.3</length><radius>0.012</radius><subcomponents>` +
  `<innertube><name>Mount</name><length>0.07</length><outerradius>0.0095</outerradius>` +
  `<motormount>${motor}<ignitionevent>automatic</ignitionevent><ignitiondelay>0</ignitiondelay></motormount>` +
  `</innertube></subcomponents></bodytube></subcomponents></stage></subcomponents></rocket></openrocket>`;

describe('a motor with no designation', () => {
  const res = importOrk(
    ork(
      '<motor configid="c1"><type>single</type><manufacturer>Estes</manufacturer><diameter>0.018</diameter><length>0.07</length><delay>5</delay></motor>',
    ),
  );
  const mountId = res.tree.components[0]!.children![0]!.children![0]!.id as string;

  it('is seated with an empty designation', () => {
    expect(res.motors[mountId]?.designation).toBe('');
    expect(res.configs[0]?.motors[mountId]?.designation).toBe('');
  });

  it('is noted by its mount', () => {
    expect(noteTexts(res.notes)).toContain(
      'Motor mount "Mount": the file\'s motor has no designation, so it could not be looked up.',
    );
  });
});

describe('a motor with a designation', () => {
  it('raises no such note', () => {
    const res = importOrk(
      ork(
        '<motor configid="c1"><type>single</type><designation>C6</designation><diameter>0.018</diameter><length>0.07</length><delay>5</delay></motor>',
      ),
    );
    expect(noteTexts(res.notes).some((n) => n.includes('no designation'))).toBe(false);
  });
});
