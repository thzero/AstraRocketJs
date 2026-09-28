package ref;

import java.util.Collections;
import java.util.Locale;
import java.util.Set;

import com.google.inject.AbstractModule;
import com.google.inject.Guice;
import com.google.inject.Injector;
import com.google.inject.Module;
import com.google.inject.util.Modules;

import info.openrocket.core.formatting.RocketDescriptor;
import info.openrocket.core.formatting.RocketDescriptorImpl;
import info.openrocket.core.l10n.ResourceBundleTranslator;
import info.openrocket.core.l10n.Translator;
import info.openrocket.core.material.Material;
import info.openrocket.core.models.atmosphere.ExtendedISAModel;
import info.openrocket.core.plugin.PluginModule;
import info.openrocket.core.preferences.ApplicationPreferences;
import info.openrocket.core.preset.ComponentPreset;
import info.openrocket.core.startup.Application;

/**
 * Brings pristine upstream core up headless.
 *
 * Upstream's {@code Application} resolves its preferences and translator through
 * a Guice {@code Injector} and has no default, so nothing in core works until
 * one is installed. Upstream's own equivalent is {@code ServicesForTesting} +
 * {@code BaseTestCase}, which live under {@code core/src/test} - not in the
 * sparse checkout, and {@code BaseTestCase} drags in JUnit - so this is the same
 * wiring written out here.
 *
 * <b>Preferences are deliberately inert.</b> Every value the flight depends on is
 * set explicitly on {@code SimulationOptions} by the scenario, so a preference
 * read is a BUG in the comparison, not a knob: two engines agreeing because they
 * read the same default is not evidence, and two disagreeing because their
 * defaults differ is a false alarm. The handful of values below are the ones
 * upstream's own test stub supplies, kept identical so core's own paths behave as
 * upstream's tests expect them to.
 */
public final class Bootstrap {

    private Bootstrap() {
    }

    private static boolean done;

    /** Idempotent: installs the injector the first time, no-ops after. */
    public static synchronized void init() {
        if (done) {
            return;
        }
        // Upstream's test translator pins US so message lookups are stable; the
        // harness prints no translated text, but core logs and warnings go
        // through it and a turkish-locale toLowerCase would be a real hazard.
        Locale.setDefault(Locale.US);

        Module application = new AbstractModule() {
            @Override
            protected void configure() {
                bind(ApplicationPreferences.class).to(ReferencePreferences.class);
                bind(Translator.class).toInstance(new ResourceBundleTranslator("l10n.messages"));
                bind(RocketDescriptor.class).to(RocketDescriptorImpl.class);
            }
        };
        Injector injector = Guice.createInjector(Modules.override(application).with(new PluginModule()));
        Application.setInjector(injector);
        done = true;
    }

    /**
     * The minimum {@code ApplicationPreferences} core will run against.
     *
     * Values match upstream's {@code ServicesForTesting.PreferencesForTesting}.
     * Anything not named here answers with the caller's default rather than a
     * silent zero, which is the one deliberate difference: upstream's stub
     * returns 0 for every unrecognized double, and a 0 arriving where a real
     * default was expected is exactly the kind of thing that would look like an
     * engine disagreement.
     */
    public static class ReferencePreferences extends ApplicationPreferences {

        private static java.util.prefs.Preferences root;

        @Override
        public boolean getBoolean(String key, boolean defaultValue) {
            return defaultValue;
        }

        @Override
        public void putBoolean(String key, boolean value) {
        }

        @Override
        public int getInt(String key, int defaultValue) {
            return defaultValue;
        }

        @Override
        public void putInt(String key, int value) {
        }

        @Override
        public double getDouble(String key, double defaultValue) {
            if (ApplicationPreferences.LAUNCH_TEMPERATURE.equals(key)) {
                return ExtendedISAModel.STANDARD_TEMPERATURE;
            }
            if (ApplicationPreferences.LAUNCH_PRESSURE.equals(key)) {
                return ExtendedISAModel.STANDARD_PRESSURE;
            }
            if (ApplicationPreferences.LAUNCH_RELATIVE_HUMIDITY.equals(key)) {
                return ExtendedISAModel.STANDARD_RELATIVE_HUMIDITY;
            }
            if (ApplicationPreferences.CONSTANT_GRAVITY_VALUE.equals(key)) {
                return 9.807;
            }
            return defaultValue;
        }

        @Override
        public void putDouble(String key, double value) {
        }

        @Override
        public String getString(String key, String defaultValue) {
            return defaultValue;
        }

        @Override
        public void putString(String key, String value) {
        }

        @Override
        public String getString(String directory, String key, String defaultValue) {
            return defaultValue;
        }

        @Override
        public void putString(String directory, String key, String value) {
        }

        @Override
        public void addUserMaterial(Material m) {
        }

        @Override
        public Set<Material> getUserMaterials() {
            return Collections.emptySet();
        }

        @Override
        public void removeUserMaterial(Material m) {
        }

        @Override
        public void setComponentFavorite(ComponentPreset preset, ComponentPreset.Type type, boolean favorite) {
        }

        @Override
        public Set<String> getComponentFavorites(ComponentPreset.Type type) {
            return Collections.emptySet();
        }

        @Override
        public java.util.prefs.Preferences getNode(String nodeName) {
            return base().node(nodeName);
        }

        @Override
        public java.util.prefs.Preferences getPreferences() {
            return base();
        }

        /**
         * A scratch node, never read back. Core asks for one during startup; it
         * must not be the user's real OpenRocket node, or running the reference
         * would mutate the preferences of an OpenRocket install on this machine.
         */
        private static synchronized java.util.prefs.Preferences base() {
            if (root == null) {
                root = java.util.prefs.Preferences.userRoot()
                        .node("OpenRocket-reference-" + System.nanoTime());
            }
            return root;
        }
    }
}
