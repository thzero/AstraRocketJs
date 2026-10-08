import { describe, it, expect } from 'vitest';
import { parseCoordinateText } from '../../../src/services/map/coordinateText';

const at = (latitudeDeg: number, longitudeDeg: number) => ({ kind: 'coords', latitudeDeg, longitudeDeg });

describe('parseCoordinateText', () => {
  it('reads a plain decimal pair, latitude first', () => {
    expect(parseCoordinateText('38.2544, -104.6091')).toEqual(at(38.2544, -104.6091));
    expect(parseCoordinateText('  38.2544 -104.6091 ')).toEqual(at(38.2544, -104.6091));
    expect(parseCoordinateText('geo:38.2544,-104.6091')).toEqual(at(38.2544, -104.6091));
  });

  it('reads hemisphere letters, before or after the number, in either order', () => {
    expect(parseCoordinateText('38.2544° N, 104.6091° W')).toEqual(at(38.2544, -104.6091));
    expect(parseCoordinateText('N38.2544 W104.6091')).toEqual(at(38.2544, -104.6091));
    expect(parseCoordinateText('104.6091 W, 38.2544 N')).toEqual(at(38.2544, -104.6091));
    expect(parseCoordinateText('33.9 s 18.4 e')).toEqual(at(-33.9, 18.4));
  });

  it('refuses a letter that contradicts a sign, or two letters on one number', () => {
    expect(parseCoordinateText('-38.2 N, 104.6 W')).toBeNull();
    expect(parseCoordinateText('N38.2N, 104.6W')).toBeNull();
    expect(parseCoordinateText('38.2 E, 104.6 E')).toBeNull();
  });

  it('refuses values off the globe', () => {
    expect(parseCoordinateText('95, 10')).toBeNull();
    expect(parseCoordinateText('45, 190')).toBeNull();
  });

  it('is not fooled by a place name or a postal code', () => {
    expect(parseCoordinateText('Pueblo, Colorado')).toBeNull();
    expect(parseCoordinateText('80903')).toBeNull();
    expect(parseCoordinateText('')).toBeNull();
  });

  it('takes the pin from a Google place link rather than the view center', () => {
    const url =
      'https://www.google.com/maps/place/Pueblo,+CO/@38.2700,-104.7000,12z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d38.2544!4d-104.6091';
    expect(parseCoordinateText(url)).toEqual(at(38.2544, -104.6091));
  });

  it('reads the pair from the common map links', () => {
    expect(parseCoordinateText('https://www.google.com/maps/@38.2544,-104.6091,15z')).toEqual(at(38.2544, -104.6091));
    expect(parseCoordinateText('https://maps.google.com/?q=38.2544,-104.6091')).toEqual(at(38.2544, -104.6091));
    expect(parseCoordinateText('https://maps.apple.com/?ll=38.2544,-104.6091&q=Pad')).toEqual(at(38.2544, -104.6091));
    expect(
      parseCoordinateText('https://www.openstreetmap.org/?mlat=38.2544&mlon=-104.6091#map=15/38.2/-104.6'),
    ).toEqual(at(38.2544, -104.6091));
    expect(parseCoordinateText('https://www.openstreetmap.org/#map=15/38.2544/-104.6091')).toEqual(
      at(38.2544, -104.6091),
    );
    expect(parseCoordinateText('https://www.bing.com/maps?cp=38.2544~-104.6091&lvl=15')).toEqual(
      at(38.2544, -104.6091),
    );
  });

  it('recognizes a shortened link, which it cannot read without following it', () => {
    expect(parseCoordinateText('https://maps.app.goo.gl/AbCdEf123')).toEqual({ kind: 'shortLink' });
  });

  it('gives up on a link with no coordinates in it', () => {
    expect(parseCoordinateText('https://www.google.com/maps/place/Pueblo,+CO')).toBeNull();
  });
});
