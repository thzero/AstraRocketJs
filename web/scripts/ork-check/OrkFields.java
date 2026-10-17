import com.google.inject.AbstractModule;
import com.google.inject.Guice;
import com.google.inject.Injector;
import info.openrocket.core.database.ComponentPresetDao;
import info.openrocket.core.database.ComponentPresetDatabase;
import info.openrocket.core.document.OpenRocketDocument;
import info.openrocket.core.document.Simulation;
import info.openrocket.core.file.GeneralRocketLoader;
import info.openrocket.core.models.wind.MultiLevelPinkNoiseWindModel;
import info.openrocket.core.models.wind.PinkNoiseWindModel;
import info.openrocket.core.motor.MotorConfiguration;
import info.openrocket.core.plugin.PluginModule;
import info.openrocket.core.rocketcomponent.AxialStage;
import info.openrocket.core.rocketcomponent.DeploymentConfiguration;
import info.openrocket.core.rocketcomponent.FlightConfiguration;
import info.openrocket.core.rocketcomponent.FlightConfigurationId;
import info.openrocket.core.rocketcomponent.MotorMount;
import info.openrocket.core.rocketcomponent.RecoveryDevice;
import info.openrocket.core.rocketcomponent.Rocket;
import info.openrocket.core.rocketcomponent.RocketComponent;
import info.openrocket.core.rocketcomponent.StageSeparationConfiguration;
import info.openrocket.core.simulation.SimulationOptions;
import info.openrocket.core.startup.Application;
import info.openrocket.core.startup.CoreModule;

import java.io.File;
import java.io.PrintWriter;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/**
 * Open each `.ork` or `.rkt` in a real OpenRocket and write what it holds, as
 * desktop loaded it: every part field by field, every flight configuration and
 * every simulation's conditions.
 *
 * The part fields are read by the bridge's own `api.ComponentFields`, compiled
 * against this release, so the desktop and the app's kernel are asked the same
 * questions through the same getters. `scripts/check-desktop-fields.mjs`
 * compares the two.
 *
 *   OrkFields <out.json> <file.ork|file.rkt> [...]
 *
 * Writes one JSON object: each file's path mapped to
 *
 *   parts    in tree order (the rocket itself left out), each as its class
 *            name, its depth below the rocket (a stage at 0), its name and its
 *            fields;
 *   configs  each flight configuration by id: the motor in each mount (by the
 *            mount's index in `parts`) with its designation, common name,
 *            digest, ejection delay and ignition, each recovery device's
 *            deployment, each lower stage's or booster's separation, and which
 *            stages fly, in tree order;
 *   sims     each simulation's name, configuration and the conditions 24.12
 *            keeps (SimulationOptions).
 *
 * A number desktop holds as infinite or NaN (a plugged motor's delay) is
 * written as null. The wiring is `OrkCheck`'s: the preset database has to exist
 * before a file that names a catalog part can load.
 */
public class OrkFields {
    static ComponentPresetDatabase presets;

    public static void main(String[] args) throws Exception {
        if (args.length < 2) {
            System.err.println("usage: OrkFields <out.json> <file.ork|file.rkt> [...]");
            System.exit(2);
        }
        com.google.inject.Module wiring = new AbstractModule() {
            @Override
            protected void configure() {
                bind(ComponentPresetDao.class).toProvider(() -> presets);
            }
        };
        CoreModule core = new CoreModule();
        Injector injector = Guice.createInjector(core, new PluginModule(), wiring);
        Application.setInjector(injector);
        core.startLoader();
        presets = injector.getInstance(ComponentPresetDatabase.class);

        StringBuilder out = new StringBuilder("{");
        for (int i = 1; i < args.length; i++) {
            OpenRocketDocument doc = new GeneralRocketLoader(new File(args[i])).load();
            if (i > 1) out.append(',');
            out.append(quote(args[i])).append(":{\"parts\":[");
            List<RocketComponent> parts = new ArrayList<>();
            for (RocketComponent c : doc.getRocket()) {
                if (c instanceof Rocket) continue;
                if (!parts.isEmpty()) out.append(',');
                parts.add(c);
                // Depth below the rocket, a stage at 0, as the app's tree counts it.
                int depth = -1;
                for (RocketComponent p = c.getParent(); p != null; p = p.getParent()) depth++;
                out.append("{\"class\":").append(quote(c.getClass().getSimpleName()))
                        .append(",\"depth\":").append(depth)
                        .append(",\"name\":").append(quote(c.getName()))
                        .append(",\"fields\":").append(api.ComponentFields.of(c)).append('}');
            }
            out.append("],\"configs\":[");
            configs(out, doc.getRocket(), parts);
            out.append("],\"sims\":[");
            sims(out, doc);
            out.append("]}");
        }
        out.append('}');
        try (PrintWriter w = new PrintWriter(args[0], StandardCharsets.UTF_8)) {
            w.print(out);
        }
    }

    /** Every flight configuration, as `configs` in the class comment describes. */
    private static void configs(StringBuilder out, Rocket rocket, List<RocketComponent> parts) {
        boolean firstConfig = true;
        for (FlightConfigurationId id : rocket.getIds()) {
            FlightConfiguration fc = rocket.getFlightConfiguration(id);
            if (!firstConfig) out.append(',');
            firstConfig = false;
            out.append("{\"id\":").append(quote(id.key.toString()))
                    .append(",\"default\":").append(id.equals(rocket.getSelectedConfiguration().getId()));
            StringBuilder motors = new StringBuilder();
            StringBuilder deployments = new StringBuilder();
            StringBuilder separations = new StringBuilder();
            StringBuilder stages = new StringBuilder();
            boolean firstStage = true;
            for (int i = 0; i < parts.size(); i++) {
                RocketComponent c = parts.get(i);
                if (c instanceof MotorMount && ((MotorMount) c).isMotorMount()) {
                    MotorConfiguration mc = ((MotorMount) c).getMotorConfig(id);
                    if (mc != null && !mc.isEmpty()) {
                        if (motors.length() > 0) motors.append(',');
                        motors.append("{\"part\":").append(i)
                                .append(",\"designation\":").append(quote(mc.getMotor().getDesignation()))
                                .append(",\"commonName\":").append(quote(mc.getMotor().getCommonName()))
                                .append(",\"digest\":").append(quote(mc.getMotor().getDigest()))
                                .append(",\"delay\":").append(num(mc.getEjectionDelay()))
                                .append(",\"ignitionEvent\":").append(quote(mc.getIgnitionEvent().name()))
                                .append(",\"ignitionDelay\":").append(num(mc.getIgnitionDelay())).append('}');
                    }
                }
                if (c instanceof RecoveryDevice) {
                    DeploymentConfiguration d = ((RecoveryDevice) c).getDeploymentConfigurations().get(id);
                    if (deployments.length() > 0) deployments.append(',');
                    deployments.append("{\"part\":").append(i)
                            .append(",\"event\":").append(quote(d.getDeployEvent().name()))
                            .append(",\"altitude\":").append(num(d.getDeployAltitude()))
                            .append(",\"delay\":").append(num(d.getDeployDelay())).append('}');
                }
                if (c instanceof AxialStage) {
                    AxialStage stage = (AxialStage) c;
                    if (!firstStage) stages.append(',');
                    // The first stage in the tree has nothing above it to let go of.
                    if (!firstStage) {
                        StageSeparationConfiguration s = stage.getSeparationConfigurations().get(id);
                        if (separations.length() > 0) separations.append(',');
                        separations.append("{\"part\":").append(i)
                                .append(",\"event\":").append(quote(s.getSeparationEvent().name()))
                                .append(",\"delay\":").append(num(s.getSeparationDelay()))
                                .append(",\"altitude\":").append(num(s.getSeparationAltitude())).append('}');
                    }
                    firstStage = false;
                    stages.append(fc.isStageActive(stage.getStageNumber()));
                }
            }
            out.append(",\"motors\":[").append(motors)
                    .append("],\"deployments\":[").append(deployments)
                    .append("],\"separations\":[").append(separations)
                    .append("],\"stages\":[").append(stages).append("]}");
        }
    }

    /** Every simulation, as `sims` in the class comment describes. */
    private static void sims(StringBuilder out, OpenRocketDocument doc) {
        boolean first = true;
        for (Simulation sim : doc.getSimulations()) {
            SimulationOptions o = sim.getOptions();
            if (!first) out.append(',');
            first = false;
            PinkNoiseWindModel avg = o.getAverageWindModel();
            MultiLevelPinkNoiseWindModel ml = o.getMultiLevelWindModel();
            StringBuilder levels = new StringBuilder();
            for (MultiLevelPinkNoiseWindModel.LevelWindModel l : ml.getLevels()) {
                if (levels.length() > 0) levels.append(',');
                levels.append("{\"altitude\":").append(num(l.getAltitude()))
                        .append(",\"speed\":").append(num(l.getSpeed()))
                        .append(",\"direction\":").append(num(l.getDirection()))
                        .append(",\"standardDeviation\":").append(num(l.getStandardDeviation())).append('}');
            }
            out.append("{\"name\":").append(quote(sim.getName()))
                    .append(",\"configId\":").append(quote(sim.getFlightConfigurationId().key.toString()))
                    .append(",\"conditions\":{")
                    .append("\"launchRodLength\":").append(num(o.getLaunchRodLength()))
                    .append(",\"launchRodAngle\":").append(num(o.getLaunchRodAngle()))
                    .append(",\"launchRodDirection\":").append(num(o.getLaunchRodDirection()))
                    .append(",\"launchIntoWind\":").append(o.getLaunchIntoWind())
                    .append(",\"launchAltitude\":").append(num(o.getLaunchAltitude()))
                    .append(",\"launchLatitude\":").append(num(o.getLaunchLatitude()))
                    .append(",\"launchLongitude\":").append(num(o.getLaunchLongitude()))
                    .append(",\"geodetic\":").append(quote(o.getGeodeticComputation().name()))
                    .append(",\"isa\":").append(o.isISAAtmosphere())
                    .append(",\"temperature\":").append(num(o.getLaunchTemperature()))
                    .append(",\"pressure\":").append(num(o.getLaunchPressure()))
                    .append(",\"timeStep\":").append(num(o.getTimeStep()))
                    .append(",\"maxTime\":").append(num(o.getMaxSimulationTime()))
                    .append(",\"windModel\":").append(quote(o.getWindModelType().name()))
                    .append(",\"windAverage\":").append(num(avg.getAverage()))
                    .append(",\"windStdDev\":").append(num(avg.getStandardDeviation()))
                    .append(",\"windDirection\":").append(num(avg.getDirection()))
                    .append(",\"windAltitudeReference\":").append(quote(ml.getAltitudeReference().name()))
                    .append(",\"windLevels\":[").append(levels).append("]}}");
        }
    }

    private static String num(double v) {
        return Double.isFinite(v) ? Double.toString(v) : "null";
    }

    private static String quote(String s) {
        if (s == null) return "null";
        StringBuilder sb = new StringBuilder("\"");
        for (char ch : s.toCharArray()) {
            if (ch == '"' || ch == '\\') sb.append('\\').append(ch);
            else if (ch < 0x20) sb.append(String.format("\\u%04x", (int) ch));
            else sb.append(ch);
        }
        return sb.append('"').toString();
    }
}
