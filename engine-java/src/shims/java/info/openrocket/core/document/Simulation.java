package info.openrocket.core.document;

import info.openrocket.core.rocketcomponent.FlightConfigurationId;
import info.openrocket.core.rocketcomponent.Rocket;
import info.openrocket.core.simulation.SimulationOptions;

/**
 * SHIM: minimal parent-simulation holder. SimulationConditions delegates
 * getRocket()/getId() here, which the simulation engine reads.
 */
public class Simulation {

    private final Rocket rocket;
    private final FlightConfigurationId fcid;
    private SimulationOptions options;

    public Simulation(Rocket rocket, FlightConfigurationId fcid) {
        this.rocket = rocket;
        this.fcid = fcid;
    }

    public Rocket getRocket() {
        return rocket;
    }

    public FlightConfigurationId getId() {
        return fcid;
    }

    /**
     * SHIM: simulation options (upstream BasicEventSimulationEngine reads
     * getOptions().getSimulationStepperMethodChoice() to pick the stepper; the
     * default is RK4, matching the web engine's behavior).
     *
     * Upstream invariant, and why this is lazily created rather than wired:
     * upstream sets conditions.setSimulation(this) immediately after
     * options.toSimulationConditions(), so getSimulation().getOptions() is the
     * object that produced the conditions. Here the facade builds
     * SimulationConditions by hand and never hands its options in, so this
     * returns an unrelated default instead.
     *
     * That is harmless only because the facade exposes no stepper option, so
     * the read above lands on RK4 either way. A stepper option set on the
     * conditions alone would be ignored and the engine would keep running RK4
     * with no error, so any such option must also be wired through here.
     */
    public SimulationOptions getOptions() {
        if (options == null) {
            options = new SimulationOptions();
        }
        return options;
    }
}
