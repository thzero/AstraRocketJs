import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Readouts and controls that must follow the user's unit and act on input.
 *
 * Source-level and node-env, like `simBounds.test.ts`, because each of these is a
 * missing prop or an absent conversion: a render test that does not know what to
 * look for passes either way.
 */
const src = (rel: string) => readFileSync(fileURLToPath(new URL(`../../../src/${rel}`, import.meta.url)), 'utf8');

describe('the map scale reads in the user unit', () => {
  const text = () => src('components/sim/SiteMap.tsx');

  it('resolves the distance preference instead of hardcoding m and km', () => {
    // `distance` offers ft, yd and mi, and the scale is a length readout like
    // every other on the panel.
    expect(text()).toContain("u.sym('distance')");
    expect(text()).toContain("u.fmtSym('distance'");
  });

  it('states its promotion ladder rather than assuming metric', () => {
    // Promoting is still worth doing ("1.2 km" beats "1234 m"), so the ladder is
    // declared for the two base units that have a large sibling in UNITS.distance.
    expect(text()).toContain('SCALE_PROMOTION');
    expect(text()).toMatch(/ft: 'mi'/);
  });
});

describe('the diameter caliper prints its unit', () => {
  it('carries the symbol the length readout above it carries', () => {
    // The `aria-valuetext` carries it, so without it sighted users would get less
    // than screen-reader users.
    const text = src('components/canvas/SchematicCalipers.tsx');
    // Each span readout formats with its symbol (fmtSym), not the bare number.
    const readouts = [...text.matchAll(/\{u\.fmtSym\('length', Math\.abs\([^)]*\)\)\}/g)];
    expect(readouts.length, 'both span readouts').toBe(2);
    expect(text).not.toMatch(/\{u\.fmt\('length', Math\.abs\(/);
  });
});

describe('the map wheel does not scroll the form under it', () => {
  const text = () => src('components/sim/SiteMap.tsx');

  it('registers a native non-passive wheel listener', () => {
    // React's onWheel is passive at the root, so a preventDefault inside it does
    // nothing. Same mechanism `useWheelZoom` and `useChartZoom` use.
    expect(text()).toContain("addEventListener('wheel'");
    expect(text()).toContain('passive: false');
    expect(text()).toContain('e.preventDefault()');
  });

  it('does not use the React prop that cannot prevent the default', () => {
    expect(text()).not.toMatch(/onWheel=\{/);
  });
});

describe('the per-simulation angle override resolves its unit', () => {
  it('goes through the FieldUnit, like the global row', () => {
    // Two surfaces edit one stored value, so they must agree: the global row
    // resolves `angle` (which offers rad), and this one has to as well rather
    // than hardcoding degrees with an inline conversion.
    const text = src('components/sim/SimEditor.tsx');
    expect(text).toContain("unitScope('settings', 'maxAngleStep')");
    expect(text).toContain('unit={angle.sym}');
    expect(text).not.toContain('* 180) / Math.PI');
  });
});

/**
 * The 3D view's legend dot identifies its marker, so it is the marker's ink, from
 * the same shared token.
 */
describe('the 3D legend matches its markers', () => {
  it('draws the CG and CP marker and legend from the shared inks', () => {
    const text = src('components/canvas/Rocket3D.tsx');
    expect(text).toContain('markerTexture(scene[CG_INK], light)');
    expect(text).toContain('markerTexture(scene[CP_INK], light)');
    expect(text).toContain('color: token(CG_INK)');
    expect(text).toContain('color: token(CP_INK)');
    expect(text).not.toMatch(/#2b6cff|#aab2bd|#e34948/);
  });
});

describe('the 2D roll slider is heard in the unit it shows', () => {
  it('carries the formatted angle as its value text', () => {
    // The slider steps in whole degrees; without a value text a screen reader
    // reads that raw number while the readout beside it is in radians.
    const text = src('components/canvas/CenterCanvas.tsx');
    expect(text).toContain('aria-valuetext={shown}');
  });
});

/**
 * A decorative glyph on a button stays out of its accessible name, or a screen
 * reader reads out the glyph's Unicode name before "SVG". Each one sits in an
 * aria-hidden span, and the image menu takes its glyph as an icon rather than in
 * the label.
 */
describe('button glyphs are not part of the name', () => {
  it.each([
    ['components/canvas/SchematicControls.tsx', ['⬇ SVG', '`⬇ ', '⤢ {']],
    ['components/canvas/Rocket3D.tsx', ['`📷 ']],
    ['components/canvas/FlightPathExport.tsx', ['⬇ {']],
    ['components/sim/FlightEventsTable.tsx', ['⬇ CSV']],
  ])('%s', (file, bare) => {
    const text = src(file);
    for (const b of bare) expect(text).not.toContain(b);
    expect(text).toMatch(/<span aria-hidden>[⬇⤢]<\/span>|icon="📷"/);
  });
});

/**
 * An angle held in degrees (a bearing, a wind direction, a weathercock angle)
 * prints in the reader's angle unit, the way the flight chart's angle of attack
 * and the wind direction field do.
 */
describe('degree readouts follow the angle unit', () => {
  it.each([
    'components/sim/WeatherDialog.tsx',
    'components/tools/LandingEstimator.tsx',
    'components/tools/OffTheRail.tsx',
    'components/canvas/EnvironmentLanding.tsx',
    'components/canvas/EnvironmentView.tsx',
    'components/canvas/GroundTrack.tsx',
    'components/canvas/DriftSweepPanel.tsx',
  ])('%s', (file) => {
    const text = src(file);
    expect(text).toContain('fmtDegrees(u, ');
    expect(text).not.toMatch(/\)\}°`|\}°`|\)}°/);
  });

  it('leaves no degree sign in the strings those readouts fill', () => {
    const en = src('i18n/locales/en.json');
    expect(en).not.toContain('{{from}}°');
    expect(en).not.toContain('{{angle}}°');
  });
});
