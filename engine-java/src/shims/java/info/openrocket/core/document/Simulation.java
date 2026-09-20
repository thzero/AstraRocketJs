package info.openrocket.core.document;

import info.openrocket.core.rocketcomponent.FlightConfigurationId;
import info.openrocket.core.rocketcomponent.Rocket;
import info.openrocket.core.simulation.SimulationOptions;

/**
 * SHIM: minimal parent-simulation holder. SimulationConditions delegates
 * getRocket()/getId() here, which the simulation engine reads. The real
 * document model arrives with .ork I/O work (P1.8).
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
     * UPSTREAM INVARIANT, and why this is lazily created rather than wired:
     * upstream sets conditions.setSimulation(this) immediately after
     * options.toSimulationConditions(), so getSimulation().getOptions() IS the
     * object that produced the conditions. Here the facade builds
     * SimulationConditions by hand and never hands its options in, so this
     * returns an unrelated default instead.
     *
     * That reaches nothing today ONLY because the facade exposes no stepper
     * knob, so the read above always lands on RK4 either way. Add a
     * {"stepper":"rk6"} option and set it on the conditions, and the engine
     * would silently keep running RK4 with no error - so wire the real options
     * through here at the same time.
     */
    public SimulationOptions getOptions() {
        if (options == null) {
            options = new SimulationOptions();
        }
        return options;
    }
}
