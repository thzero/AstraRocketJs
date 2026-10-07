package api;

import info.openrocket.core.rocketcomponent.FlightConfiguration;
import info.openrocket.core.rocketcomponent.LaunchLug;
import info.openrocket.core.rocketcomponent.RailButton;
import info.openrocket.core.rocketcomponent.RocketComponent;
import info.openrocket.core.simulation.FlightEvent;
import info.openrocket.core.simulation.SimulationStatus;
import info.openrocket.core.simulation.exception.SimulationException;
import info.openrocket.core.simulation.listeners.AbstractSimulationListener;
import info.openrocket.core.util.Coordinate;
import info.openrocket.core.util.CoordinateIF;

import java.util.ArrayList;
import java.util.List;

/**
 * The guide-aware launch rod clearance model, as an opt-in listener.
 *
 * <h2>What upstream does</h2>
 *
 * {@code SimulationStatus} computes an effective rod length from the launch
 * lugs, and {@code BasicEventSimulationEngine} then compares travel with the
 * FULL rod length and never reads that effective one (its only consumer in the
 * whole kernel is the NaN guard). So a guide sitting above the rocket's aft end
 * gets guided travel it does not have, and the rod-exit speed reads high.
 * Rail buttons are not considered at all, and the lug search looks at one
 * instance, which for a fore/aft pair is the FORWARD one.
 *
 * <h2>A rod and a rail are guided differently</h2>
 *
 * A LUG is a tube threaded onto the rod, so one of them holds the rocket's
 * angle by itself and it guides until its aft end leaves the rod. A BUTTON is a
 * stud in a slot and holds nothing on its own: the rocket is only constrained
 * while TWO buttons of the same line are in the rail, so a rail guides until the
 * SECOND-TO-LAST button station leaves it, and one button, or several side by
 * side at one station, guides not at all. The two cannot be one rule.
 *
 * <h2>Why this is a listener and not a patch</h2>
 *
 * The kernel already has every hook this needs, so the divergence costs no
 * patched files and the default path stays byte-identical to upstream:
 *
 * <ul>
 * <li>{@code firePostStep} runs BEFORE the engine's own clearance check and is
 * handed the mutable status, so the event can be added earlier.</li>
 * <li>Handling a {@code LAUNCHROD} event does nothing but
 * {@code setLaunchRodCleared(true)}, and the engine's own check is guarded on
 * {@code !isLaunchRodCleared()}, so ours suppresses the engine's later one
 * rather than fighting it.</li>
 * <li>Both steppers key the rod constraint entirely on
 * {@code isLaunchRodCleared()}, so an earlier event really does release the
 * rocket earlier. Reporting a lower speed without releasing it would leave the
 * rocket mechanically constrained past its own departure.</li>
 * <li>{@code FlightData} interpolates {@code launchRodVelocity} at the
 * {@code LAUNCHROD} event's time against the velocity series, so the reported
 * speed follows the event with no arithmetic of ours.</li>
 * </ul>
 *
 * When the option is off the listener is not attached at all, so there is
 * nothing to switch off and nothing to get wrong.
 */
final class GuideClearanceListener extends AbstractSimulationListener {

	/**
	 * The distance the rocket travels while still on the rod or rail, or NaN
	 * until a branch has started. Per-branch, and only the first branch can still
	 * be on the rod: a later one inherits {@code launchRodCleared} from the status
	 * it was split off.
	 */
	private double effectiveLength = Double.NaN;

	/** Where this branch started, the same value the engine subtracts. */
	private CoordinateIF origin = null;

	/**
	 * A SYSTEM listener, so touching the status does not raise
	 * {@code Warning.LISTENERS_AFFECTED} on every flight. This is part of how the
	 * engine was configured to run, not a user extension bolted onto a run.
	 */
	@Override
	public boolean isSystemListener() {
		return true;
	}

	@Override
	public void startSimulationBranch(SimulationStatus status) throws SimulationException {
		// The engine takes its own origin right after this hook returns, from the
		// same position, and its comment says this hook is where a listener may
		// move the launch position. The stepper's initialize() copies the status
		// without moving the rocket, so the two agree.
		origin = status.getRocketPosition();
		effectiveLength = effectiveRodLength(
				status.getConfiguration(),
				status.getSimulationConditions().getLaunchRodLength());
	}

	@Override
	public void postStep(SimulationStatus status) throws SimulationException {
		if (origin == null || Double.isNaN(effectiveLength)) {
			return;
		}
		if (!status.isLiftoff() || status.isLaunchRodCleared()) {
			return;
		}
		if (status.getRocketPosition().sub(origin).length() > effectiveLength) {
			status.addEvent(new FlightEvent(FlightEvent.Type.LAUNCHROD, status.getSimulationTime(), null));
		}
	}

	/** Buttons this far apart around the body or less are one line. */
	private static final double SAME_LINE_RADIANS = Math.toRadians(1);

	/** Buttons this close along the rocket are one station, not two contacts. */
	private static final double SAME_STATION_M = 0.0005;

	/**
	 * How far the rocket travels before it stops being guided.
	 *
	 * Upstream's own arithmetic, with the things it leaves out. A guide that
	 * starts part-way up the rod has that much less rod to traverse, so the travel
	 * is the rod length less the gap from the guiding point to the rocket's aft
	 * bound.
	 *
	 * WHICH POINT GUIDES depends on what the guide is, because a rod and a rail do
	 * not hold a rocket the same way:
	 *
	 * <ul>
	 * <li>A LUG is a tube threaded onto the rod and holds the rocket's angle on
	 * its own, so it guides until its aft END leaves the rod, at
	 * {@code origin + getLength()}. The aft-most lug of the set wins.</li>
	 * <li>A BUTTON is a stud in a slot and holds nothing by itself: two of them in
	 * the same rail are what stop the rocket pivoting. So a line of buttons guides
	 * until its SECOND-TO-LAST station leaves the rail, and from there the rocket
	 * is free though one button is still in the slot. A button's own
	 * {@code getComponentBounds} spans -r..+r in x, so its origin is its axial
	 * CENTER and its aft edge is {@code center + outerDiameter / 2}; it never sets
	 * {@code length}, so measuring it like a lug would lose its radius.</li>
	 * </ul>
	 *
	 * Buttons are ONE LINE when they sit within a degree of each other around the
	 * body, and ONE STATION when they sit within half a millimeter along it. A line
	 * with one station gives no guided travel at all; with several lines the best
	 * one is taken, because the rail holds whichever line it was loaded on.
	 *
	 * Every absolute instance of every guide is searched, not one: the first
	 * instance of a fore/aft pair is the FORWARD one, which is the wrong end.
	 *
	 * A design carrying BOTH takes whichever guides the shorter distance, since a
	 * rod and a rail are never used together and the rocket flies off one of them.
	 * Buttons that cannot guide are not that answer, so they are ignored rather
	 * than counted as zero when a lug is there to do the work.
	 *
	 * With no guide at all the full rod length stands, which is a tower launcher
	 * and is what upstream means by leaving the length alone.
	 */
	private static double effectiveRodLength(FlightConfiguration configuration, double rodLength) {
		double lugX = Double.NaN;
		List<Double> angles = new ArrayList<>();
		List<Double> centers = new ArrayList<>();
		List<Double> aftEdges = new ArrayList<>();

		for (RocketComponent c : configuration.getActiveComponents()) {
			if (c instanceof LaunchLug) {
				for (CoordinateIF p : c.toAbsolute(new Coordinate(c.getLength()))) {
					if (Double.isNaN(lugX) || p.getX() > lugX) {
						lugX = p.getX();
					}
				}
			} else if (c instanceof RailButton) {
				RailButton b = (RailButton) c;
				double radius = b.getOuterDiameter() / 2.0;
				for (CoordinateIF p : c.toAbsolute(new Coordinate(0))) {
					angles.add(b.getAngleOffset());
					centers.add(p.getX());
					aftEdges.add(p.getX() + radius);
				}
			}
		}

		double maxX = 0;
		for (CoordinateIF c : configuration.getBounds()) {
			if (c.getX() > maxX) {
				maxX = c.getX();
			}
		}

		double lugLength = Double.isNaN(lugX) ? Double.NaN : travel(rodLength, maxX, lugX);
		double buttonX = railGuideX(angles, centers, aftEdges);
		double buttonLength = Double.isNaN(buttonX) ? Double.NaN : travel(rodLength, maxX, buttonX);

		if (!Double.isNaN(lugLength) && !Double.isNaN(buttonLength)) {
			return Math.min(lugLength, buttonLength);
		}
		if (!Double.isNaN(lugLength)) {
			return lugLength;
		}
		if (!Double.isNaN(buttonLength)) {
			return buttonLength;
		}
		// Buttons that cannot guide, and nothing else: the rocket leaves the rail
		// free from the moment it moves. A rocket with no guide at all is a tower
		// and keeps the whole length.
		return angles.isEmpty() ? rodLength : 0;
	}

	/** The rod length less the gap from the guiding point to the rocket's aft end. */
	private static double travel(double rodLength, double maxX, double guideX) {
		// A guide whose aft edge reaches the aft end takes the full length, and a
		// gap longer than the rod leaves no guided travel rather than a negative
		// distance the comparison would always satisfy.
		if (maxX >= guideX) {
			return Math.max(0, rodLength - (maxX - guideX));
		}
		return rodLength;
	}

	/**
	 * The aft edge of the second-to-last station of the best button line, or NaN
	 * when no line has two stations to hold the rocket with.
	 */
	private static double railGuideX(List<Double> angles, List<Double> centers, List<Double> aftEdges) {
		double best = Double.NaN;
		boolean[] taken = new boolean[angles.size()];
		for (int i = 0; i < angles.size(); i++) {
			if (taken[i]) {
				continue;
			}
			List<Double> lineCenters = new ArrayList<>();
			List<Double> lineAftEdges = new ArrayList<>();
			for (int j = i; j < angles.size(); j++) {
				if (taken[j] || !sameLine(angles.get(i), angles.get(j))) {
					continue;
				}
				taken[j] = true;
				lineCenters.add(centers.get(j));
				lineAftEdges.add(aftEdges.get(j));
			}
			double x = secondStationFromAft(lineCenters, lineAftEdges);
			if (!Double.isNaN(x) && (Double.isNaN(best) || x > best)) {
				best = x;
			}
		}
		return best;
	}

	/** Two buttons on the same side of the body, to within a degree. */
	private static boolean sameLine(double a, double b) {
		double d = Math.abs(a - b) % (2 * Math.PI);
		if (d > Math.PI) {
			d = 2 * Math.PI - d;
		}
		return d <= SAME_LINE_RADIANS;
	}

	/**
	 * The aft edge of the station next forward of the aft-most one, which is the
	 * last place this line still holds the rocket at two points.
	 */
	private static double secondStationFromAft(List<Double> centers, List<Double> aftEdges) {
		double last = Double.NaN;
		for (int i = 0; i < centers.size(); i++) {
			if (Double.isNaN(last) || centers.get(i) > last) {
				last = centers.get(i);
			}
		}
		if (Double.isNaN(last)) {
			return Double.NaN;
		}
		double second = Double.NaN;
		double secondAftEdge = Double.NaN;
		for (int i = 0; i < centers.size(); i++) {
			double c = centers.get(i);
			if (last - c <= SAME_STATION_M) {
				continue; // the aft-most station itself, however many buttons share it
			}
			if (Double.isNaN(second) || c > second) {
				second = c;
				secondAftEdge = aftEdges.get(i);
			}
		}
		return secondAftEdge;
	}
}
