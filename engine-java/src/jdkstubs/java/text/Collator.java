package java.text;

import java.util.Locale;

/**
 * SHIM for TeaVM (no {@code java.text.Collator} in its classlib). The kernel
 * uses Collator only to sort motor designations and manufacturer names, never
 * physics.
 * <p>
 * <b>On the JVM the real JDK class wins by parent delegation, so this code runs
 * only under TeaVM.</b> The JVM reference and the browser can therefore sort
 * differently, and the parity harness sees it only if something prints a sorted
 * list. {@code ParityMain.collatorScenarios()} does, so a divergence fails the gate.
 *
 * <h2>What it reproduces</h2>
 *
 * Approximating every strength with {@code compareToIgnoreCase} plus a
 * case-sensitive tiebreak is not enough. Measured against
 * {@code Collator.getInstance(Locale.US)} on JDK 21 over a corpus of real
 * designations and manufacturers, that disagrees on 22 of 1369 ordered pairs,
 * including genuine <em>reversals</em> rather than just ties: "AeroTech" vs "A-P"
 * comes out +1 where the JDK says -1.
 * <p>
 * This reproduces the JDK's ordering exactly by building the comparison in the
 * same layers real collation uses. Measured against JDK 21's
 * {@code Collator.getInstance(Locale.US)} at all four strengths over every string
 * of up to three characters from {@code space - . _ ' / 0 1 a A} plus real
 * designations and manufacturers (1,140 strings, 5,198,400 ordered pairs): 0
 * mismatched.
 * <ol>
 *   <li><b>Primary</b>: every character but space and {@code -}, case-folded.
 *       Those two are the only ones en_US ignores here, so "H128W" and "H128-W"
 *       are PRIMARY-equal, which is what {@code DesignationComparator} relies
 *       on. {@code _ / . '} are not ignored: they carry primary weights, in that
 *       order, ahead of every digit and letter. Ignoring them would make "H128W"
 *       and "H128.W" equal, and two motors that compare equal through both steps of
 *       {@code ThrustCurveMotor.compareTo} are one motor to a sorted set.</li>
 *   <li><b>Secondary</b>: a weight per character, compared in order: space and
 *       {@code -} weigh more than everything else, space less than {@code -}.
 *       So a string without one sorts before a string with one ("H128W" before
 *       "H128-W"), and where it falls matters, not only which it is.</li>
 *   <li><b>Tertiary</b>: case, per character, and note the direction - Java
 *       collation sorts <em>lowercase before uppercase</em>, the opposite of a
 *       raw {@code compareTo}. Backwards, this reverses "K550W" and "k550w".</li>
 *   <li><b>Identical</b>: raw code-point order as the final discriminator.</li>
 * </ol>
 *
 * <h2>What it does not reproduce</h2>
 *
 * This is not a collation engine. There is no locale data, no accent handling
 * beyond code-point order, no contractions or expansions, and no normalization
 * - {@link #setDecomposition} is accepted and ignored. That is adequate for
 * ASCII motor designations and manufacturer names, which is all the extracted
 * kernel sorts. It would not be adequate for user-facing natural-language text,
 * so do not widen its use without revisiting this.
 */
public abstract class Collator implements java.util.Comparator<Object> {

    public static final int PRIMARY = 0;
    public static final int SECONDARY = 1;
    public static final int TERTIARY = 2;
    public static final int IDENTICAL = 3;

    // Accepted and ignored: this shim does no normalization. The constants
    // exist because info.openrocket.core.util.AlphanumComparator references
    // CANONICAL_DECOMPOSITION and calls setDecomposition. javac cannot catch a
    // missing member here: jdkstubs is a separate source set, so the main
    // compile resolves java.text.Collator from the real java.base and only
    // TeaVM linking sees the gap, as a runtime NoSuchMethodError.
    public static final int NO_DECOMPOSITION = 0;
    public static final int CANONICAL_DECOMPOSITION = 1;
    public static final int FULL_DECOMPOSITION = 2;

    private int strength = TERTIARY;
    private int decomposition = CANONICAL_DECOMPOSITION;

    protected Collator() {}

    /**
     * A new collator each call, as the real JDK does.
     * <p>
     * A shared instance would be wrong: {@code DesignationComparator} sets
     * PRIMARY and {@code AlphanumComparator} sets TERTIARY, so whichever class
     * initialized last would decide the strength for both.
     */
    public static Collator getInstance() {
        return getInstance(Locale.getDefault());
    }

    public static Collator getInstance(Locale desiredLocale) {
        return new Collator() {
            @Override
            public int compare(String source, String target) {
                return compareAtStrength(this, source, target);
            }
        };
    }

    public abstract int compare(String source, String target);

    @Override
    public int compare(Object o1, Object o2) {
        return compare((String) o1, (String) o2);
    }

    public void setStrength(int newStrength) {
        this.strength = newStrength;
    }

    public int getStrength() {
        return strength;
    }

    public void setDecomposition(int mode) {
        this.decomposition = mode;
    }

    public int getDecomposition() {
        return decomposition;
    }

    public boolean equals(String source, String target) {
        return compare(source, target) == 0;
    }

    /** Ignored at PRIMARY in en_US, and significant from SECONDARY up. Only these two. */
    private static boolean isVariable(char c) {
        return c == '-' || c == ' ';
    }

    /**
     * A character's primary weight as a char, for a plain {@code compareTo}: the
     * four punctuation marks motor names carry sort ahead of '0' in the JDK's
     * order {@code _ / . '}, and everything else is itself, case-folded.
     */
    private static char primaryWeight(char c) {
        switch (c) {
            case '_': return '\u0001';
            case '/': return '\u0002';
            case '.': return '\u0003';
            case '\'': return '\u0004';
            default: return Character.toLowerCase(c);
        }
    }

    private static String primaryKey(String s) {
        StringBuilder b = new StringBuilder(s.length());
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (!isVariable(c)) b.append(primaryWeight(c));
        }
        return b.toString();
    }

    /** A secondary weight per character: 'a' for most, then space 'b', then hyphen 'c'. */
    private static String secondaryKey(String s) {
        StringBuilder b = new StringBuilder(s.length());
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            b.append(c == ' ' ? 'b' : c == '-' ? 'c' : 'a');
        }
        return b.toString();
    }

    /** Case, per character. '0' = lower, '1' = upper: lowercase sorts first. */
    private static String tertiaryKey(String s) {
        StringBuilder b = new StringBuilder(s.length());
        for (int i = 0; i < s.length(); i++) {
            b.append(Character.isUpperCase(s.charAt(i)) ? '1' : '0');
        }
        return b.toString();
    }

    /** -1, 0 or 1, as the JDK's collator returns, never the raw key difference. */
    private static int compareAtStrength(Collator self, String source, String target) {
        int c = primaryKey(source).compareTo(primaryKey(target));
        if (c != 0 || self.strength == PRIMARY) return Integer.signum(c);

        c = secondaryKey(source).compareTo(secondaryKey(target));
        if (c != 0 || self.strength == SECONDARY) return Integer.signum(c);

        c = tertiaryKey(source).compareTo(tertiaryKey(target));
        if (c != 0 || self.strength == TERTIARY) return Integer.signum(c);

        return Integer.signum(source.compareTo(target));
    }
}
