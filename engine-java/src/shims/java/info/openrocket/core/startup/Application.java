package info.openrocket.core.startup;

import com.google.inject.Injector;

import info.openrocket.core.formatting.RocketDescriptor;
import info.openrocket.core.l10n.DebugTranslator;
import info.openrocket.core.l10n.Translator;
import info.openrocket.core.preferences.ApplicationPreferences;

/**
 * SHIM replacing OpenRocket's Guice-backed Application service locator.
 * Provides exactly the static surface the carved kernel uses, hand-wired.
 * Identical behavior on JVM and TeaVM (this class compiles into both), so
 * differential tests are unaffected by shim choices.
 */
public final class Application {

    private static final Translator TRANSLATOR = new DebugTranslator(null);
    private static final ApplicationPreferences PREFERENCES = new ApplicationPreferences();
    private static ExceptionHandler exceptionHandler = new ExceptionHandler() {
        @Override
        public void handleErrorCondition(String message) {
            System.err.println("ERROR: " + message);
        }

        @Override
        public void handleErrorCondition(String message, Throwable exception) {
            System.err.println("ERROR: " + message + ": " + exception);
        }

        @Override
        public void handleErrorCondition(Throwable exception) {
            System.err.println("ERROR: " + exception);
        }

        @Override
        public void uncaughtException(Thread thread, Throwable throwable) {
            System.err.println("UNCAUGHT: " + throwable);
        }
    };

    /** Minimal hand-wired injector: only the bindings the kernel requests. */
    private static final Injector INJECTOR = new Injector() {
        private final RocketDescriptor rocketDescriptor = new ShimRocketDescriptor();

        @Override
        @SuppressWarnings("unchecked")
        public <T> T getInstance(Class<T> type) {
            if (type == RocketDescriptor.class) {
                return (T) rocketDescriptor;
            }
            throw new IllegalArgumentException("Shim injector has no binding for: " + type.getName());
        }
    };

    private Application() {}

    public static boolean useSafetyChecks() {
        return false;
    }

    /**
     * A bare {@code DebugTranslator}, DELIBERATELY - do not "fix" this to match
     * upstream.
     * <p>
     * Upstream wraps the base translator in {@code ClassBasedTranslator} and
     * {@code ExceptionSuppressingTranslator}, which turn keys into prose. Here
     * the bracket form IS the protocol: every kernel string arrives as
     * {@code [Warning.RECOVERY_HIGH_SPEED]}, and
     * {@code web/src/services/warningText.ts} parses exactly that, with tests
     * asserting it. Stable machine keys beat untranslatable English at a
     * boundary the app has to localize itself.
     * <p>
     * Restoring upstream's chain is a one-line change that would silently break
     * every warning string in the UI, with only the web test to catch it.
     */
    public static Translator getTranslator() {
        return TRANSLATOR;
    }

    public static ApplicationPreferences getPreferences() {
        return PREFERENCES;
    }

    public static ExceptionHandler getExceptionHandler() {
        return exceptionHandler;
    }

    public static void setExceptionHandler(ExceptionHandler handler) {
        exceptionHandler = handler;
    }

    public static Injector getInjector() {
        return INJECTOR;
    }
}
