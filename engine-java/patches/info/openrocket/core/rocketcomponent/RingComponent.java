package info.openrocket.core.rocketcomponent;

import java.util.ArrayList;
import java.util.Collection;
import java.util.List;

import info.openrocket.core.util.BoundingBox;
import info.openrocket.core.util.Coordinate;
import info.openrocket.core.util.CoordinateIF;
import info.openrocket.core.util.MathUtil;

/**
 * An inner component that consists of a hollow cylindrical component. This can
 * be
 * an inner tube, tube coupler, centering ring, bulkhead etc.
 *
 * The properties include the inner and outer radii, length and radial position.
 *
 * @author Sampo Niskanen <sampo.niskanen@iki.fi>
 */
public abstract class RingComponent extends StructuralComponent implements BoxBounded, Coaxial {

	protected boolean outerRadiusAutomatic = false;
	protected boolean innerRadiusAutomatic = false;

	protected double radialDirection = 0;
	protected double radialPosition = 0;

	private double shiftY = 0;
	private double shiftZ = 0;

	@Override
	public abstract double getOuterRadius();

	@Override
	public abstract void setOuterRadius(double r);

	@Override
	public abstract double getInnerRadius();

	@Override
	public abstract void setInnerRadius(double r);

	@Override
	public abstract double getThickness();

	public abstract void setThickness(double thickness);

	public final boolean isOuterRadiusAutomatic() {
		return outerRadiusAutomatic;
	}

	// Setter is protected, subclasses may make it public
	protected void setOuterRadiusAutomatic(boolean auto) {
		for (RocketComponent listener : configListeners) {
			if (listener instanceof RingComponent) {
				((RingComponent) listener).setOuterRadiusAutomatic(auto);
			}
		}

		if (auto == outerRadiusAutomatic)
			return;
		outerRadiusAutomatic = auto;
		fireComponentChangeEvent(ComponentChangeEvent.MASS_CHANGE);
	}

	public final boolean isInnerRadiusAutomatic() {
		return innerRadiusAutomatic;
	}

	// Setter is protected, subclasses may make it public
	protected void setInnerRadiusAutomatic(boolean auto) {
		for (RocketComponent listener : configListeners) {
			if (listener instanceof RingComponent) {
				((RingComponent) listener).setInnerRadiusAutomatic(auto);
			}
		}

		if (auto == innerRadiusAutomatic)
			return;
		innerRadiusAutomatic = auto;
		fireComponentChangeEvent(ComponentChangeEvent.MASS_CHANGE);
	}

	public final void setLength(double length) {
		for (RocketComponent listener : configListeners) {
			if (listener instanceof RingComponent) {
				((RingComponent) listener).setLength(length);
			}
		}

		double l = Math.max(length, 0);
		if (this.length == l)
			return;

		this.length = l;
		clearPreset();
		fireComponentChangeEvent(ComponentChangeEvent.MASS_CHANGE);
	}

	/**
	 * Return the radial direction of displacement of the component. Direction 0
	 * is equivalent to the Y-direction.
	 *
	 * @return the radial direction.
	 */
	public double getRadialDirection() {
		return radialDirection;
	}

	/**
	 * Set the radial direction of displacement of the component. Direction 0
	 * is equivalent to the Y-direction.
	 *
	 * @param dir the radial direction.
	 */
	public void setRadialDirection(double dir) {
		for (RocketComponent listener : configListeners) {
			if (listener instanceof RingComponent) {
				((RingComponent) listener).setRadialDirection(dir);
			}
		}

		dir = MathUtil.reducePi(dir);
		if (radialDirection == dir)
			return;
		radialDirection = dir;
		shiftY = radialPosition * Math.cos(radialDirection);
		shiftZ = radialPosition * Math.sin(radialDirection);
		fireComponentChangeEvent(ComponentChangeEvent.MASS_CHANGE);
	}

	public BoundingBox getInstanceBoundingBox() {
		BoundingBox instanceBounds = new BoundingBox();

		instanceBounds.update(new Coordinate(this.getLength(), 0, 0));

		final double r = getOuterRadius();
		instanceBounds.update(new Coordinate(0, r, r));
		instanceBounds.update(new Coordinate(0, -r, -r));

		return instanceBounds;
	}

	/**
	 * Return the radial position of the component. The position is the distance
	 * of the center of the component from the center of the parent component.
	 *
	 * @return the radial position.
	 */
	public double getRadialPosition() {
		return radialPosition;
	}

	/**
	 * Set the radial position of the component. The position is the distance
	 * of the center of the component from the center of the parent component.
	 *
	 * @param pos the radial position.
	 */
	public void setRadialPosition(double pos) {
		pos = Math.max(pos, 0);

		for (RocketComponent listener : configListeners) {
			if (listener instanceof RingComponent) {
				((RingComponent) listener).setRadialPosition(pos);
			}
		}

		if (radialPosition == pos)
			return;
		radialPosition = pos;
		shiftY = radialPosition * Math.cos(radialDirection);
		shiftZ = radialPosition * Math.sin(radialDirection);
		fireComponentChangeEvent(ComponentChangeEvent.MASS_CHANGE);
	}

	public double getRadialShiftY() {
		return shiftY;
	}

	public double getRadialShiftZ() {
		return shiftZ;
	}

	public void setRadialShift(double y, double z) {
		for (RocketComponent listener : configListeners) {
			if (listener instanceof RingComponent) {
				((RingComponent) listener).setRadialShift(y, z);
			}
		}

		radialPosition = Math.hypot(y, z);
		radialDirection = Math.atan2(z, y);

		// Re-calculate to ensure consistency
		shiftY = radialPosition * Math.cos(radialDirection);
		shiftZ = radialPosition * Math.sin(radialDirection);
		assert (MathUtil.equals(y, shiftY));
		assert (MathUtil.equals(z, shiftZ));

		fireComponentChangeEvent(ComponentChangeEvent.MASS_CHANGE);
	}

	@Override
	public Collection<CoordinateIF> getComponentBounds() {
		List<CoordinateIF> bounds = new ArrayList<>();
		addBound(bounds, 0, getOuterRadius());
		addBound(bounds, length, getOuterRadius());
		return bounds;
	}

	@Override
	public CoordinateIF getComponentCG() {
		CoordinateIF cg = Coordinate.ZERO;
		final int instanceCount = getInstanceCount();
		final double instanceMass = ringMass(getOuterRadius(), getInnerRadius(), getLength(),
				getMaterial().getDensity());

		if (1 == instanceCount) {
			cg = new Coordinate(length / 2, 0, 0, instanceMass);
		} else {
			for (CoordinateIF c : getInstanceOffsets()) {
				c = c.setWeight(instanceMass);
				cg = cg.average(c);
			}
			cg = cg.add(length / 2, 0, 0);
		}
		return cg;
	}

	@Override
	public double getComponentMass() {
		return ringMass(getOuterRadius(), getInnerRadius(), getLength(),
				getMaterial().getDensity()) * getInstanceCount();
	}

	@Override
	public double getLongitudinalUnitInertia() {
		return ringLongitudinalUnitInertia(getOuterRadius(), getInnerRadius(), getLength());
	}

	@Override
	public double getRotationalUnitInertia() {
		// PATCH(offaxis-roll-inertia): the ring's own axial term PLUS the
		// parallel-axis spread of its instances. See instanceSpreadUnitInertia()
		// and patches/LEDGER.md.
		final double own = ringRotationalUnitInertia(getOuterRadius(), getInnerRadius());
		final double spread = instanceSpreadUnitInertia();
		// An on-axis ring (centering ring, bulkhead, coupler, engine block,
		// centerline inner tube) returns `own` untouched, so no floating-point
		// operation is added to it.
		return (spread != 0.0) ? own + spread : own;
	}

	/**
	 * PATCH(offaxis-roll-inertia). The parallel-axis term, per unit mass, of
	 * this component's instances about the lateral point
	 * {@link #getComponentCG()} places its mass at.
	 * <p>
	 * Upstream's rotational unit inertia is the ring's own (ro^2 + ri^2) / 2 and
	 * nothing else. A single inner tube at radial position r, whose CG
	 * getComponentCG() puts on the parent axis, missed m * r^2; a cluster, whose
	 * CG it puts at the mean of the instance offsets, missed the spread of its
	 * tubes about that mean.
	 * <p>
	 * The reference point is the one getComponentCG() already reports, so this
	 * adds roll inertia and nothing else: no CG moves, and no pitch or yaw term
	 * appears through rebase(). One instance: the axis. Several: the mean of the
	 * offsets.
	 * <p>
	 * Exactly 0.0 whenever every instance sits on the reference point: a
	 * centerline tube, an on-axis RadiusRingComponent line pattern (its offsets
	 * run along x only), and the single ZERO offset other rings inherit from
	 * RocketComponent.
	 * <p>
	 * The radial position counts for every ring type, not only InnerTube. Only
	 * InnerTube's offsets carry it (its cluster points include the shift); every
	 * other ring reports offsets on its own axis, while the bridge sets a radial
	 * position on all of them. So the shift is added to those offsets here, and
	 * a coupler or engine block bonded off the axis is charged the same m * r^2
	 * as the same mass drawn as an inner tube. The reference point is unchanged:
	 * it is still where getComponentCG() puts the mass.
	 * <p>
	 * Known residual, shared with the motor half in MassCalculation and with
	 * upstream's own cluster motors: the term is about the ring's PARENT axis,
	 * so a tube offset d inside a pod set offset D is charged m * (D^2 + d^2)
	 * and misses the 2 * m * D.d cross term.
	 *
	 * @return the spread term in m^2 (inertia per unit mass)
	 */
	private double instanceSpreadUnitInertia() {
		final CoordinateIF[] offsets = getInstanceOffsets();
		final int count = offsets.length;
		double refY = 0.0;
		double refZ = 0.0;
		// Same branch getComponentCG() takes: one instance => the axis.
		if (1 < getInstanceCount()) {
			for (CoordinateIF c : offsets) {
				refY += c.getY();
				refZ += c.getZ();
			}
			refY /= count;
			refZ /= count;
		}
		final boolean offsetsCarryShift = this instanceof InnerTube;
		final double addY = offsetsCarryShift ? 0.0 : shiftY;
		final double addZ = offsetsCarryShift ? 0.0 : shiftZ;
		double sum = 0.0;
		for (CoordinateIF c : offsets) {
			final double dy = c.getY() + addY - refY;
			final double dz = c.getZ() + addZ - refZ;
			sum += dy * dy + dz * dz;
		}
		return sum / count;
	}

}
