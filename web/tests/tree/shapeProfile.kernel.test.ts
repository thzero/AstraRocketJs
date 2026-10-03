import { describe, it, expect } from 'vitest';
import { shapeRadius, shapeParamDefault } from '../../src/tree/shapeProfile';

/**
 * The six profile curves against the kernel's own arithmetic.
 *
 * `shapeProfile.test.ts` covers the surrounding behavior - the clip search, the
 * endpoint, monotonicity, the degenerate parameters - and it cannot cover the
 * SHAPE, because it computes every interior expectation by calling `shapeRadius`,
 * the function under test. A wrong formula produces a wrong expectation and the
 * test agrees with itself.
 *
 * MEASURED, not assumed, and the audit finding that prompted this file overstated
 * the gap. Each of the six branches was replaced in turn with a quarter sine arch -
 * which reaches full radius at the base and rises monotonically, the property set
 * the old assertions were said to admit - and the old file was run against each:
 *
 * | sabotaged | `shapeProfile.test.ts` | this file |
 * | --- | --- | --- |
 * | `conical` | catches | catches |
 * | `ellipsoid` | catches | catches |
 * | `power` | catches | catches |
 * | `parabolic` | **PASSES** | catches |
 * | `haack` | catches | catches |
 *
 * So the old file is blind to ONE shape, not four: it has more shape-specific
 * assertions than the finding credited it with (the ellipsoid one, for instance,
 * checks it against the virtual nose it was cut from). `parabolic` is the real hole,
 * and it is the branch with no block of its own and no dedicated assertion anywhere.
 *
 * The circular-expectation problem is the other half and is independent of that
 * count: where the old file does check interior points, it computes the expected
 * value by calling `shapeRadius`, so a wrong formula yields a wrong expectation and
 * the test agrees with itself. Every expectation here is written out from the Java
 * instead.
 *
 * Transcribed from
 * `engine-java/src/java/info/openrocket/core/rocketcomponent/Transition.java`. The
 * formulas, with `t = x / L`:
 *
 * | shape | Java body | closed form |
 * | --- | --- | --- |
 * | `conical` | `radius * x / length` | `R·t` |
 * | `ellipsoid` | `x = x*radius/length; sqrt(2*radius*x - x*x)` | `R·√(2t − t²)` |
 * | `power` | `radius * pow(x/length, param)` | `R·t^p` |
 * | `parabolic` | `radius * ((2t − p·t²) / (2 − p))` | as written |
 * | `haack` | `θ = acos(1 − 2t); radius * sqrt((θ − sin(2θ)/2 + p·sin³θ)/π)` | as written |
 * | `ogive` | a circular arc; see `ogiveJava` below | as written |
 *
 * Each is an INDEPENDENT rewrite of the Java, which is the point: if `shapeProfile.ts`
 * and this file ever disagree, one of them has drifted from the Java and the diff
 * says which expression to look at. Keeping them textually close to the Java is
 * deliberate for the same reason - prettier arithmetic here would be a third
 * version to reconcile.
 */

const R = 0.05;
const L = 0.2;

/** `ELLIPSOID.getRadius`: scales x by radius/length, then a sphere of that radius. */
const ellipsoidJava = (x: number, radius: number, length: number): number => {
  const u = (x * radius) / length;
  return Math.sqrt(2 * radius * u - u * u);
};

/** `POWER.getRadius`. */
const powerJava = (x: number, radius: number, length: number, param: number): number =>
  radius * Math.pow(x / length, param);

/** `PARABOLIC.getRadius`. */
const parabolicJava = (x: number, radius: number, length: number, param: number): number =>
  radius * ((2 * (x / length) - param * (x / length) ** 2) / (2 - param));

/** `HAACK.getRadius`, including its `param` term. */
const haackJava = (x: number, radius: number, length: number, param: number): number => {
  const theta = Math.acos(1 - (2 * x) / length);
  return radius * Math.sqrt((theta - Math.sin(2 * theta) / 2 + param * Math.sin(theta) ** 3) / Math.PI);
};

/** `OGIVE.getRadius`: the arc of a circle of radius `Rc` whose center sits at `y0`. */
const ogiveJava = (x: number, radius: number, length: number, param: number): number => {
  const Rc = Math.sqrt(
    ((length ** 2 + radius ** 2) * ((2 - param) * length) ** 2 + (length ** 2 + radius ** 2) * (param * radius) ** 2) /
      (4 * (param * radius) ** 2),
  );
  const Lc = length / param;
  const y0 = Math.sqrt(Rc * Rc - Lc * Lc);
  return Math.sqrt(Rc * Rc - (Lc - x) * (Lc - x)) - y0;
};

/** Interior stations. Not 0 or L: the endpoints are what the old test already had. */
const STATIONS = [0.1, 0.25, 0.4, 0.5, 0.6, 0.75, 0.9];

describe('every curve matches the kernel at interior points', () => {
  it.each([
    ['conical', (t: number) => R * t],
    ['ellipsoid', (t: number) => ellipsoidJava(t * L, R, L)],
    ['power', (t: number) => powerJava(t * L, R, L, shapeParamDefault('power'))],
    ['parabolic', (t: number) => parabolicJava(t * L, R, L, shapeParamDefault('parabolic'))],
    ['haack', (t: number) => haackJava(t * L, R, L, shapeParamDefault('haack'))],
    ['ogive', (t: number) => ogiveJava(t * L, R, L, shapeParamDefault('ogive'))],
  ] as const)('%s', (shape, expected) => {
    const param = shapeParamDefault(shape);
    for (const t of STATIONS) {
      // `shapeRadius` takes x in the SAME units as length, not a fraction of it.
      expect(shapeRadius(shape, t * L, R, L, param), `${shape} at t=${t}`).toBeCloseTo(expected(t), 9);
    }
  });
});

describe('the curves are distinguishable from each other, and from a wrong one', () => {
  /**
   * The substitution the old test could not see: a quarter sine arch. It reaches
   * full radius at the base, rises monotonically, and is not any of these shapes.
   */
  const sineArch = (t: number) => R * Math.sin((Math.PI / 2) * t);

  const mid = (shape: string, len = L) => shapeRadius(shape, 0.5 * len, R, len, shapeParamDefault(shape)) / R;

  it('pins each midpoint to the figure the Java gives, as a fraction of R', () => {
    // Written as LITERALS on purpose. Every other assertion in this file derives its
    // expectation from a formula, so a mistake copied into both a formula and the
    // code it checks would still pass; these are the numbers themselves.
    //
    // Five of the six are scale-invariant - the fraction of R at the midpoint is the
    // same whatever the length - because each is `R` times a function of `x/L`.
    expect(mid('ellipsoid')).toBeCloseTo(0.8660254, 6); // sqrt(3)/2
    expect(mid('parabolic')).toBeCloseTo(0.75, 6); // (2*0.5 - 0.25) / 1
    expect(mid('haack')).toBeCloseTo(0.7071068, 6); // sqrt(0.5), param 0
    expect(mid('conical')).toBeCloseTo(0.5, 6);
    expect(mid('power')).toBeCloseTo(0.7071068, 6); // sqrt(0.5), param 0.5
    // The OGIVE is not, and that is worth a line of its own: it is the arc of a
    // circle whose radius is computed from both `length` and `radius`, so its
    // profile depends on the length-to-radius ratio rather than only on `x/L`. At
    // this fixture's L/R of 4 the midpoint is 0.7614 R; it is 0.7913 at L/R 2 and
    // 0.7505 at L/R 20, approaching the parabolic as the cone gets slenderer.
    expect(mid('ogive')).toBeCloseTo(0.7613558, 6);
  });

  it('is the only shape whose profile depends on the length-to-radius ratio', () => {
    // Stated as a property rather than left implicit in the number above, because a
    // reader comparing midpoints across fixtures will otherwise think one of them is
    // wrong. Also a real guard: a rewrite that normalized the ogive on `x/L` alone
    // would pass every per-station assertion at ONE L and fail here.
    for (const shape of ['conical', 'ellipsoid', 'power', 'parabolic', 'haack'] as const) {
      expect(mid(shape, 0.1), shape).toBeCloseTo(mid(shape, 1), 6);
    }
    expect(Math.abs(mid('ogive', 0.1) - mid('ogive', 1))).toBeGreaterThan(0.03);
  });

  it('separates ellipsoid from a sine arch', () => {
    // 0.866 R against 0.707 R: an 18% error at the midpoint of the nose cone, on a
    // curve that satisfies "full radius at the base" and "monotonic" just as well.
    // The old file does catch this particular substitution; what it does not catch
    // is the same trick on `parabolic`, which is why the sweep above covers all six
    // rather than only the shape whose assertion was missing.
    const ours = shapeRadius('ellipsoid', 0.5 * L, R, L, shapeParamDefault('ellipsoid'));
    expect(ours).toBeCloseTo(ellipsoidJava(0.5 * L, R, L), 9);
    expect(Math.abs(ours - sineArch(0.5)) / R).toBeGreaterThan(0.15);
  });

  it('admits that haack and power are NOT separated by their midpoint alone', () => {
    // Both read 0.7071 R there, as does the sine arch. Stated rather than left for
    // someone to discover: a single-station test cannot tell these three apart, and
    // that is why the interior sweep above walks seven.
    const haack = shapeRadius('haack', 0.5 * L, R, L, shapeParamDefault('haack'));
    const power = shapeRadius('power', 0.5 * L, R, L, shapeParamDefault('power'));
    expect(Math.abs(haack - power) / R).toBeLessThan(0.001);
    // And that the sweep DOES separate them, at a station nearer the tip.
    const t = 0.1;
    const haackT = shapeRadius('haack', t * L, R, L, shapeParamDefault('haack'));
    const powerT = shapeRadius('power', t * L, R, L, shapeParamDefault('power'));
    expect(Math.abs(haackT - powerT) / R).toBeGreaterThan(0.05);
  });

  it('gives every pair of curves a station where they differ', () => {
    // The property the old file lacked outright: these are six DIFFERENT shapes, so
    // no two of them may agree everywhere. A copy-paste in the switch that made two
    // branches identical would pass every other test in both files.
    const shapes = ['conical', 'ellipsoid', 'power', 'parabolic', 'haack', 'ogive'] as const;
    const curve = (s: string) => STATIONS.map((t) => shapeRadius(s, t * L, R, L, shapeParamDefault(s)));
    for (let i = 0; i < shapes.length; i++) {
      for (let j = i + 1; j < shapes.length; j++) {
        const a = curve(shapes[i]!);
        const b = curve(shapes[j]!);
        const apart = Math.max(...a.map((v, k) => Math.abs(v - b[k]!)));
        expect(apart / R, `${shapes[i]} vs ${shapes[j]}`).toBeGreaterThan(0.005);
      }
    }
  });
});

describe('the shape parameter is the one the kernel defaults to', () => {
  it.each([
    ['ogive', 1.0],
    ['power', 0.5],
    ['parabolic', 1.0],
    // ZERO, and checked because it is the one worth getting wrong. `HAACK` does not
    // override `defaultParameter()`, so it inherits the base class@s `0.0`
    // (Transition.java:1312) - an LD-Haack. Its `maxParameter()` IS 1/3, and that is
    // the number a reader reaches for: writing 1/3 here draws a Von Karman instead,
    // and both curves pass every other assertion in this file.
    ['haack', 0.0],
    ['conical', 0.0],
    ['ellipsoid', 0.0],
  ] as const)('%s defaults to %s', (shape, expected) => {
    // These decide WHICH member of each family is drawn, so a wrong default is a
    // wrong curve even with the formula right.
    expect(shapeParamDefault(shape)).toBeCloseTo(expected, 9);
  });
});
