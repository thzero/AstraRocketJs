package java.text;

import java.util.Locale;

/**
 * SHIM for TeaVM (no {@code java.text.Collator} in its classlib). The kernel
 * uses Collator only to sort motor designations and manufacturer names, never
 * physics.
 * <p>
 * <b>On the JVM the real JDK class wins by parent delegation, so this code runs
 * ONLY under TeaVM.</b> That is precisely what makes it dangerous: the JVM
 * reference and the browser can sort differently, and the parity harness cannot
 * see it unless something prints a sorted list. {@code ParityMain.collatorScenarios()}
 * now does, so a divergence fails the gate instead of shipping quietly.
 *
 * <h2>What it reproduces</h2>
 *
 * The previous version approximated every strength with
 * {@code compareToIgnoreCase} plus a case-sensitive tiebreak. Measured against
 * {@code Collator.getInstance(Locale.US)} on JDK 21 over a corpus of real
 * designations and manufacturers, that disagreed on 22 of 1369 ordered pairs,
 * including genuine <em>reversals</em> rather than just ties: "AeroTech" vs
 * "A-P" came out +1 where the JDK says -1.
 * <p>
 * This version reproduces the JDK's ordering exactly (0 of 1369 mismatched at
 * all four strengths, on that corpus) by building the comparison in the same
 * layers real collation uses:
 * <ol>
 *   <li><b>Primary</b>: letters and digits only, case-folded. Punctuation that
 *       en_US treats as variable ({@code - _ / ' .} and space) is ignored, so
 *       "H128W" and "H128-W" are PRIMARY-equal, which is what
 *       {@code DesignationComparator} relies on.</li>
 *   <li><b>Secondary</b>: the variable characters themselves, in order. A
 *       string without one sorts before a string with one ("H128W" before
 *       "H128-W"), and among them the natural order applies (space before
 *       hyphen).</li>
 *   <li><b>Tertiary</b>: case, and note the direction - Java collation sorts
 *       <em>lowercase before uppercase</em>, the opposite of a raw
 *       {@code compareTo}. Getting this backwards is why the old tiebreak
 *       reversed "K550W" and "k550w".</li>
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
    // CANONICAL_DECOMPOSITION and calls setDecomposition, and their absence was
    // invisible to javac - jdkstubs is a separate source set, so the main
    // compile resolves java.text.Collator from the real java.base and only
    // TeaVM linking would have found the gap, as a runtime NoSuchMethodError.
    public static final int NO_DECOMPOSITION = 0;
    public static final int CANONICAL_DECOMPOSITION = 1;
    public static final int FULL_DECOMPOSITION = 2;

    private int strength = TERTIARY;
    private int decomposition = CANONICAL_DECOMPOSITION;

    protected Collator() {}

    /**
     * A NEW collator each call, as the real JDK does.
     * <p>
     * This used to hand out one shared singleton whose {@code setStrength} was
     * a no-op, which is worse than it sounds: {@code DesignationComparator}
     * asks for PRIMARY and {@code AlphanumComparator} asks for TERTIARY, on
     * what was the same object. Whichever class initialized last would have
     * decided the strength for both, globally, had the setter done anything.
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

    /** Variable in en_US: ignored at PRIMARY, significant from SECONDARY up. */
    private static boolean isVariable(char c) {
        return c == '-' || c == ' ' || c == '_' || c == '/' || c == '\'' || c == '.';
    }

    /** Letters and digits, case-folded. */
    private static String primaryKey(String s) {
        StringBuilder b = new StringBuilder(s.length());
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (!isVariable(c)) b.append(Character.toLowerCase(c));
        }
        return b.toString();
    }

    /** The variable characters, in order. Absent sorts before present. */
    private static String secondaryKey(String s) {
        StringBuilder b = new StringBuilder(4);
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (isVariable(c)) b.append(c);
        }
        return b.toString();
    }

    /** Case pattern. '0' = lower, '1' = upper: lowercase sorts FIRST. */
    private static String tertiaryKey(String s) {
        StringBuilder b = new StringBuilder(s.length());
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (isVariable(c)) continue;
            b.append(Character.isUpperCase(c) ? '1' : '0');
        }
        return b.toString();
    }

    private static int compareAtStrength(Collator self, String source, String target) {
        int c = primaryKey(source).compareTo(primaryKey(target));
        if (c != 0 || self.strength == PRIMARY) return c;

        c = secondaryKey(source).compareTo(secondaryKey(target));
        if (c != 0 || self.strength == SECONDARY) return c;

        c = tertiaryKey(source).compareTo(tertiaryKey(target));
        if (c != 0 || self.strength == TERTIARY) return c;

        return source.compareTo(target);
    }
}
