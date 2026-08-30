package info.openrocket.core.aerodynamics;

import static info.openrocket.core.util.MathUtil.pow2;

import info.openrocket.core.aerodynamics.barrowman.FinSetCalc;
import info.openrocket.core.aerodynamics.barrowman.RocketComponentCalc;
import info.openrocket.core.aerodynamics.barrowman.SymmetricComponentCalc;
import info.openrocket.core.rocketcomponent.RocketComponent;
import info.openrocket.core.util.MathUtil;

/**
 * RASAero opt-in supersonic-aerodynamics drag strategy (original work of the
 * mmrocket-sim project; see engine-java/ATTRIBUTION.md). The pluggable
 * {@link DragCalculator} carrying the opt-in drag extensions on top of the stock
 * extended-Barrowman drag calculator:
 *
 * <ul>
 *   <li><b>feature #1 Phase 2</b> — sharp-airfoil / boat-tail / nose supersonic
 *       wave drag and the ×1.8 fin-body junction increment (in {@link FinSetCalc}
 *       / {@link SymmetricComponentCalc}, activated by binding the flags below);</li>
 *   <li><b>feature #1 Phase 2/4</b> — the high-Mach base-CD cap
 *       ({@link #effectiveBaseCD}) and the Van&nbsp;Driest&nbsp;II friction fade
 *       ({@link #turbulentCompressibility}); and</li>
 *   <li><b>feature #4</b> — fin airfoil cross-section thickness-wave drag (gated in
 *       {@link FinSetCalc} on the same flags).</li>
 * </ul>
 *
 * With both flags off it is bit-identical to {@link BarrowmanDragCalculator}.
 *
 * <p>Not ported: mmrocket's boundary-layer {@code partialLaminar} change
 * (2026-08-25). There {@code partialLaminar = (rogersKbf || supersonicAero) &&
 * isPerfectFinish()} replaced a bare {@code isPerfectFinish()} in the friction
 * calc — but that only alters the <em>flag-off</em> path (when a flag is on,
 * {@code partialLaminar == isPerfectFinish}, i.e. identical to stock). It was
 * mmrocket's correction to make <em>their</em> classic model match desktop
 * OpenRocket. Our flag-off must stay bit-identical to the unstable base (which
 * uses {@code isPerfectFinish}), and our flag-on matches it — so porting it would
 * regress flag-off parity for no flag-on gain. Deliberately omitted.</p>
 */
public class RASAeroDragCalculator extends BarrowmanDragCalculator {

	private boolean supersonicAero = false;
	private boolean rogersKbf = false;

	public void setSupersonicAero(boolean enabled) {
		this.supersonicAero = enabled;
	}

	public boolean isSupersonicAero() {
		return supersonicAero;
	}

	public void setRogersKbf(boolean enabled) {
		this.rogersKbf = enabled;
	}

	public boolean isRogersKbf() {
		return rogersKbf;
	}

	@Override
	public DragCalculator newInstance() {
		RASAeroDragCalculator copy = new RASAeroDragCalculator();
		copy.supersonicAero = this.supersonicAero;
		copy.rogersKbf = this.rogersKbf;
		return copy;
	}

	@Override
	protected RocketComponentCalc createCalcObject(RocketComponent comp) {
		RocketComponentCalc calc = super.createCalcObject(comp);
		if (calc instanceof FinSetCalc) {
			((FinSetCalc) calc).setRogersKbf(rogersKbf);
			((FinSetCalc) calc).setSupersonicAero(supersonicAero);
		} else if (calc instanceof SymmetricComponentCalc) {
			((SymmetricComponentCalc) calc).setSupersonicAero(supersonicAero);
		}
		return calc;
	}

	/**
	 * Feature #1 Phase 2: above M1 with the flag on, cap the base CD at the
	 * base-pressure vacuum trend {@code 1.2/M^2} (≈0.85 of 2/(γM²); crossover
	 * ≈ M4.8, matching the HB-2 base-drag trend). Flag off ⇒ the stock value.
	 */
	@Override
	protected double effectiveBaseCD(double mach) {
		double cd = super.effectiveBaseCD(mach);
		if (supersonicAero && mach > 1) {
			cd = Math.min(cd, 1.2 / (mach * mach));
		}
		return cd;
	}

	/**
	 * Feature #1 Phase 4: the stock {@code (1+0.15 M^2)^-0.58} turbulent fit
	 * tracks Van Driest II only to M≈4. Flag on, above M3.5, fade to the
	 * adiabatic-wall VD-II engineering fit {@code (1+0.144 M^2)^-0.65} (Hopkins
	 * & Inouye, NASA TN D-6945), fully in by M4.5.
	 */
	@Override
	protected double turbulentCompressibility(double mach) {
		double c2 = super.turbulentCompressibility(mach);
		if (supersonicAero && mach > 3.5) {
			double cVD = 1 / Math.pow(1 + 0.144 * pow2(mach), 0.65);
			double t = MathUtil.clamp((mach - 3.5) / 1.0, 0, 1);
			c2 = c2 * (1 - t) + cVD * t;
		}
		return c2;
	}
}
