// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { buildFlightPathModel, defaultExportOptions, renderKml } from '../../../src/services/exports/flightPathExport';
import type { FlightResult } from '../../../src/engine/openRocketEngine';
import type { LaunchConditions } from '../../../src/services/design/orkTree';
import en from '../../../src/i18n/locales/en.json';
import { localeTranslator } from '../../testing/localeTranslator';

/**
 * The KML balloons carry HTML, and the escaping is the subtle part of them, so
 * it is checked by actually parsing the file rather than by matching text.
 *
 * Its own file because that needs a DOM parser, and the rest of the export
 * suite runs in the default node environment.
 *
 * The rule the parse proves: the template writes its markup pre-escaped
 * (`&lt;b&gt;`) and does not wrap the balloon in CDATA. Mustache escapes every
 * substituted value, and inside a CDATA block the XML parser would not decode
 * those escapes, so a rocket named `Bill & Ted` would reach the balloon as the
 * literal text `Bill &amp; Ted`. Pre-escaped, the markup decodes to the tags
 * it means. A value is escaped twice, for HTML and then for XML, because the
 * decoded description is HTML: a name stays text in the balloon.
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
  it('parses as XML, with the markup decoded to tags and the name still HTML-escaped', () => {
    const doc = new DOMParser().parseFromString(kml(), 'application/xml');
    // A `]]>` in a name would have closed a CDATA block early; an unescaped
    // `&` would break the document outright. Either shows up here.
    expect(doc.querySelector('parsererror')).toBeNull();

    const description = doc.getElementsByTagName('description')[0]!.textContent!;
    // The parser hands back the HTML the template meant, with the name as
    // HTML text: one more decode, by the balloon, gives the name the user typed.
    expect(description.startsWith(`<b>Rocket:</b> Bill &amp; Ted's &lt;Excellent&gt; Rocket<br/>`)).toBe(true);
  });

  it('renders as the intended elements once the balloon HTML is parsed', () => {
    const doc = new DOMParser().parseFromString(kml(), 'application/xml');
    const host = document.createElement('div');
    host.innerHTML = doc.getElementsByTagName('description')[0]!.textContent!;
    // A bold label and a line break, because the template asked for them - not
    // because the reader sees the characters `<b>` and `<br/>`.
    expect(host.querySelector('b')?.textContent).toBe('Rocket:');
    expect(host.querySelectorAll('br').length).toBeGreaterThan(1);
    // The whole name comes through as the reader typed it, angle brackets
    // included: they are text in the balloon, not an element.
    expect(host.textContent).toContain(`Rocket: ${NAME}`);
    expect(host.querySelector('Excellent')).toBeNull();
  });

  it('keeps markup in a file-sourced name out of every balloon', () => {
    const evil = '<img src=x onerror=alert(1)>';
    const text = renderKml(
      buildFlightPathModel(
        result,
        launch,
        { simName: 'Sim 1', rocketName: evil, motorName: 'C6' },
        defaultExportOptions(),
        localeTranslator(en),
      ),
    );
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    expect(doc.querySelector('parsererror')).toBeNull();
    for (const d of doc.getElementsByTagName('description')) {
      const host = document.createElement('div');
      host.innerHTML = d.textContent!;
      expect(host.querySelector('img')).toBeNull();
    }
    const host = document.createElement('div');
    host.innerHTML = doc.getElementsByTagName('description')[0]!.textContent!;
    expect(host.textContent).toContain(evil);
    // The document name is not HTML, so it is escaped once.
    expect(doc.getElementsByTagName('name')[0]!.textContent).not.toContain('&lt;');
  });
});
