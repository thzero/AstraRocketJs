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
 *   <li>fin thickness, boat-tail and nose supersonic wave drag and the x1.8 fin
 *       friction drag factor (in {@link FinSetCalc} / {@link SymmetricComponentCalc},
 *       activated by binding the flags below);</li>
 *   <li>the high-Mach base-CD cap ({@link #effectiveBaseCD}) and the
 *       Van&nbsp;Driest&nbsp;II friction fade ({@link #turbulentCompressibility}); and</li>
 *   <li>fin airfoil cross-section thickness-wave drag (gated in {@link FinSetCalc}
 *       on the same flags).</li>
 * </ul>
 *
 * With every flag off it is bit-identical to {@link BarrowmanDragCalculator}.
 *
 * <p>Partial-laminar friction stays gated on a bare {@code isPerfectFinish()}.
 * Gating it as {@code (rogersKbf || supersonicAero) && isPerfectFinish()} would
 * change only the flag-off result (with a flag on the two are identical), and the
 * flag-off path must stay bit-identical to the stock calculator.</p>
 */
public class RASAeroDragCalculator extends BarrowmanDragCalculator {

	private boolean supersonicAero = false;
	private boolean rogersKbf = false;
	private boolean stubbyNoseFloor = false;

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

	/** The stubby-nose subsonic pressure-drag floor, its own opt-in. */
	public void setStubbyNoseFloor(boolean enabled) {
		this.stubbyNoseFloor = enabled;
	}

	@Override
	public DragCalculator newInstance() {
		RASAeroDragCalculator copy = new RASAeroDragCalculator();
		copy.supersonicAero = this.supersonicAero;
		copy.rogersKbf = this.rogersKbf;
		copy.stubbyNoseFloor = this.stubbyNoseFloor;
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
			// The stubby-nose floor is its own switch, independent of
			// the supersonic / Rogers models.
			((SymmetricComponentCalc) calc).setStubbyNoseFloor(stubbyNoseFloor);
		}
		return calc;
	}

	/**
	 * Above M1 with supersonicAero on, cap the base CD at the
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
	 * The stock {@code (1+0.15 M^2)^-0.58} turbulent fit tracks Van Driest II
	 * only to M≈4. With supersonicAero on, above M3.5, fade to the
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
