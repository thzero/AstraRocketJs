package info.openrocket.core.aerodynamics;

import info.openrocket.core.aerodynamics.barrowman.FinSetCalc;
import info.openrocket.core.aerodynamics.barrowman.RocketComponentCalc;
import info.openrocket.core.aerodynamics.barrowman.SymmetricComponentCalc;
import info.openrocket.core.rocketcomponent.RocketComponent;

/**
 * RASAero opt-in supersonic-aerodynamics stability strategy (original work of the
 * mmrocket-sim project; see engine-java/ATTRIBUTION.md). This is the pluggable
 * {@link StabilityCalculator} that carries the opt-in aero extensions on top of the
 * stock extended-Barrowman stability calculator:
 *
 * <ul>
 *   <li><b>feature #1</b> — corrected supersonic fin normal force, exact NACA-1307
 *       body-fin interference, and Mach-dependent nose CN&alpha; growth
 *       ({@code supersonicAero}); and</li>
 *   <li><b>feature #3</b> — opt-in Rogers Modified Barrowman body-fin carryover
 *       ({@code rogersKbf}).</li>
 * </ul>
 *
 * The physics lives in the per-component calc classes ({@link FinSetCalc},
 * {@link SymmetricComponentCalc}); this class only binds the opt-in flags onto them
 * when the calc map is built. With both flags off it is bit-identical to
 * {@link BarrowmanStabilityCalculator}.
 */
public class RASAeroStabilityCalculator extends BarrowmanStabilityCalculator {

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
	public StabilityCalculator newInstance() {
		RASAeroStabilityCalculator copy = new RASAeroStabilityCalculator();
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
}
