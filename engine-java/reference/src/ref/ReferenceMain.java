package ref;

import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Locale;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import info.openrocket.core.aerodynamics.BarrowmanCalculator;
import info.openrocket.core.document.Simulation;
import info.openrocket.core.masscalc.MassCalculator;
import info.openrocket.core.models.atmosphere.ExtendedISAModel;
import info.openrocket.core.models.gravity.ConstantGravityModel;
import info.openrocket.core.models.gravity.WGSGravityModel;
import info.openrocket.core.models.wind.PinkNoiseWindModel;
import info.openrocket.core.simulation.BasicEventSimulationEngine;
import info.openrocket.core.simulation.FlightData;
import info.openrocket.core.simulation.FlightDataBranch;
import info.openrocket.core.simulation.FlightDataType;
import info.openrocket.core.simulation.FlightEvent;
import info.openrocket.core.simulation.SimulationConditions;
import info.openrocket.core.util.GeodeticComputationStrategy;
import info.openrocket.core.util.WorldCoordinate;

/**
 * Flies the fixture on PRISTINE upstream core and prints the result as
 * pipe-delimited lines for comparison against the engine we ship.
 *
 * The line vocabulary is the one {@code test/parity/ParityMain} already uses for
 * its staging scenarios, so the two are read the same way:
 * <pre>
 *   staged.branches|&lt;count&gt;|&lt;name&gt;|&lt;name&gt;...
 *   staged.b&lt;i&gt;.events|&lt;TYPE&gt;[@&lt;source&gt;]|...
 *   staged.b&lt;i&gt;|&lt;maxAltitude&gt;|&lt;separationTime&gt;
 * </pre>
 * Values are raw {@code Double.toString} - no rounding and no locale, so the
 * comparison decides the tolerance rather than the formatting.
 *
 * Only stdout carries results. Logback is pointed at stderr by the Gradle task,
 * because a log line on stdout would be read as data.
 */
public final class ReferenceMain {

    public static void main(String[] args) throws Exception {
        Locale.setDefault(Locale.US);
        PrintStream out = new PrintStream(System.out, true, StandardCharsets.UTF_8);

        Path fixturePath = Path.of(args.length > 0
                ? args[0]
                : "fixtures/staged-flight.json");
        if (!Files.isRegularFile(fixturePath)) {
            System.err.println("reference: no fixture at " + fixturePath.toAbsolutePath());
            System.exit(2);
        }

        Bootstrap.init();

        JsonObject fixture = JsonParser
                .parseString(Files.readString(fixturePath, StandardCharsets.UTF_8))
                .getAsJsonObject();
        Fixture.Built built = Fixture.build(fixture);
        JsonObject options = Fixture.obj(fixture, "options");

        FlightData data = fly(built, options);
        emit(out, data);
    }

    /**
     * Upstream's simulation, configured to match what our bridge configures for
     * the same options blob.
     *
     * Every field is set explicitly and from the fixture. The shipped bridge
     * supplies defaults for anything the caller omits; mirroring those defaults
     * here would mean this file encodes the bridge's opinions, which is exactly
     * what it is supposed to be independent of. So the fixture states them and
     * both sides read the same numbers.
     */
    private static FlightData fly(Fixture.Built built, JsonObject o) throws Exception {
        SimulationConditions conditions = new SimulationConditions();
        // Upstream's REAL Simulation, which takes the configuration off the
        // rocket's selected one. Our engine substitutes a shim with a
        // (Rocket, FlightConfigurationId) constructor whose getOptions() returns
        // an unrelated default rather than the options that produced these
        // conditions - the stepper choice is read through exactly that call, so
        // using the shim's shape here would hide the difference instead of
        // testing it.
        Simulation simulation = new Simulation(built.rocket);
        if (!simulation.getFlightConfigurationId().equals(built.fcid)) {
            throw new IllegalStateException(
                    "upstream Simulation picked configuration " + simulation.getFlightConfigurationId()
                            + " but the fixture built " + built.fcid);
        }
        conditions.setSimulation(simulation);

        conditions.setLaunchRodLength(Fixture.dbl(o, "rodLength", 1.0));
        conditions.setLaunchRodAngle(Fixture.dbl(o, "rodAngle", 0));
        conditions.setLaunchRodDirection(Fixture.dbl(o, "rodDirection", Math.PI / 2));
        conditions.setLaunchSite(new WorldCoordinate(
                Fixture.dbl(o, "launchLatitude", 28.61),
                Fixture.dbl(o, "launchLongitude", -80.60),
                Fixture.dbl(o, "launchAltitude", 0)));
        conditions.setGeodeticComputation(geodetic(Fixture.str(o, "geodetic", "spherical")));
        conditions.setAtmosphericModel(new ExtendedISAModel());

        if ("constant".equalsIgnoreCase(Fixture.str(o, "gravityModel", "wgs"))) {
            conditions.setGravityModel(new ConstantGravityModel(Fixture.dbl(o, "constantGravity", 9.80665)));
        } else {
            conditions.setGravityModel(new WGSGravityModel());
        }

        int randomSeed = (int) Fixture.dbl(o, "randomSeed", 42);
        // Seeded explicitly: the no-arg constructor seeds from new Random(), so a
        // reference that used it would not reproduce from one run to the next.
        PinkNoiseWindModel wind = new PinkNoiseWindModel(randomSeed);
        wind.setAverage(Fixture.dbl(o, "windAverage", 0));
        wind.setStandardDeviation(Fixture.dbl(o, "windStdDeviation", 0));
        wind.setDirection(Fixture.dbl(o, "windDirection", Math.PI / 2));
        conditions.setWindModel(wind);

        // STOCK Barrowman. Our engine reaches this through a patched calculator
        // carrying the opt-in RASAero extensions; with the flag off it is meant to
        // behave as this does, and "meant to" is the thing being tested.
        conditions.setAerodynamicCalculator(new BarrowmanCalculator());
        conditions.setMassCalculator(new MassCalculator());
        conditions.setTimeStep(Fixture.dbl(o, "timeStep", 0.05));
        conditions.setMaxSimulationTime(Fixture.dbl(o, "maxTime", 1200));
        conditions.setRandomSeed(randomSeed);

        BasicEventSimulationEngine engine = new BasicEventSimulationEngine();
        engine.simulate(conditions);
        return engine.getFlightData();
    }

    private static void emit(PrintStream out, FlightData data) {
        int branches = data.getBranchCount();
        StringBuilder names = new StringBuilder("staged.branches|" + branches);
        for (int i = 0; i < branches; i++) {
            names.append('|').append(data.getBranch(i).getName());
        }
        out.println(names);

        for (int i = 0; i < branches; i++) {
            FlightDataBranch branch = data.getBranch(i);

            StringBuilder events = new StringBuilder("staged.b" + i + ".events");
            double separation = Double.NaN;
            for (FlightEvent e : branch.getEvents()) {
                // name(), not toString(): FlightEvent.Type overrides toString with
                // a TRANSLATED display name ("Motor ignition"), while the shipped
                // bridge serializes name() ("IGNITION"). Comparing the two would
                // fail on every event for no reason.
                events.append('|').append(e.getType().name());
                if (e.getSource() != null) {
                    events.append('@').append(e.getSource().getName());
                }
                if (Double.isNaN(separation) && e.getType() == FlightEvent.Type.STAGE_SEPARATION) {
                    separation = e.getTime();
                }
            }
            out.println(events);

            List<Double> altitude = branch.get(FlightDataType.TYPE_ALTITUDE);
            double maxAltitude = 0;
            if (altitude != null) {
                for (Double v : altitude) {
                    if (v != null && !Double.isNaN(v) && v > maxAltitude) {
                        maxAltitude = v;
                    }
                }
            }
            // Apogee and separation time only. The END of a multi-minute chute
            // descent accumulates transcendental ULP noise, so parity caps its
            // staging scenarios the same way; the event SEQUENCE above is exact.
            out.println("staged.b" + i + "|" + maxAltitude + "|" + separation);
        }
    }

    private static GeodeticComputationStrategy geodetic(String name) {
        switch (name.toLowerCase()) {
            case "flat": return GeodeticComputationStrategy.FLAT;
            case "spherical": return GeodeticComputationStrategy.SPHERICAL;
            case "wgs84": return GeodeticComputationStrategy.WGS84;
            default: throw new IllegalArgumentException("unknown geodetic strategy: " + name);
        }
    }

    private ReferenceMain() {
    }
}
