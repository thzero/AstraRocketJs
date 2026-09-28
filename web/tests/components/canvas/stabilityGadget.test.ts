import { describe, it, expect } from 'vitest';
import { calloutGadget, MARGIN_COLOR } from '../../../src/components/canvas/stabilityGadget';
import { markerRadius } from '../../../src/components/canvas/rocketPieces';
import type { StaticInfo } from '../../../src/engine/openRocketEngine';

/**
 * The floating CG/CP gadget layout, which its docblock says is pure "so the
 * numbers are provable" and which nothing proved.
 */

const info = (over: Partial<StaticInfo> = {}) =>
  ({ cg: 0.3, cp: 0.4, stabilityCalibers: 2.0, length: 0.6, ...over }) as unknown as StaticInfo;

describe('calloutGadget', () => {
  it('is null without static info or with a non-finite station', () => {
    expect(calloutGadget(null, 0.05, 0.6)).toBeNull();
    expect(calloutGadget(info({ cg: NaN }), 0.05, 0.6)).toBeNull();
    expect(calloutGadget(info({ cp: Infinity }), 0.05, 0.6)).toBeNull();
  });

  it('puts both spheres at the true axial stations, offset clear of the hull', () => {
    const maxR = 0.05;
    const g = calloutGadget(info(), maxR, 0.6)!;
    expect(g.cg.pos[0]).toBe(0.3);
    expect(g.cp.pos[0]).toBe(0.4);
    expect(g.cg.pos[2]).toBe(g.off);
    expect(g.off).toBeGreaterThan(maxR);
    expect(g.r).toBeLessThan(markerRadius(0.6, maxR));
  });

  it('centers the margin readout between the stations and inks it by tier', () => {
    const ok = calloutGadget(info({ stabilityCalibers: 2.0 }), 0.05, 0.6)!;
    expect(ok.margin?.pos[0]).toBeCloseTo(0.35, 9);
    expect(ok.margin?.text).toBe('2.00 cal');
    expect(ok.margin?.color).toBe(MARGIN_COLOR.ok);
    const under = calloutGadget(info({ stabilityCalibers: 0.5 }), 0.05, 0.6)!;
    expect(under.margin?.color).toBe(MARGIN_COLOR.under);
  });

  it('drops the margin readout when stability is unknown', () => {
    expect(calloutGadget(info({ stabilityCalibers: NaN }), 0.05, 0.6)?.margin).toBeNull();
  });
});
