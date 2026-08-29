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
     * SHIM: default simulation options (upstream BasicEventSimulationEngine now
     * reads getOptions().getSimulationStepperMethodChoice() to pick the stepper;
     * the default is RK4, matching the web engine's prior behavior). Lazily
     * created so it is only built when the engine asks for it.
     */
    public SimulationOptions getOptions() {
        if (options == null) {
            options = new SimulationOptions();
        }
        return options;
    }
}
