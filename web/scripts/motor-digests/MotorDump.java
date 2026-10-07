import info.openrocket.core.motor.Manufacturer;
import info.openrocket.core.motor.ThrustCurveMotor;

import java.io.BufferedInputStream;
import java.io.InputStream;
import java.io.ObjectInputStream;
import java.io.PrintWriter;
import java.util.ArrayList;
import java.util.List;

/**
 * Dump every motor an OpenRocket build ships, with the digest that build itself
 * computed for it.
 *
 * WHY A MOTOR NEEDS A DIGEST IN A `.ork`. The desktop resolves a motor by
 * manufacturer, designation, diameter and length, and its database holds SEVERAL
 * entries behind one of those names: Estes C6 is three, a plugged one and two
 * copies of the delayed one, from different source files. With no digest to pick
 * between them `DatabaseMotorFinder` takes the first and says so, as "Multiple
 * motors with designation 'C6' for manufacturer 'Estes' found, one chosen
 * arbitrarily". The digest is the only field that names WHICH entry, which is
 * why the desktop writes one into every `<motor>` block it saves.
 *
 * WHY THIS IS JAVA, and not a checksum computed from our own curve. The digest
 * is an MD5 over the motor's time, mass, CG and thrust series at fixed
 * precision (`MotorDigest`), so it describes the data in THAT database rather
 * than the motor as a product. Our curves come from thrustcurve.org and theirs
 * from a database serialized at their release; equal motors, not always equal
 * samples. A digest we computed ourselves would therefore name no entry at all,
 * which is the failure being fixed, and a digest that matches nothing is worse
 * than none: with one candidate the desktop then reports the motor as CHANGED
 * rather than resolving it.
 *
 * WHY IT READS THE SHIPPED FILE rather than driving `MotorDatabaseLoader`. That
 * loader also sweeps the USER's own motor directory, so what it holds depends on
 * whose machine this runs on, and a digest for somebody's local `.rse` is a
 * digest no other reader's desktop has. `thrustcurves.ser` is the database as
 * the release ships it, and the digest comes off the motor object itself, which
 * is the same object the loader would have deserialized from the same bytes.
 *
 * Output: one TAB-separated row per motor,
 * `manufacturer  allNames  designation  commonName  diameter(m)  length(m)
 *  delays  impulse(Ns)  burn(s)  maxThrust(N)  digest`, where `delays` is
 * comma-separated seconds with `P` for a plugged motor.
 *
 * THE THREE NUMBERS are there to tell two entries of the same name apart. Where
 * a name resolves to several, the delay usually decides; where it does not, the
 * sync picks the entry whose curve is closest to the one our own catalog holds,
 * so the desktop flies the motor the design was built with rather than a
 * namesake.
 *
 * BOTH NAMES, because they differ and our catalog holds either: the desktop's
 * designation is the maker's full code ("D24T"), its common name the impulse
 * one ("D24"), and a row synced from thrustcurve.org may be keyed on either.
 */
public class MotorDump {
    private static final String DATABASE = "datafiles/thrustcurves/thrustcurves.ser";

    public static void main(String[] args) throws Exception {
        if (args.length < 1) {
            System.err.println("usage: MotorDump <out.tsv>");
            System.exit(2);
        }
        List<?> motors;
        try (InputStream is = MotorDump.class.getClassLoader().getResourceAsStream(DATABASE)) {
            if (is == null) {
                System.err.println("no " + DATABASE + " on the classpath; is that an OpenRocket build?");
                System.exit(2);
                return;
            }
            try (ObjectInputStream in = new ObjectInputStream(new BufferedInputStream(is))) {
                motors = (List<?>) in.readObject();
            }
        }

        int rows = 0;
        try (PrintWriter out = new PrintWriter(args[0], "UTF-8")) {
            for (Object o : motors) {
                ThrustCurveMotor m = (ThrustCurveMotor) o;
                Manufacturer mfr = m.getManufacturer();
                // Every alias, because our catalog names a manufacturer by
                // thrustcurve.org's abbreviation ("AT") where the desktop holds
                // the full name ("AeroTech"), and `Manufacturer` is the only
                // place that knows the two are one maker.
                List<String> names = new ArrayList<>(mfr.getAllNames());
                out.println(String.join("\t",
                        mfr.getSimpleName(),
                        String.join("|", names),
                        m.getDesignation(),
                        m.getCommonName(),
                        Double.toString(m.getDiameter()),
                        Double.toString(m.getLength()),
                        delays(m.getStandardDelays()),
                        Double.toString(m.getTotalImpulseEstimate()),
                        Double.toString(m.getBurnTimeEstimate()),
                        Double.toString(m.getMaxThrustEstimate()),
                        m.getDigest()));
                rows++;
            }
        }
        System.out.println("motors=" + rows);
    }

    /** Standard delays as the catalog states them: seconds, `P` for plugged. */
    private static String delays(double[] delays) {
        StringBuilder sb = new StringBuilder();
        for (double d : delays) {
            if (sb.length() > 0) {
                sb.append(',');
            }
            sb.append(Double.isInfinite(d) ? "P" : Long.toString(Math.round(d)));
        }
        return sb.toString();
    }
}
