// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { buildFlightPathModel, defaultExportOptions, renderKml } from '../../src/services/flightPathExport';
import type { FlightResult } from '../../src/engine/openRocketEngine';
import type { LaunchConditions } from '../../src/services/orkTree';
import en from '../../src/i18n/locales/en.json';
import { localeTranslator } from '../testing/localeTranslator';

/**
 * The KML balloons carry HTML, and the escaping is the subtle part of them, so
 * it is checked by actually PARSING the file rather than by matching text.
 *
 * Its own file because that needs a DOM parser, and the rest of the export
 * suite runs in the default node environment.
 *
 * The rule the parse proves: the template writes its markup pre-escaped
 * (`&lt;b&gt;`) and does NOT wrap the balloon in CDATA. Mustache escapes every
 * substituted value, and inside a CDATA block the XML parser would not decode
 * those escapes — so a rocket named `Bill & Ted` would reach the balloon as the
 * literal text `Bill &amp; Ted`. Pre-escaped, the markup and the value are each
 * escaped exactly once and the parser decodes them together.
 */

const NAME = `Bill & Ted's <Excellent> Rocket`;

const result = {
  summary: { maxAltitude: 100, maxVelocity: 50, maxAcceleration: 20, timeToApogee: 1, flightTime: 2 },
  series: {
    time: [0, 1, 2],
    altitude: [0, 100, 0],
    velocity: [0, 50, 10],
    acceleration: [20, 5, -9.8],
    Px: [0, 50, 100],
    Py: [0, 100, 200],
  },
  events: [
    { type: 'LIFTOFF', time: 0 },
    { type: 'APOGEE', time: 1 },
    { type: 'GROUND_HIT', time: 2 },
  ],
} as unknown as FlightResult;

const launch = { latitudeDeg: 40, longitudeDeg: -105, launchAltitudeM: 1600 } as LaunchConditions;

const kml = () =>
  renderKml(
    buildFlightPathModel(
      result,
      launch,
      { simName: 'Sim 1', rocketName: NAME, motorName: 'C6' },
      defaultExportOptions(),
      localeTranslator(en),
    ),
  );

describe('balloon HTML', () => {
  it('parses as XML, with the name and the markup each escaped exactly once', () => {
    const doc = new DOMParser().parseFromString(kml(), 'application/xml');
    // A `]]>` in a name would have closed a CDATA block early; an unescaped
    // `&` would break the document outright. Either shows up here.
    expect(doc.querySelector('parsererror')).toBeNull();

    const description = doc.getElementsByTagName('description')[0]!.textContent!;
    // The parser hands back the HTML the template meant...
    expect(description.startsWith(`<b>Rocket:</b> ${NAME}<br/>`)).toBe(true);
    // ...and the name the user typed, not a screenful of character entities.
    expect(description).toContain(NAME);
    expect(description).not.toContain('&amp;');
    expect(description).not.toContain('&lt;');
  });

  it('renders as the intended elements once the balloon HTML is parsed', () => {
    const doc = new DOMParser().parseFromString(kml(), 'application/xml');
    const host = document.createElement('div');
    host.innerHTML = doc.getElementsByTagName('description')[0]!.textContent!;
    // A bold label and a line break, because the template asked for them - not
    // because the reader sees the characters `<b>` and `<br/>`.
    expect(host.querySelector('b')?.textContent).toBe('Rocket:');
    expect(host.querySelectorAll('br').length).toBeGreaterThan(1);
    // The ampersand and the apostrophe come through as themselves. The angle
    // brackets do NOT, and that is the escape-once rule working as designed
    // rather than a gap: a balloon holds HTML, so `<Excellent>` in a rocket's
    // name is an unknown element to whatever renders it. Escaping the value a
    // second time to survive that would put `&amp;` back in front of the
    // reader for every name that merely contains an ampersand, which is the
    // far commoner case.
    expect(host.textContent).toContain(`Rocket: Bill & Ted's`);
  });
});
