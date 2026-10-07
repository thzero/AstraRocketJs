package api;

import info.openrocket.core.models.atmosphere.AtmosphericConditions;
import info.openrocket.core.models.atmosphere.AtmosphericModel;
import info.openrocket.core.models.atmosphere.ExtendedISAModel;
import info.openrocket.core.util.ModID;

/**
 * A measured or forecast atmosphere: temperature, pressure and humidity at a
 * set of altitudes, in place of the standard atmosphere above the launch site.
 *
 * <h2>Why it is here and not in the kernel</h2>
 *
 * Upstream's only atmosphere is {@code ExtendedISAModel}: the site's own
 * temperature, pressure and humidity, then the standard lapse rate above it.
 * OpenRocket issue #2737 proposes taking temperature aloft from a forecast;
 * nothing for it exists upstream yet. {@code AtmosphericModel} is a one-method
 * interface the simulation reads through {@code SimulationConditions}, so this
 * class plugs in from the bridge with no patched kernel file. When upstream
 * ships its own model, this class goes and the bridge builds that one instead.
 *
 * <h2>Between levels</h2>
 *
 * Temperature and humidity are linear in altitude. Pressure is linear in its
 * LOGARITHM, which is exact for an isothermal layer and within a few pascals of
 * the barometric formula across the layers a forecast reports, and it passes
 * through every stated pressure exactly, which the barometric formula from one
 * level does not reach at the next.
 *
 * <h2>Outside the levels</h2>
 *
 * Below the lowest level and above the highest, the profile follows the
 * standard atmosphere's SHAPE from the end level: the standard temperature
 * change and the standard pressure ratio, applied to that level's values. The
 * profile is continuous at both ends, and a flight past the top of a forecast
 * (30 hPa is about 24 km) keeps a physical atmosphere instead of a frozen one.
 * Humidity holds at the end level's value.
 *
 * Altitudes are meters above sea level, as the simulation asks for them.
 */
final class AtmosphereProfile implements AtmosphericModel {

    private static final ExtendedISAModel STANDARD = new ExtendedISAModel();

    private final double[] altitude;
    private final double[] temperature;
    private final double[] logPressure;
    private final double[] humidity;

    /**
     * @param altitude    meters above sea level, strictly increasing
     * @param temperature kelvin, positive
     * @param pressure    pascals, positive and falling with altitude
     * @param humidity    relative humidity as a fraction, 0 to 1
     */
    AtmosphereProfile(double[] altitude, double[] temperature, double[] pressure, double[] humidity) {
        int n = altitude.length;
        if (n == 0) {
            throw new IllegalArgumentException("an atmosphere profile needs at least one level");
        }
        if (temperature.length != n || pressure.length != n || humidity.length != n) {
            throw new IllegalArgumentException("atmosphere profile columns differ in length");
        }
        this.altitude = altitude.clone();
        this.temperature = temperature.clone();
        this.logPressure = new double[n];
        this.humidity = humidity.clone();
        for (int i = 0; i < n; i++) {
            String which = "atmosphere level " + (i + 1) + " of " + n;
            if (!Double.isFinite(altitude[i])) {
                throw new IllegalArgumentException(which + " has no usable altitude");
            }
            if (i > 0 && !(altitude[i] > altitude[i - 1])) {
                throw new IllegalArgumentException(which + " is not above the level before it");
            }
            if (!(temperature[i] > 0) || !Double.isFinite(temperature[i])) {
                throw new IllegalArgumentException(which + " needs a positive temperature in kelvin");
            }
            if (!(pressure[i] > 0) || !Double.isFinite(pressure[i])) {
                throw new IllegalArgumentException(which + " needs a positive pressure in pascals");
            }
            if (i > 0 && !(pressure[i] < pressure[i - 1])) {
                throw new IllegalArgumentException(which + " has a pressure no lower than the level below it");
            }
            if (!(humidity[i] >= 0 && humidity[i] <= 1)) {
                throw new IllegalArgumentException(which + " needs a relative humidity between 0 and 1");
            }
            logPressure[i] = Math.log(pressure[i]);
        }
    }

    @Override
    public AtmosphericConditions getConditions(double alt) {
        int last = altitude.length - 1;
        if (alt <= altitude[0]) {
            return standardShapeFrom(0, alt);
        }
        if (alt >= altitude[last]) {
            return standardShapeFrom(last, alt);
        }
        int i = 0;
        while (altitude[i + 1] < alt) {
            i++;
        }
        double f = (alt - altitude[i]) / (altitude[i + 1] - altitude[i]);
        return new AtmosphericConditions(
                lerp(temperature[i], temperature[i + 1], f),
                Math.exp(lerp(logPressure[i], logPressure[i + 1], f)),
                lerp(humidity[i], humidity[i + 1], f));
    }

    private AtmosphericConditions standardShapeFrom(int level, double alt) {
        AtmosphericConditions atLevel = STANDARD.getConditions(altitude[level]);
        AtmosphericConditions atAlt = STANDARD.getConditions(alt);
        return new AtmosphericConditions(
                temperature[level] + (atAlt.getTemperature() - atLevel.getTemperature()),
                Math.exp(logPressure[level]) * atAlt.getPressure() / atLevel.getPressure(),
                humidity[level]);
    }

    private static double lerp(double a, double b, double f) {
        return a + (b - a) * f;
    }

    /** Immutable once built, so its state never changes. */
    @Override
    public ModID getModID() {
        return ModID.ZERO;
    }
}
