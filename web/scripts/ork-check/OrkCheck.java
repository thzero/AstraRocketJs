import com.google.inject.AbstractModule;
import com.google.inject.Guice;
import com.google.inject.Injector;
import info.openrocket.core.database.ComponentPresetDao;
import info.openrocket.core.database.ComponentPresetDatabase;
import info.openrocket.core.document.OpenRocketDocument;
import info.openrocket.core.document.Simulation;
import info.openrocket.core.simulation.FlightData;
import info.openrocket.core.file.GeneralRocketLoader;
import info.openrocket.core.logging.Warning;
import info.openrocket.core.motor.MotorConfiguration;
import info.openrocket.core.plugin.PluginModule;
import info.openrocket.core.rocketcomponent.FlightConfiguration;
import info.openrocket.core.rocketcomponent.RocketComponent;
import info.openrocket.core.startup.Application;
import info.openrocket.core.startup.CoreModule;

import java.io.File;

/**
 * Open a `.ork` in a real OpenRocket and print what it made of it.
 *
 * The only check that asks the thing we are trying to satisfy. Our own tests can
 * prove the writer puts a part link or a motor digest in the file; they cannot
 * prove the desktop ACCEPTS it, and for a long time it did not: every `<preset>`
 * was rejected for having no digest, and every motor resolved to whichever entry
 * came first. Both failures were invisible from this side of the boundary and
 * showed up as a warning dialog on somebody's screen.
 *
 * Prints every component that came back carrying a catalog part, every motor
 * that resolved and the digest it resolved to, every simulation with the status
 * the loader gave it, and then the loader's own warning set. Exit code 1 if
 * there are any warnings, so this can gate a change.
 *
 * WIRING. `CoreModule` builds its own database loaders and only starts them when
 * asked, and the preset database cannot be built before `Application.setInjector`
 * because loading a `.orc` reaches back through it for the material database. So
 * the injector is created first with the preset DAO bound to a provider that
 * reads a field, and the field is filled after `startLoader()`.
 */
public class OrkCheck {
    static ComponentPresetDatabase presets;

    public static void main(String[] args) throws Exception {
        if (args.length < 1) {
            System.err.println("usage: OrkCheck <file.ork> [...]");
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

        int failed = 0;
        for (String path : args) {
            System.out.println("== " + path);
            GeneralRocketLoader loader = new GeneralRocketLoader(new File(path));
            OpenRocketDocument doc = loader.load();
            for (RocketComponent c : doc.getRocket()) {
                if (c.getPresetComponent() != null) {
                    System.out.println("  part  " + c.getName() + " -> "
                            + c.getPresetComponent().getManufacturer() + " "
                            + c.getPresetComponent().getPartNo());
                }
            }
            for (FlightConfiguration fc : doc.getRocket().getFlightConfigurations()) {
                for (MotorConfiguration mc : fc.getActiveMotors()) {
                    System.out.println("  motor " + mc.getMotor().getDesignation()
                            + " (" + mc.getMotor().getDigest() + ")");
                }
            }
            // Each simulation, with the status the loader gave it: LOADED means it
            // read a result summary, NOT_SIMULATED that there was none.
            for (Simulation sim : doc.getSimulations()) {
                FlightData d = sim.getSimulatedData();
                System.out.println("  sim   " + sim.getName() + " [" + sim.getStatus() + "] config "
                        + sim.getFlightConfigurationId().key
                        + (d != null ? " apogee " + d.getMaxAltitude() + " m" : ""));
            }
            if (loader.getWarnings().isEmpty()) {
                System.out.println("  no warnings");
            } else {
                for (Warning w : loader.getWarnings()) {
                    System.out.println("  WARNING: " + w);
                }
                failed++;
            }
        }
        System.exit(failed == 0 ? 0 : 1);
    }
}
