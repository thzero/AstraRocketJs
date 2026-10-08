/*
 * MODIFIED for AstraRocketJs, 2026. This file differs from upstream OpenRocket.
 * The bulk is the opt-in RASAero supersonic fin aerodynamics and the Rogers Kbf
 * body-fin carryover, which are the original work of the mmrocket-sim project
 * and are not part of OpenRocket. Every such change is default-off, so with the
 * flags clear this file behaves as upstream does.
 * See engine-java/ATTRIBUTION.md and engine-java/patches/LEDGER.md.
 */
package info.openrocket.core.aerodynamics.barrowman;

import static java.lang.Math.pow;
import static info.openrocket.core.util.MathUtil.pow2;

import java.util.Arrays;

import info.openrocket.core.aerodynamics.AerodynamicForces;
import info.openrocket.core.aerodynamics.FlightConditions;
import info.openrocket.core.logging.Warning;
import info.openrocket.core.logging.WarningSet;
import info.openrocket.core.rocketcomponent.BodyTube;
import info.openrocket.core.rocketcomponent.FinSet;
import info.openrocket.core.rocketcomponent.RocketComponent;
import info.openrocket.core.rocketcomponent.SymmetricComponent;
import info.openrocket.core.rocketcomponent.TrapezoidFinSet;
import info.openrocket.core.rocketcomponent.position.AxialMethod;
import info.openrocket.core.util.BugException;
import info.openrocket.core.util.Coordinate;
import info.openrocket.core.util.CoordinateIF;
import info.openrocket.core.util.LinearInterpolator;
import info.openrocket.core.util.MathUtil;
import info.openrocket.core.util.PolyInterpolator;
import info.openrocket.core.util.Transformation;

public class FinSetCalc extends RocketComponentCalc {
	
	/** considers the stall angle as 20 degrees*/
	private static final double STALL_ANGLE = (20 * Math.PI / 180);
	/** Upper end of the small-angle range where NACA 1307 is used without blending. */
	private static final double NACA_LINEAR_ANGLE = (10 * Math.PI / 180);
	
	/** Number of divisions in the fin chords. */
	protected static final int DIVISIONS = 48;
	
	protected double macLength = Double.NaN; // MAC length
	protected double macLead = Double.NaN; // MAC leading edge position
	protected double macSpan = Double.NaN; // MAC spanwise position
	protected double finArea = Double.NaN; // Fin area
	protected double ar = Double.NaN; // Fin aspect ratio
	protected double span = Double.NaN; // Fin span
	protected double cosGamma = Double.NaN; // Cosine of midchord sweep angle
	protected double cosGammaLead = Double.NaN; // Cosine of leading edge sweep angle
	protected double rollSum = Double.NaN; // Roll damping sum term
	
	protected int interferenceFinCount = -1; // No. of fins in interference
	
	protected double[] chordLead = new double[DIVISIONS];
	protected double[] chordTrail = new double[DIVISIONS];
	protected double[] chordLength = new double[DIVISIONS];
	
	protected final WarningSet geometryWarnings = new WarningSet();
	
	private final double thickness;
	private final double bodyRadius;
	private final int finCount;
	private final double cantAngle;
	private final FinSet.CrossSection crossSection;
	private final boolean rectangularPlanform;
	private final NACA1307FinBodyInterference bodyFinInterference;

	/**
	 * PATCH (RASAero, see engine-java/patches/LEDGER.md): fin airfoil
	 * cross-sections. Non-null overrides the classic 3-value CrossSection for
	 * pressure drag with per-shape linearized/Busemann thickness wave drag,
	 * blunt-base terms, and optional LE-radius bluntness drag. Used only when
	 * the Rogers Kbf or supersonic model is on (see calculatePressureCD); the
	 * classic model ignores it.
	 */
	private final String airfoilSection;
	private final double airfoilLeDiamond;
	private final double airfoilTeDiamond;
	private final double finLeRadius;

	/**
	 * PATCH (RASAero, see engine-java/patches/LEDGER.md): opt-in
	 * "Rogers Modified Barrowman" body-in-presence-of-fins interference (Kbf).
	 * Default false ⇒ CP/CNα bit-identical to classic Barrowman.
	 */
	private boolean rogersKbf = false;

	/** PATCH (RASAero): enable the opt-in Rogers Kbf body-fin carryover. */
	public void setRogersKbf(boolean enabled) {
		this.rogersKbf = enabled;
	}

	/**
	 * PATCH (RASAero, see engine-java/patches/LEDGER.md):
	 * opt-in supersonic aerodynamics. Three fin-side corrections, all
	 * calibrated against the ARCAS (NASA TN D-4013/D-4014) and Basic Finner
	 * (DREV-TM-9703) wind-tunnel/free-flight anchors (validation/score.mjs):
	 *
	 * 1. Supersonic panel normal force: the classic kernel uses the single-surface
	 *    Busemann coefficient K1 = 2/beta as if it were the whole slope, which is
	 *    half of 2D linear theory (4/beta). Flag on: scale the Busemann triple
	 *    by 2*(1 - 1/(2*AR*beta)), the 2D value with the standard finite-span
	 *    tip correction (valid AR*beta > 1, floored at 0.25).
	 * 2. Body-fin interference: in place of the default interference model, use
	 *    the exact NACA Report 1307 (Eq. 14) slender-body split K_W(B) + K_B(W),
	 *    the body-carryover part weighted by an afterbody factor
	 *    min(1, 0.5 + afterbody/rootChord) (carryover needs body behind the
	 *    fin to act on; fins flush with the base get half). Applied at all
	 *    Mach. This is the "Rogers Modified Barrowman" Kbf physics, so the
	 *    separate rogersKbf term is suppressed while this flag is on.
	 * 3. The K1/K2/K3 interpolation grid stops at Mach 4.9 (clamped flat
	 *    above); flag on evaluates the Busemann terms analytically at any M.
	 *
	 * Default false ⇒ bit-identical to classic Barrowman.
	 */
	private boolean supersonicAero = false;
	private double afterbodyFactor = 1.0;

	/** PATCH (RASAero): enable the opt-in supersonic aero model. */
	public void setSupersonicAero(boolean enabled) {
		this.supersonicAero = enabled;
	}
	
	/**
	 * builds a calculator of aerodynamic forces a specified fin
	 * @param component		The fin in consideration
	 */
	///why is this accepting RocketComponent when it rejects?
	///why not put FinSet in the parameter instead?
	public FinSetCalc(FinSet component) {
		super(component);

		this.thickness = component.getThickness();
		this.bodyRadius = component.getBodyRadius();
		this.finCount = component.getFinCount();

		this.cantAngle = component.getCantAngle();
		this.span = component.getSpan();
		this.finArea = component.getPlanformArea();
		this.crossSection = component.getCrossSection();
		this.rectangularPlanform = component instanceof TrapezoidFinSet trapezoidFinSet
				&& MathUtil.equals(trapezoidFinSet.getRootChord(), trapezoidFinSet.getTipChord());
		this.airfoilSection = component.getAirfoilSection(); // PATCH (RASAero)
		this.airfoilLeDiamond = component.getAirfoilLeDiamond();
		this.airfoilTeDiamond = component.getAirfoilTeDiamond();
		this.finLeRadius = component.getFinLeRadius();
		
		calculateFinGeometry(component);
		calculateInterferenceFinCount(component);
		calculateAfterbodyFactor(component);
		this.bodyFinInterference = createBodyFinInterferenceModel(component);
	}

	/**
	 * PATCH (RASAero): how much body extends behind the fin
	 * trailing edge, in root chords. Sets the NACA-1307 carryover weight
	 * min(1, 0.5 + afterbody/rootChord). Walks the parent body and any
	 * symmetric siblings aft of it inside the same (pod/)stage.
	 */
	private void calculateAfterbodyFactor(FinSet component) {
		double rootChord = component.getLength();
		double afterLen = 0;
		RocketComponent parent = component.getParent();
		if (parent != null && rootChord > MathUtil.EPSILON) {
			double finTopInParent = component.getAxialOffset(
					info.openrocket.core.rocketcomponent.position.AxialMethod.TOP);
			afterLen = Math.max(0, parent.getLength() - (finTopInParent + rootChord));
			RocketComponent grand = parent.getParent();
			if (grand != null) {
				boolean after = false;
				for (int i = 0; i < grand.getChildCount(); i++) {
					RocketComponent c = grand.getChild(i);
					if (c == parent) {
						after = true;
						continue;
					}
					if (after && c instanceof info.openrocket.core.rocketcomponent.SymmetricComponent) {
						afterLen += c.getLength();
					}
				}
			}
			afterbodyFactor = Math.min(1.0, 0.5 + afterLen / rootChord);
		} else {
			afterbodyFactor = 1.0;
		}
	}
	
	/*
	 * Calculates the non-axial forces produced by each set of fins.
	 * (normal and side forces, pitch, yaw and roll moments, CP position, CNa).
	 */
	@Override
	public void calculateNonaxialForces(FlightConditions conditions, Transformation transform,
			AerodynamicForces forces, WarningSet warnings) {
		
		warnings.addAll(geometryWarnings);
		
		if (finArea < MathUtil.EPSILON || macSpan < MathUtil.EPSILON) {
			forces.setCm(0);
			forces.setCN(0);
			forces.setCP(Coordinate.ZERO);
			forces.setCroll(0);
			forces.setCrollDamp(0);
			forces.setCrollForce(0);
			forces.setCside(0);
			forces.setCyaw(0);
			return;
		}
		
		//////// Calculate CNa.  /////////
		
		// One fin without interference (both sub- and supersonic):
		double cna1 = calculateFinCNa1(conditions);
			
		// Multiple fins with fin-fin interference
		double cna;
		double theta = conditions.getTheta();
		double angle = transform.getXrotation();

		// Compute basic CNa without interference effects
		cna = cna1 * MathUtil.pow2(Math.sin(theta - angle));
//		final double cna_x = cna1 * MathUtil.pow2(Math.sin(theta - angle));
//		final double cna_y = cna1 * MathUtil.pow2(Math.sin(theta - angle));
		
		//		logger.debug("Component cna = {}", cna);
		
		// Take into account fin-fin interference effects
		switch (interferenceFinCount) {
		case 1:
		case 2:
		case 3:
		case 4:
			// No interference effect
			break;
		
		case 5:
			cna *= 0.948;
			break;
		
		case 6:
			cna *= 0.913;
			break;
		
		case 7:
			cna *= 0.854;
			break;
		
		case 8:
			cna *= 0.81;
			break;
		
		default:
			// Assume 75% efficiency
			cna *= 0.75;
			warnings.add(Warning.PARALLEL_FINS);
			break;
		}
				
		// Combined body-fin interference effect on the normal force
		double r = bodyRadius;
		double tau = r / (span + r);
		if (Double.isNaN(tau) || Double.isInfinite(tau)) {
			tau = 0;
		}
		// The isolated-fin CP, needed before the fin-in-body and body-in-fin loads
		// are separated.
		double finCp = macLead + calculateCPPos(conditions) * macLength;
		double x = finCp;
		// Cant is a wing-incidence case; the report selects chart 3 for rectangular
		// supersonic fins above beta*A=2 and equation 19 otherwise.
		double rollInterferenceFactor = NACA1307FinBodyInterference.calculateWingIncidenceFactor(
				tau, conditions.getMach(), ar, rectangularPlanform);
		boolean nacaActive = false;
		if (supersonicAero) {
			// PATCH (RASAero): exact NACA 1307 slender-body split.
			// K_W(B) multiplies the fin panels; K_B(W) is the body carryover,
			// weighted by the afterbody factor. Total <= (1+tau)^2.
			//
			// This is the opt-in RASAero path only. Upstream's complete model
			// below owns the default branch.
			double kwb = kWB1307(tau);
			double kbw = pow2(1 + tau) - kwb;
			cna *= kwb + afterbodyFactor * kbw;
		} else {
			// Upstream's complete NACA Report 1307 fin-body interference model,
			// blended into the scalar approximation outside its applicability
			// range.
			double isolatedCna = cna;
			double fallbackCna = isolatedCna * calculateBodyFinInterferenceFactor(tau, conditions.getMach());
			double nacaWeight = bodyFinInterference == null
					? 0.0 : calculateNacaApplicabilityWeight(conditions.getAOA());
			if (nacaWeight > 0.0) {
				double wingLiftCurveSlope = cna1 * conditions.getRefArea() / finArea;
				NACA1307FinBodyInterference.Result interference =
						bodyFinInterference.calculate(conditions.getMach(), wingLiftCurveSlope);
				double finCna = isolatedCna * interference.finFactor();
				/*
				 * In the planar supersonic regime bodyFactor is normalized by the
				 * caller's wing lift-curve slope. Multiplication by isolatedCna
				 * restores the report's absolute carryover load, so the cna1
				 * dependence cancels.
				 */
				double bodyCna = isolatedCna * interference.bodyFactor();
				double nacaCna = finCna + bodyCna;
				double fallbackMoment = fallbackCna * finCp;
				double nacaMoment = finCna * finCp + bodyCna * interference.bodyCp();
				cna = fallbackCna + nacaWeight * (nacaCna - fallbackCna);
				if (cna > MathUtil.EPSILON) {
					x = (fallbackMoment + nacaWeight * (nacaMoment - fallbackMoment)) / cna;
				}
				nacaActive = true;
			} else {
				cna = fallbackCna;
			}
		}
		//		logger.debug("Component cna = {}", cna);
		
		// TODO: LOW: check for fin tip mach cone interference
		// (Barrowman thesis pdf-page 40)
		
		// TODO: LOW: fin-fin mach cone effect, MIL-HDBK page 5-25
		
		// Calculate roll forces, reduce forcing above stall angle
		
		// Without body-fin interference effect:
		//		forces.CrollForce = fins * (macSpan+r) * cna1 * component.getCantAngle() / 
		//			conditions.getRefLength();
		// The body-in-fin lift does not act through the canted fin surface.  Cant
		// therefore uses the selected lowercase NACA wing-incidence factor.
		forces.setCrollForce((macSpan + r) * cna1 * rollInterferenceFactor * cantAngle
				/ conditions.getRefLength());
		
		if (conditions.getAOA() > STALL_ANGLE) {
			forces.setCrollForce(forces.getCrollForce() * MathUtil.clamp(
					1 - (conditions.getAOA() - STALL_ANGLE) / (STALL_ANGLE / 2), 0, 1));
		}
		forces.setCrollDamp(calculateDampingMoment(conditions));
		forces.setCroll(forces.getCrollForce() - forces.getCrollDamp());
		
		// PATCH (RASAero, see engine-java/patches/LEDGER.md): opt-in Rogers
		// Modified Barrowman body-in-presence-of-fins carryover (Kbf), after Ken
		// Karbon, Apogee Peak of Flight 687. Slender-body theory (NACA 1307) puts
		// the total fin+body-carryover load at (1+tau)^2 * (fin-alone); with the
		// fins credited Kfb=(1+tau), the body carryover that completes that total
		// is tau*(1+tau)*(fin-alone) = tau*cna. Here cna is the fallback value from
		// calculateBodyFinInterferenceFactor, which is (1+tau) only at and above
		// CNA_SUPERSONIC; below that it already includes some or all of the body
		// carryover. The term acts on the body near the fin root; placed at the
		// root quarter-chord (forward of the swept-fin MAC) it moves the total CP
		// aft, which raises the static margin the app displays: margin is
		// (xCP-xCG)/d with x measured aft. Aft is the closer answer for the
		// geometries the term was validated against, not the safer one: on an
		// erroneously aft CP it overstates the margin. Flag off ⇒ classic CP/CNa.
		// average() returns CoordinateIF, so cp is held as the interface type.
		CoordinateIF cp = new Coordinate(x, 0, 0, cna);
		// Suppressed while supersonicAero is on or upstream's complete model is
		// active (nacaActive): both already carry the full body carryover, so
		// adding Kbf on top would double-count.
		if (rogersKbf && !supersonicAero && !nacaActive && tau > 0) {
			double rootLead = chordLead[0];
			double rootTrail = chordTrail[0];
			double xCarry = x;
			if (!Double.isNaN(rootLead) && !Double.isInfinite(rootLead) &&
					!Double.isNaN(rootTrail) && !Double.isInfinite(rootTrail)) {
				xCarry = rootLead + 0.25 * (rootTrail - rootLead);
			}
			cp = cp.average(new Coordinate(xCarry, 0, 0, tau * cna));
		}
		forces.setCN(cp.getWeight() * MathUtil.min(conditions.getAOA(), STALL_ANGLE));
		forces.setCP(cp);
		forces.setCm(forces.getCN() * cp.getX() / conditions.getRefLength());
		
		/*
		 * TODO: HIGH:  Compute actual side force and yaw moment.
		 * This is not currently performed because it produces strange results for
		 * stable rockets that have two fins in the front part of the fuselage,
		 * where the rocket flies at an ever-increasing angle of attack.  This may
		 * be due to incorrect computation of pitch/yaw damping moments.
		 */
		//		if (fins == 1 || fins == 2) {
		//			forces.Cside = fins * cna1 * Math.cos(theta-angle) * Math.sin(theta-angle);
		//			forces.Cyaw = fins * forces.Cside * x / conditions.getRefLength();
		//		} else {
		//			forces.Cside = 0;
		//			forces.Cyaw = 0;
		//		}
		forces.setCside(0);
		forces.setCyaw(0);
		
	}
	
	/**
	 * Returns the MAC length of the fin.  This is required in the friction drag
	 * computation.
	 * 
	 * @return  the MAC length of the fin.
	 */
	public double getMACLength() {
		return macLength;
	}
	
	public double getMidchordPos() {
		return macLead + 0.5 * macLength;
	}
	
	/**
	 * Pre-calculates the fin geometry values.
	 */
	protected void calculateFinGeometry(FinSet component) {

		geometryWarnings.clear();

		span = component.getSpan();
		finArea = component.getPlanformArea();
		if (finArea < MathUtil.EPSILON) {
			geometryWarnings.add(Warning.ZERO_AREA_FIN, component);
			ar = 0;
		} else {
			ar = 2 * pow2(span) / finArea;
		}

		// Check geometry; don't consider points along fin root for this
		// (doing so will cause spurious jagged fin warnings)
		CoordinateIF[] points = component.getFinPoints();
		boolean down = false;
		for (int i = 1; i < points.length; i++) {
			if ((points[i].getY() > points[i - 1].getY() + 0.001) && down) {
				geometryWarnings.add(Warning.JAGGED_EDGED_FIN, component);
				break;
			}
			if (points[i].getY() < points[i - 1].getY() - 0.001) {
				down = true;
			}
		}

		if ((bodyRadius > 0) && (thickness > bodyRadius / 2)){
			// Add warnings  (radius/2 == diameter/4)
			geometryWarnings.add(Warning.THICK_FIN, component);
		}
		
		// Calculate the chord lead and trail positions and length.  We do need the points
		// along the root for this
		points = component.getFinPointsWithRoot();
		Arrays.fill(chordLead, Double.POSITIVE_INFINITY);
		Arrays.fill(chordTrail, Double.NEGATIVE_INFINITY);
		Arrays.fill(chordLength, 0);
		
		for (int point = 1; point < points.length; point++) {
			double x1 = points[point - 1].getX();
			double y1 = points[point - 1].getY();
			double x2 = points[point].getX();
			double y2 = points[point].getY();
			
			// Don't use the default EPSILON since it is too small
			// and causes too much numerical instability in the computation of x below
			if (MathUtil.equals(y1, y2, 0.001))
				continue;
			
			int i1 = (int) (y1 * 1.0001 / span * (DIVISIONS - 1));
			int i2 = (int) (y2 * 1.0001 / span * (DIVISIONS - 1));
			i1 = MathUtil.clamp(i1, 0, DIVISIONS - 1);
			i2 = MathUtil.clamp(i2, 0, DIVISIONS - 1);
			if (i1 > i2) {
				int tmp = i2;
				i2 = i1;
				i1 = tmp;
			}
			
			for (int i = i1; i <= i2; i++) {
				// Intersection point (x,y)
				// Note that y can be outside the bounds of the line
				// defined by (x1, y1) (x2 y2) so x can similarly be outside
				// the bounds.  If the line is nearly horizontal, it can be
				// 'way outside.  We want to get the whole "strip", so we
				// don't clamp y; however, we do clamp x to avoid numerical
				// instabilities
				double y = i * span / (DIVISIONS - 1);
				double x = MathUtil.clamp((y - y2) / (y1 - y2) * x1 + (y1 - y) / (y1 - y2) * x2,
										  Math.min(x1, x2), Math.max(x1, x2));
				if (x < chordLead[i])
					chordLead[i] = x;
				if (x > chordTrail[i])
					chordTrail[i] = x;
				
				// TODO: LOW:  If fin point exactly on chord line, might be counted twice:
				if (y1 < y2) {
					chordLength[i] -= x;
				} else {
					chordLength[i] += x;
				}
			}
		}
		
		// Check and correct any inconsistencies
		for (int i = 0; i < DIVISIONS; i++) {
			if (Double.isInfinite(chordLead[i]) || Double.isInfinite(chordTrail[i]) ||
					Double.isNaN(chordLead[i]) || Double.isNaN(chordTrail[i])) {
				chordLead[i] = 0;
				chordTrail[i] = 0;
			}
			if (chordLength[i] < 0 || Double.isNaN(chordLength[i])) {
				chordLength[i] = 0;
			}
			if (chordLength[i] > chordTrail[i] - chordLead[i]) {
				chordLength[i] = chordTrail[i] - chordLead[i];
			}
		}
		
		/* Calculate fin properties:
		 * 
		 * macLength // MAC length
		 * macLead   // MAC leading edge position
		 * macSpan   // MAC spanwise position
		 * ar        // Fin aspect ratio (already set)
		 * span      // Fin span (already set)
		 */
		macLength = 0;
		macLead = 0;
		macSpan = 0;
		cosGamma = 0;
		cosGammaLead = 0;
		rollSum = 0;
		double area = 0;
		double radius = component.getFinFront().getY();
		
		final double dy = span / (DIVISIONS - 1);
		for (int i = 0; i < DIVISIONS; i++) {
			double length = chordTrail[i] - chordLead[i];
			double y = i * dy;
			
			macLength += length * length;
			macSpan += y * length;
			macLead += chordLead[i] * length;
			area += length;
			rollSum += chordLength[i] * pow2(radius + y);
			
			if (i > 0) {
				double dx = (chordTrail[i] + chordLead[i]) / 2 - (chordTrail[i - 1] + chordLead[i - 1]) / 2;
				double hypot = MathUtil.hypot(dx, dy);
				if (hypot != 0) {
					cosGamma += dy / hypot;
				}

				dx = chordLead[i] - chordLead[i - 1];
				hypot = MathUtil.hypot(dx, dy);
				if (hypot != 0) {
					cosGammaLead += dy / hypot;
				}
			}
		}
		
		macLength *= dy;
		//logger.debug("macLength = {}", macLength);
		macSpan *= dy;
		macLead *= dy;
		area *= dy;
		rollSum *= dy;
		if (area > MathUtil.EPSILON) {
			macLength /= area;
			macSpan /= area;
			macLead /= area;
		} else {
			macLength = 0;
			macSpan = 0;
			macLead = 0;
		}
		cosGamma /= (DIVISIONS - 1);
		cosGammaLead /= (DIVISIONS - 1);
	}
	
	///////////////  CNa1 calculation  ////////////////
	
	private static final double CNA_SUBSONIC = 0.9;
	private static final double CNA_SUPERSONIC = 1.5;
	private static final double CNA_SUPERSONIC_B = pow(pow2(CNA_SUPERSONIC) - 1, 1.5);
	private static final double GAMMA = 1.4;
	private static final LinearInterpolator K1, K2, K3;
	private static final PolyInterpolator cnaInterpolator = new PolyInterpolator(
			new double[] { CNA_SUBSONIC, CNA_SUPERSONIC },
			new double[] { CNA_SUBSONIC, CNA_SUPERSONIC },
			new double[] { CNA_SUBSONIC });
	/* Pre-calculate the values for K1, K2 and K3 */
	static {
		// Up to Mach 5
		int n = (int) ((5.0 - CNA_SUPERSONIC) * 10);
		double[] x = new double[n];
		double[] k1 = new double[n];
		double[] k2 = new double[n];
		double[] k3 = new double[n];
		for (int i = 0; i < n; i++) {
			double M = CNA_SUPERSONIC + i * 0.1;
			double beta = MathUtil.safeSqrt(M * M - 1);
			x[i] = M;
			k1[i] = 2.0 / beta;
			k2[i] = ((GAMMA + 1) * pow(M, 4) - 4 * pow2(beta)) / (4 * pow(beta, 4));
			k3[i] = ((GAMMA + 1) * pow(M, 8) + (2 * pow2(GAMMA) - 7 * GAMMA - 5) * pow(M, 6) +
					10 * (GAMMA + 1) * pow(M, 4) + 8) / (6 * pow(beta, 7));
		}
		K1 = new LinearInterpolator(x, k1);
		K2 = new LinearInterpolator(x, k2);
		K3 = new LinearInterpolator(x, k3);
	}

	/**
	 * Build the complete NACA model only for the constant-radius trapezoidal
	 * geometries covered by Report 1307.  Other fin and parent shapes continue
	 * through the documented scalar fallback.
	 */
	private NACA1307FinBodyInterference createBodyFinInterferenceModel(FinSet finSet) {
		if (!(finSet instanceof TrapezoidFinSet trapezoidFinSet)
				|| !(finSet.getParent() instanceof BodyTube bodyTube)) {
			return null;
		}

		double finFront = finSet.getAxialFront();
		if (finFront < -MathUtil.EPSILON) {
			return null;
		}

		double bodyEnd = calculateCylindricalAfterbodyEnd(finSet, bodyTube);
		NACA1307FinBodyInterference model = new NACA1307FinBodyInterference(
				bodyRadius, span, trapezoidFinSet.getRootChord(), trapezoidFinSet.getTipChord(),
				trapezoidFinSet.getSweep(), ar, bodyEnd);
		return model.isApplicable() ? model : null;
	}

	/**
	 * Determine the constant-radius afterbody available to the NACA pressure
	 * integration.  Consecutive, flush body tubes in the same component assembly
	 * are physically one cylinder and therefore remain part of the afterbody.
	 *
	 * <p>The walk deliberately stops at stage/assembly boundaries and at every
	 * transition, gap, or radius change.  This avoids counting components whose
	 * active state may differ after staging and avoids extending the cylindrical
	 * theory over a boattail.</p>
	 */
	static double calculateCylindricalAfterbodyEnd(FinSet finSet, BodyTube bodyTube) {
		double finFront = finSet.getAxialOffset(AxialMethod.ABSOLUTE);
		double cylinderRadius = bodyTube.getAftRadius();
		double bodyEnd = bodyTube.getAxialOffset(AxialMethod.ABSOLUTE) + bodyTube.getLength();
		BodyTube currentTube = bodyTube;

		while (true) {
			SymmetricComponent candidate = currentTube.getNextSymmetricComponent();
			if (!(candidate instanceof BodyTube nextTube)
					|| nextTube.getParent() != bodyTube.getParent()) {
				break;
			}

			double nextStart = nextTube.getAxialOffset(AxialMethod.ABSOLUTE);
			if (!MathUtil.equals(bodyEnd, nextStart)
					|| !MathUtil.equals(nextTube.getForeRadius(), cylinderRadius)
					|| !MathUtil.equals(nextTube.getAftRadius(), cylinderRadius)) {
				break;
			}

			bodyEnd = nextStart + nextTube.getLength();
			currentTube = nextTube;
		}

		return bodyEnd - finFront;
	}

	/**
	 * Fade linear NACA interference into the established post-stall fallback.
	 *
	 * @param angleOfAttack unsigned angle of attack in radians
	 * @return NACA blend weight from zero (fallback only) to one (full NACA model),
	 *         or zero for invalid input
	 */
	static double calculateNacaApplicabilityWeight(double angleOfAttack) {
		if (!Double.isFinite(angleOfAttack) || angleOfAttack < 0.0
				|| angleOfAttack >= STALL_ANGLE) {
			return 0.0;
		}
		if (angleOfAttack <= NACA_LINEAR_ANGLE) {
			return 1.0;
		}

		double fraction = (angleOfAttack - NACA_LINEAR_ANGLE)
				/ (STALL_ANGLE - NACA_LINEAR_ANGLE);
		double smoothFraction = fraction * fraction * (3.0 - 2.0 * fraction);
		return 1.0 - smoothFraction;
	}

	/**
	 * Calculate the fallback combined fin-in-body and body-in-fin normal-force multiplier.
	 *
	 * <p>For slender configurations, equations 14 and 21 of NACA Report 1307
	 * combine to {@code (1 + tau)^2}.  This approximation is retained for fin
	 * planforms and parent-body geometries outside the complete NACA model's
	 * assumptions.  Its body contribution is blended out over the existing
	 * transonic CNa interval, while the classical fin term remains.</p>
	 *
	 * @param tau body radius divided by the fin semispan measured from the rocket axis
	 * @param mach flight Mach number
	 * @return total body-fin interference multiplier
	 * @see <a href="https://ntrs.nasa.gov/citations/19930091008">NACA Report 1307</a>
	 */
	static double calculateBodyFinInterferenceFactor(double tau, double mach) {
		double finInBodyFactor = 1 + tau;
		if (mach <= CNA_SUBSONIC) {
			return pow2(finInBodyFactor);
		}
		if (mach >= CNA_SUPERSONIC) {
			return finInBodyFactor;
		}

		double bodyInFinFactor = tau * finInBodyFactor;
		double bodyContributionWeight = (CNA_SUPERSONIC - mach) / (CNA_SUPERSONIC - CNA_SUBSONIC);
		return finInBodyFactor + bodyContributionWeight * bodyInFinFactor;
	}
	
	protected double calculateFinCNa1(FlightConditions conditions) {
		double mach = conditions.getMach();
		double ref = conditions.getRefArea();
		double alpha = MathUtil.min(conditions.getAOA(),
				Math.PI - conditions.getAOA(), STALL_ANGLE);

		if (finArea < MathUtil.EPSILON || span < MathUtil.EPSILON || cosGamma < MathUtil.EPSILON) {
			return 0;
		}

		// Subsonic case
		if (mach <= CNA_SUBSONIC) {
			return 2 * Math.PI * pow2(span) / (1 + MathUtil.safeSqrt(1 + (1 - pow2(mach)) *
					pow2(pow2(span) / (finArea * cosGamma)))) / ref;
		}
		
		// Supersonic case
		if (mach >= CNA_SUPERSONIC) {
			if (supersonicAero) {
				// PATCH (RASAero): analytic Busemann terms (no grid,
				// no M4.9 clamp) scaled to the 2D 4/beta level with the standard
				// finite-span tip correction.
				return finArea * ssaeroScale(mach) * (k1Analytic(mach) + k2Analytic(mach) * alpha +
						k3Analytic(mach) * pow2(alpha)) / ref;
			}
			return finArea * (K1.getValue(mach) + K2.getValue(mach) * alpha +
					K3.getValue(mach) * pow2(alpha)) / ref;
		}

		// Transonic case, interpolate
		double subV, superV;
		double subD, superD;

		double sq = MathUtil.safeSqrt(1 + (1 - pow2(CNA_SUBSONIC)) * pow2(span * span / (finArea * cosGamma)));
		subV = 2 * Math.PI * pow2(span) / ref / (1 + sq);
		subD = 2 * CNA_SUBSONIC * Math.PI * pow(span, 6) / (pow2(finArea * cosGamma) * ref *
				sq * pow2(1 + sq));

		// (RASAero: the supersonic endpoint of the bridge scales with the
		// corrected level so the transonic interpolation stays continuous.)
		double sscale = supersonicAero ? ssaeroScale(CNA_SUPERSONIC) : 1.0;
		superV = sscale * finArea * (K1.getValue(CNA_SUPERSONIC) + K2.getValue(CNA_SUPERSONIC) * alpha +
				K3.getValue(CNA_SUPERSONIC) * pow2(alpha)) / ref;
		superD = sscale * (-finArea / ref * 2 * CNA_SUPERSONIC / CNA_SUPERSONIC_B);

		return cnaInterpolator.interpolate(mach, subV, superV, subD, superD, 0);
	}

	/**
	 * PATCH (RASAero): flag-on scale factor turning the kernel's
	 * single-surface Busemann level (K1 = 2/beta) into 2D linear theory
	 * (4/beta) with the finite-span tip correction (1 - 1/(2*AR*beta)),
	 * floored at 0.25 for very low AR*beta where the linear result degrades.
	 */
	private double ssaeroScale(double mach) {
		double beta = MathUtil.safeSqrt(mach * mach - 1);
		double corr = Math.max(1 - 1 / (2 * ar * beta), 0.25);
		return 2 * corr;
	}

	/**
	 * PATCH (RASAero): sweep relief on fin thickness wave drag.
	 * <p>
	 * The simple-sweep cos^2(Gamma_LE) relief is only valid while the leading
	 * edge is subsonic-normal (Mn = M*cos Gamma &lt; 1); once the LE goes sonic
	 * the independence principle fails and the section behaves 2D at the
	 * streamwise Mach (Puckett-Stewart supersonic-LE wings approach the unswept
	 * 4 tau^2/beta level; DATCOM 4.1.5.1's sweep charts show the same collapse).
	 * Applying cos^2 at every Mach gives NACA RM A53D02, whose fins have
	 * tan Gamma_LE = 3 exactly (cos^2 = 0.100), a fin wave drag of 0.00053 at M5
	 * where ~0.005 is right. So the factor is cos^2 up to Mn 0.9, blends to the
	 * sheared-wing value over Mn 0.9-1.05, and follows it above.
	 * <p>
	 * beta*cos Gamma / beta_n is the sheared-wing strip result
	 * K (tau/cos Gamma)^2/beta_n * cos^3 Gamma rewritten as a factor on the
	 * code's unswept K tau^2/beta; it tends to 1 as M grows and is capped at 1
	 * so sweep never increases thickness drag in this model.
	 * Unswept fins (cos Gamma = 1) return 1 at every Mach, the same as
	 * pow2(cosGammaLead).
	 */
	private double sweepWaveFactor(double mach) {
		double c2 = pow2(cosGammaLead);
		double mn = mach * cosGammaLead;
		if (mn <= 0.9) {
			return c2;
		}
		if (mn < 1.05) {
			double t = (mn - 0.9) / 0.15;
			double s = t * t * (3 - 2 * t);
			return c2 + (1 - c2) * s;
		}
		double beta = MathUtil.safeSqrt(mach * mach - 1);
		double betaN = MathUtil.safeSqrt(mn * mn - 1);
		return Math.min(1.0, Math.max(c2, beta * cosGammaLead / betaN));
	}

	/** PATCH (RASAero): thickness-wave transonic band edges. */
	private static final double WAVE_ONSET_MACH = 0.90;
	private static final double WAVE_PEAK_MACH = 1.05;
	/**
	 * PATCH (RASAero): the transonic similarity parameter
	 * K = (M^2-1)/[(gamma+1) M^2 tau]^(2/3) at which the linearized thickness
	 * wave drag is taken to be trustworthy. K &gt;~ 1 is the textbook validity
	 * criterion for linearized (Ackeret) supersonic thin-section theory
	 * (transonic small-disturbance similarity: Liepmann &amp; Roshko
	 * "Elements of Gasdynamics" ch. 12; Ashley &amp; Landahl "Aerodynamics of
	 * Wings and Bodies" ch. 12). 1.0 is the criterion itself, not a fit to the
	 * anchors.
	 */
	private static final double SS_TRANSONIC_K = 1.0;

	/**
	 * PATCH (RASAero): effective beta for linearized thickness wave
	 * drag, floored at the transonic-similarity limit.
	 * <p>
	 * beta_T = sqrt(K) * [(gamma+1) M^2 tau]^(1/3) is the free-stream beta at
	 * which the similarity parameter equals K, so flooring beta there freezes
	 * the branch at its last trustworthy value instead of letting the 1/beta
	 * singularity run away as M -&gt; 1+. The frozen value is
	 * factor*tau^2/[(gamma+1)tau]^(1/3) ~ tau^(5/3), which is the classic
	 * transonic-similarity scaling of the peak section wave drag; the law
	 * comes out of the floor rather than being asserted.
	 */
	private static double betaEffThickness(double mach, double tau) {
		double beta = MathUtil.safeSqrt(mach * mach - 1);
		double betaT = Math.sqrt(SS_TRANSONIC_K)
				* pow((GAMMA + 1) * mach * mach * tau, 1.0 / 3.0);
		return Math.max(beta, betaT);
	}

	/**
	 * PATCH (RASAero): transonic shape of the linearized thickness wave drag,
	 * built the same way as the boat-tail wave drag in SymmetricComponentCalc.
	 * <p>
	 * The branch factor*tau^2/beta decreases with Mach (for the ARCAS fin it is
	 * 2.07x larger at M1.05 than at M1.20), so a linear ramp from zero at M0.9
	 * up to the branch value at M1.2 would peak at M1.2, the top of its own
	 * bridge, while the physics it bridges onto is already falling; the ARCAS
	 * Long tunnel total falls 0.085 over that interval. The shape used instead:
	 * <pre>
	 *   M &lt;= 0.90        zero (profile drag lives in the friction form factor)
	 *   0.90 -&gt; 1.05     smoothstep rise to the transonic peak
	 *   M &gt;= 1.05        factor*tau^2/beta_eff, monotone decreasing in M
	 * </pre>
	 * M0.90/M1.05 are RASAero's own regime boundaries (RASAero II Users Manual
	 * p.90: Subsonic M0.01-0.90, Transonic M0.91-1.04, Supersonic-Hypersonic
	 * from M1.05), and the peak height is set by the similarity floor in
	 * {@link #betaEffThickness} rather than by the band edge. Above the Mach
	 * where beta exceeds the floor (M ~ 1.13 for a 4.4 % section) the result is
	 * the plain factor*tau^2/beta branch.
	 */
	private double thicknessWave(double mach, double factor, double tau) {
		if (mach <= WAVE_ONSET_MACH || tau <= 0) {
			return 0;
		}
		double peak = factor * tau * tau / betaEffThickness(WAVE_PEAK_MACH, tau);
		if (mach >= WAVE_PEAK_MACH) {
			return factor * tau * tau / betaEffThickness(mach, tau);
		}
		double t = (mach - WAVE_ONSET_MACH) / (WAVE_PEAK_MACH - WAVE_ONSET_MACH);
		return peak * t * t * (3 - 2 * t);
	}

	private static double k1Analytic(double M) {
		return 2.0 / MathUtil.safeSqrt(M * M - 1);
	}

	private static double k2Analytic(double M) {
		double beta = MathUtil.safeSqrt(M * M - 1);
		return ((GAMMA + 1) * pow(M, 4) - 4 * pow2(beta)) / (4 * pow(beta, 4));
	}

	private static double k3Analytic(double M) {
		double beta = MathUtil.safeSqrt(M * M - 1);
		return ((GAMMA + 1) * pow(M, 8) + (2 * pow2(GAMMA) - 7 * GAMMA - 5) * pow(M, 6) +
				10 * (GAMMA + 1) * pow(M, 4) + 8) / (6 * pow(beta, 7));
	}

	/**
	 * PATCH (RASAero): NACA Report 1307 Eq. (14), the exact
	 * slender-body wing-in-presence-of-body factor K_W(B) for radius/span
	 * ratio lambda = r/(s+r). Limits: 1 as lambda→0, 2 as lambda→1.
	 */
	private static double kWB1307(double lam) {
		if (lam <= MathUtil.EPSILON) {
			return 1;
		}
		if (lam >= 1 - 1e-9) {
			return 2;
		}
		double num = (1 + pow(lam, 4)) * (0.5 * Math.atan(0.5 * (1 / lam - lam)) + Math.PI / 4)
				- pow2(lam) * ((1 / lam - lam) + 2 * Math.atan(lam));
		return (2 / Math.PI) * num / pow2(1 - lam);
	}
	
	private double calculateDampingMoment(FlightConditions conditions) {
		double rollRate = conditions.getRollRate();
		
		if (Math.abs(rollRate) < 0.1)
			return 0;
		
		double mach = conditions.getMach();
		double absRate = Math.abs(rollRate);
		
		/*
		 * At low speeds and relatively large roll rates (i.e. near apogee) the
		 * fin tips rotate well above stall angle.  In this case sum the chords
		 * separately.
		 */
		if (absRate * (bodyRadius + span) / conditions.getVelocity() > 15 * Math.PI / 180) {
			double sum = 0;
			for (int i = 0; i < DIVISIONS; i++) {
				double dist = bodyRadius + span * i / DIVISIONS;
				double aoa = Math.min(absRate * dist / conditions.getVelocity(), 15 * Math.PI / 180);
				sum += chordLength[i] * dist * aoa;
			}
			sum = sum * (span / DIVISIONS) * 2 * Math.PI / conditions.getBeta() /
					(conditions.getRefArea() * conditions.getRefLength());

			return MathUtil.sign(rollRate) * sum;
		}
		
		if (mach <= CNA_SUBSONIC) {
			return 2 * Math.PI * rollRate * rollSum /
					(conditions.getRefArea() * conditions.getRefLength() *
							conditions.getVelocity() * conditions.getBeta());
		}
		if (mach >= CNA_SUPERSONIC) {
			double vel = conditions.getVelocity();
			double k1 = K1.getValue(mach);
			double k2 = K2.getValue(mach);
			double k3 = K3.getValue(mach);
			
			double sum = 0;
			
			for (int i = 0; i < DIVISIONS; i++) {
				double y = i * span / (DIVISIONS - 1);
				double angle = rollRate * (bodyRadius + y) / vel;
				
				sum += (k1 * angle + k2 * angle * angle + k3 * angle * angle * angle)
						* chordLength[i] * (bodyRadius + y);
			}
			
			return sum * span / (DIVISIONS - 1) /
					(conditions.getRefArea() * conditions.getRefLength());
		}
		
		// Transonic, do linear interpolation
		FlightConditions cond = conditions.clone();
		cond.setMach(CNA_SUBSONIC - 0.01);
		double subsonic = calculateDampingMoment(cond);
		cond.setMach(CNA_SUPERSONIC + 0.01);
		double supersonic = calculateDampingMoment(cond);
		
		return subsonic * (CNA_SUPERSONIC - mach) / (CNA_SUPERSONIC - CNA_SUBSONIC) +
				supersonic * (mach - CNA_SUBSONIC) / (CNA_SUPERSONIC - CNA_SUBSONIC);
	}
	
	/**
	 * Return the relative position of the CP along the mean aerodynamic chord.
	 * Below mach 0.5 it is at the quarter chord, above mach 2 calculated using an
	 * empirical formula, between these two using an interpolation polynomial.
	 *
	 * @param cond   Mach speed used
	 * @return		 CP position along the MAC
	 */
	protected double calculateCPPos(FlightConditions cond) {
		double m = cond.getMach();

		if (m <= 0.5) {
			// At subsonic speeds CP at quarter chord
			return SUBSONIC_CP_POS;
		}
		if (m >= 2) {
			// At supersonic speeds use empirical formula
			return supersonicCPPos(ar * cond.getBeta());
		}

		// Use the shared shape-preserving interpolation between the two regimes.
		return transonicCPPos(m, ar);
	}
	
	
	//	@SuppressWarnings("null")
	//	public static void main(String arg[]) {
	//		Rocket rocket = TestRocket.makeRocket();
	//		FinSet finset = null;
	//		
	//		Iterator<RocketComponent> iter = rocket.deepIterator();
	//		while (iter.hasNext()) {
	//			RocketComponent c = iter.next();
	//			if (c instanceof FinSet) {
	//				finset = (FinSet)c;
	//				break;
	//			}
	//		}
	//		
	//		((TrapezoidFinSet)finset).setHeight(0.10);
	//		((TrapezoidFinSet)finset).setRootChord(0.10);
	//		((TrapezoidFinSet)finset).setTipChord(0.10);
	//		((TrapezoidFinSet)finset).setSweep(0.0);
	//
	//		
	//		FinSetCalc calc = new FinSetCalc(finset);
	//		
	//		calc.calculateFinGeometry();
	//		FlightConditions cond = new FlightConditions(new Configuration(rocket));
	//		for (double m=0; m < 3; m+=0.05) {
	//			cond.setMach(m);
	//			cond.setAOA(0.0*Math.PI/180);
	//			double cna = calc.calculateFinCNa1(cond);
	//			System.out.printf("%5.2f "+cna+"\n", m);
	//		}
	//		
	//	}

	@Override
	public double calculateFrictionCD(FlightConditions conditions, double componentCf, WarningSet warnings) {
		// a fin with 0 area contributes no drag
		if (finArea < MathUtil.EPSILON || macLength < MathUtil.EPSILON) {
			return 0.0;
		}

		double cd = componentCf * (1 + 2 * thickness / macLength) * 2 * finArea / conditions.getRefArea();
		// PATCH (RASAero): fin-in-presence-of-body interference drag, from
		// RASAero II's "Fin Interference" drag component. RASAero's own Run Test
		// output prints that component at ~0.84x the fin friction term at both
		// ends of its Mach range: RASAero II Users Manual p.90 (M0.50: Fin
		// Frict&Press 0.050, Fin Interference 0.042) and p.92 (M2.00: Fin Frict
		// 0.037, Fin Wave 0.067, Fin Interference 0.031). With the Kbf or
		// supersonic model on: +80% of the fin friction drag, Mach-flat. The
		// classic model, which matches desktop OpenRocket, does not apply it.
		//
		// What the 1.8x rests on:
		//  - It is not anchored to the ARCAS fins-on/fins-off increment. That
		//    increment (TN D-4013 CA,corr, Short: 0.073 / 0.078 / 0.080 at M0.60 /
		//    0.70 / 0.80) also contains the tunnel model's fin-anchor brackets,
		//    which RASAero books in a separate Protuberance column (manual p.92
		//    note), plus fin LE bluntness this kernel charges only when
		//    finLeRadius is given. It is an upper bound on fin+interference drag,
		//    not a calibration target; taken literally it asks for 2.08x / 2.25x /
		//    2.34x at M0.60 / 0.70 / 0.80. Even at 1.8x the fin increment is
		//    14-39% short of the measured one below M1.2.
		//  - It is not junction interference in the Hoerner sense: a junction is
		//    a corner effect whose drag area scales with t^2, while this scales
		//    with fin wetted area x Cf. The implied per-junction coefficient across
		//    the three finned validation cells is 0.92 (ARCAS), 0.47 (Basic
		//    Finner), 0.52 (RM A53D02), a factor of two apart and not tracking
		//    fin thickness.
		//  - Without it, most gated CD rows in validation/score.mjs move away
		//    from the data and both tester flights over-predict further.
		//
		// Mach-flat is the measured answer, not a simplification. A fade toward
		// 1.0 by M1.5-2, on the reasoning that junction / horseshoe-vortex
		// interference is a subsonic boundary-layer effect, does not fit:
		//  - This is not a junction term (see above), so that argument does not
		//    apply to it.
		//  - The only Mach-resolved measurement of the quantity is RASAero's
		//    printed Fin Interference component, and its ratio barely moves:
		//    0.042/0.050 = 0.840 at M0.50 (p.90) and 0.031/0.037 = 0.838 at M2.00
		//    (p.92). Both rows' components sum to the printed CD, and with
		//    3-decimal rounding the two ratio bands ([0.822, 0.859] and
		//    [0.813, 0.863]) overlap, so a constant ratio fits both. A fade to
		//    1.0x by M2 needs Fin Interference ~ 0 there; RASAero prints 0.031,
		//    4.9% of that run's total CD. (The subsonic column is "Fin
		//    Frict&Press" vs the supersonic "Fin Frict" alone, so any subsonic
		//    fin pressure would make the subsonic ratio higher, not lower.)
		//  - The ARCAS supersonic over-prediction is accounted for by body drag:
		//    the fins-off gates read the body high at M0.60, and that bias
		//    carried forward covers the supersonic overshoot before the fins are
		//    touched. Fading this term would offset a body error with fin drag.
		if (rogersKbf || supersonicAero) {
			cd *= 1.8;
		}
		return cd;
	}
	
	@Override
	public double calculatePressureCD(FlightConditions conditions,
									  double stagnationCD, double baseCD, WarningSet warnings) {

		// a fin with 0 area contributes no drag
		if (finArea < MathUtil.EPSILON) {
			return 0.0;
		}

		double mach = conditions.getMach();
		double cd = 0;

		// PATCH (RASAero): RASAero-class airfoil sections, with per-shape
		// linearized/Busemann thickness wave drag + blunt-base + LE bluntness.
		//
		// Gated on the Kbf or supersonic model, not merely on the input being
		// present. Desktop OpenRocket has no airfoilSection concept at all (its
		// FinSet knows only the three-valued CrossSection), so a classic
		// "OpenRocket - Extended Barrowman" run has to fall through to the
		// crossSection branch below, which matches desktop physics. Gated on the
		// input alone, a square-vs-doublewedge fin at M1.8 would read CD 0.585 vs
		// 0.303 in the classic model, a factor of ~1.9 on total CD.
		if (airfoilSection != null && (rogersKbf || supersonicAero)) {
			return sectionPressureCD(conditions, baseCD);
		}

		// PATCH (RASAero): a sharp streamlined (AIRFOIL) section has
		// no blunt leading edge, but the classic model charges it the swept-cylinder
		// LE drag plateau (~1.2 on the LE frontal area), which neither decays
		// with Mach nor belongs on a sharp section, and whose subsonic form
		// (1-M^2)^-0.417 blows up approaching M0.9 (a spurious early transonic
		// rise). Flag on: subsonic thickness/profile drag stays in the friction
		// form factor (1 + 2t/c); supersonic wave drag is thin-airfoil
		// K*4*(t/c)^2/beta (K = 4/3, biconvex), referenced to fin planform area.
		// Sharp TE ⇒ no base term. Scored against the ARCAS/Finner CD anchors.
		// thicknessWave() gives the transonic rise to a peak at M1.05 and the
		// decay along the branch above it.
		if (supersonicAero && crossSection == FinSet.CrossSection.AIRFOIL) {
			double tc = (macLength > MathUtil.EPSILON) ? thickness / macLength : 0;
			double wave = thicknessWave(mach, 16.0 / 3.0, tc);
			// Sweep relief fades out once the LE is supersonic-normal (see
			// sweepWaveFactor).
			return wave * sweepWaveFactor(mach) * finArea / conditions.getRefArea();
		}

		// Pressure fore-drag
		if (crossSection == FinSet.CrossSection.AIRFOIL ||
				crossSection == FinSet.CrossSection.ROUNDED) {

			// Round leading edge
			if (mach < 0.9) {
				cd = Math.pow(1 - pow2(mach), -0.417) - 1;
			} else if (mach < 1) {
				cd = 1 - 1.785 * (mach - 0.9);
			} else {
				cd = 1.214 - 0.502 / pow2(mach) + 0.1095 / pow2(pow2(mach));
			}

		} else if (crossSection == FinSet.CrossSection.SQUARE) {
			cd = stagnationCD;
		} else {
			throw new UnsupportedOperationException("Unsupported fin profile: " + crossSection);
		}

		// Slanted leading edge
		cd *= pow2(cosGammaLead);

		// Scale to correct reference area
		cd *= span * thickness / conditions.getRefArea();

		return cd;
	}

	@Override
	public double calculateComponentBaseCD(FlightConditions conditions,
										   double baseCD, WarningSet warnings) {
		// a fin with 0 area contributes no drag
		if (finArea < MathUtil.EPSILON) {
			return 0.0;
		}

		double cd = 0;

		// Trailing edge drag
		if (crossSection == FinSet.CrossSection.SQUARE) {
			cd = baseCD;
		} else if (crossSection == FinSet.CrossSection.ROUNDED) {
			cd = baseCD / 2;
		}
		// Airfoil assumed to have zero base drag

		// Scale to correct reference area
		cd *= span * thickness / conditions.getRefArea();

		return cd;
	}
	
	/**
	 * PATCH (RASAero): pressure drag for the RASAero airfoil
	 * sections. Linearized supersonic thin-airfoil thickness terms (DATCOM
	 * 4.1.5.1 / Hoerner lineage), referenced to fin planform area:
	 *
	 *   hexagonal:     tau^2/beta * (1/a1 + 1/a2)     (chamfer fractions a1, a2)
	 *   naca:          (16/3) tau^2/beta  + implicit LE radius 1.1019 tau^2 c
	 *   doublewedge:   tau^2 / (beta * m (1-m)),  m = LE diamond fraction
	 *   biconvex:      (16/3) tau^2/beta
	 *   hexbluntbase:  tau^2/beta * (1/a1)  + base
	 *   singlewedge:   tau^2/beta           + base
	 *
	 * Wave terms are zero subsonic (profile drag lives in the friction form
	 * factor) and rise through the transonic band: over M0.9-1.05 to a peak
	 * with the supersonic model on, as a linear ramp over M0.9-1.2 with only
	 * Kbf on. They are reduced for LE sweep. Blunt-base
	 * sections carry fin base drag baseCD*tau at all Mach (RASAero's "Fin
	 * Base" component). An explicit LE radius adds swept-cylinder bluntness
	 * drag on its 2r frontal height (the kernel's rounded-LE Mach fit).
	 */
	private double sectionPressureCD(FlightConditions conditions, double baseCD) {
		double mach = conditions.getMach();
		double tau = (macLength > MathUtil.EPSILON) ? thickness / macLength : 0;

		// chamfer/diamond fractions of chord; RASAero-style defaults when the
		// user leaves the lengths unset: symmetric (0.5) diamond, 1/3 chamfers.
		double a1 = (airfoilLeDiamond > 0 && macLength > MathUtil.EPSILON)
				? MathUtil.clamp(airfoilLeDiamond / macLength, 0.05, 0.95) : Double.NaN;
		double a2 = (airfoilTeDiamond > 0 && macLength > MathUtil.EPSILON)
				? MathUtil.clamp(airfoilTeDiamond / macLength, 0.05, 0.95) : Double.NaN;

		double thicknessFactor; // cd_wave = thicknessFactor * tau^2 / beta
		double baseFrac = 0;    // blunt-base height as a fraction of thickness
		double leR = finLeRadius;

		switch (airfoilSection) {
			case "hexagonal": {
				double f1 = Double.isNaN(a1) ? 1.0 / 3.0 : a1;
				double f2 = Double.isNaN(a2) ? 1.0 / 3.0 : a2;
				thicknessFactor = 1 / f1 + 1 / f2;
				break;
			}
			case "naca":
				thicknessFactor = 16.0 / 3.0;
				leR = 1.1019 * tau * tau * macLength; // implicit NACA nose radius
				break;
			case "doublewedge": {
				double m = Double.isNaN(a1) ? 0.5 : MathUtil.clamp(a1, 0.1, 0.9);
				thicknessFactor = 1 / (m * (1 - m));
				break;
			}
			case "biconvex":
				thicknessFactor = 16.0 / 3.0;
				break;
			case "hexbluntbase": {
				double f1 = Double.isNaN(a1) ? 1.0 / 3.0 : a1;
				thicknessFactor = 1 / f1;
				baseFrac = 1;
				break;
			}
			case "singlewedge":
				thicknessFactor = 1;
				baseFrac = 1;
				break;
			default:
				throw new UnsupportedOperationException(
						"Unknown fin airfoil section: " + airfoilSection);
		}

		// Supersonic thickness wave drag. With supersonicAero on, thicknessWave()
		// gives the rise/peak/decay shape (see its javadoc). With only Kbf on,
		// the term ramps linearly from zero at M0.9 to the branch value at M1.2.
		double wave = 0;
		if (supersonicAero) {
			wave = thicknessWave(mach, thicknessFactor, tau);
		} else if (mach > 0.9 && tau > 0) {
			double beta12 = MathUtil.safeSqrt(1.2 * 1.2 - 1);
			double wave12 = thicknessFactor * tau * tau / beta12;
			if (mach >= 1.2) {
				double beta = MathUtil.safeSqrt(mach * mach - 1);
				wave = thicknessFactor * tau * tau / beta;
			} else {
				wave = wave12 * (mach - 0.9) / 0.3;
			}
		}
		// The LE-sonic fade of the sweep relief (sweepWaveFactor) applies only
		// with supersonicAero; with only Kbf on, the plain cos^2 relief is used.
		wave *= supersonicAero ? sweepWaveFactor(mach) : pow2(cosGammaLead);

		// Blunt trailing edge: fin base drag on the base frontal height.
		double base = baseFrac * baseCD * tau;

		// Blunt leading edge: swept-cylinder drag on the 2r frontal height
		// (kernel rounded-LE Mach fit), force reduced by sweep.
		double le = 0;
		if (leR > 0 && macLength > MathUtil.EPSILON) {
			double cdLE;
			if (mach < 0.9) {
				cdLE = Math.pow(1 - pow2(mach), -0.417) - 1;
			} else if (mach < 1) {
				cdLE = 1 - 1.785 * (mach - 0.9);
			} else {
				cdLE = 1.214 - 0.502 / pow2(mach) + 0.1095 / pow2(pow2(mach));
			}
			le = cdLE * pow2(cosGammaLead) * (2 * leR / macLength);
		}

		return (wave + base + le) * finArea / conditions.getRefArea();
	}

	private void calculateInterferenceFinCount(FinSet component) {
		RocketComponent parent = component.getParent();
		if (parent == null) {
			throw new IllegalStateException("fin set without parent component");
		}
		
		double lead = component.toRelative(Coordinate.NUL, parent)[0].getX();
		double trail = component.toRelative(new Coordinate(component.getLength()),
				parent)[0].getX();
		
		/*
		 * The counting fails if the fin root chord is very small, in that case assume
		 * no other fin interference than this fin set.
		 */
		if (trail - lead < 0.007) {
			interferenceFinCount = finCount;
		} else {
			interferenceFinCount = 0;
			for (RocketComponent c : parent.getChildren()) {
				if (c instanceof FinSet) {
					double finLead = c.toRelative(Coordinate.NUL, parent)[0].getX();
					double finTrail = c.toRelative(new Coordinate(c.getLength()), parent)[0].getX();
					
					// Compute overlap of the fins
					
					if ((finLead < trail - 0.005) && (finTrail > lead + 0.005)) {
						interferenceFinCount += ((FinSet) c).getFinCount();
					}
				}
			}
		}
		if (interferenceFinCount < component.getFinCount()) {
			throw new BugException("Counted " + interferenceFinCount + " parallel fins, " +
					"when component itself has " + component.getFinCount() +
					", fin points=" + Arrays.toString(component.getFinPoints()));
		}
	}
	
}
