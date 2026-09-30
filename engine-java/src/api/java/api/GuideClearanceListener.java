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

	/**
	 * How far the rocket travels before its aft-most guide leaves the rod.
	 *
	 * Upstream's own arithmetic, with the two things it leaves out. A guide that
	 * starts part-way up the rod has that much less rod to traverse, so the travel
	 * is the rod length less the gap from the aft-most guide point to the rocket's
	 * aft bound.
	 *
	 * Lugs and rail buttons are ONE rule with two geometries, because the guiding
	 * point is the aft-most place the part still touches the rail:
	 *
	 * <ul>
	 * <li>A lug is a tube lying along the body, so that is its aft END, at
	 * {@code origin + getLength()}.</li>
	 * <li>A button is a stud whose {@code getComponentBounds} spans -r..+r in x,
	 * so its origin is its axial CENTER and its aft edge is
	 * {@code center + outerDiameter / 2}. It never sets {@code length}, so
	 * measuring it like a lug would take its center and lose its radius.</li>
	 * </ul>
	 *
	 * Every absolute instance of every guide is searched, not one: the first
	 * instance of a fore/aft pair is the FORWARD one, which is the wrong end.
	 *
	 * With no guide at all the full rod length stands, which is a tower launcher
	 * and is what upstream means by leaving the length alone.
	 */
	private static double effectiveRodLength(FlightConfiguration configuration, double rodLength) {
		double guideX = Double.NaN;
		for (RocketComponent c : configuration.getActiveComponents()) {
			double aftLocal;
			if (c instanceof LaunchLug) {
				aftLocal = c.getLength();
			} else if (c instanceof RailButton) {
				aftLocal = ((RailButton) c).getOuterDiameter() / 2.0;
			} else {
				continue;
			}
			for (CoordinateIF p : c.toAbsolute(new Coordinate(aftLocal))) {
				if (Double.isNaN(guideX) || p.getX() > guideX) {
					guideX = p.getX();
				}
			}
		}
		if (Double.isNaN(guideX)) {
			return rodLength;
		}
		double maxX = 0;
		for (CoordinateIF c : configuration.getBounds()) {
			if (c.getX() > maxX) {
				maxX = c.getX();
			}
		}
		// A guide whose aft edge reaches the aft end takes the full length, and a
		// gap longer than the rod leaves no guided travel rather than a negative
		// distance the comparison would always satisfy.
		if (maxX >= guideX) {
			return Math.max(0, rodLength - (maxX - guideX));
		}
		return rodLength;
	}
}
