import com.google.inject.Guice;
import com.google.inject.Injector;
import com.google.inject.Module;
import info.openrocket.core.database.ComponentPresetDatabase;
import info.openrocket.core.file.iterator.DirectoryIterator;
import info.openrocket.core.file.iterator.FileIterator;
import info.openrocket.core.gui.util.SimpleFileFilter;
import info.openrocket.core.material.Material;
import info.openrocket.core.plugin.PluginModule;
import info.openrocket.core.preset.ComponentPreset;
import info.openrocket.core.preset.TypedKey;
import info.openrocket.core.preset.xml.OpenRocketComponentLoader;
import info.openrocket.core.rocketcomponent.Parachute;
import info.openrocket.core.startup.Application;
import info.openrocket.core.startup.CoreModule;
import info.openrocket.core.util.Pair;

import java.io.File;
import java.io.InputStream;
import java.io.PrintWriter;
import java.util.ArrayList;
import java.util.List;

/**
 * Dump every component preset an OpenRocket build holds, with the digest that
 * build itself computed for it.
 *
 * WHY THIS IS JAVA. A `.ork` identifies a catalog part by a digest, and the
 * desktop rejects a `<preset>` element without one. That digest is an MD5 over
 * the preset's properties as `ComponentPresetFactory` leaves them, not as the
 * `.orc` states them: a tube's wall is derived from its two diameters, a
 * material density from a stated mass, and an integer property contributes its
 * name and no value. Reimplementing that is a second copy of the logic, and a
 * wrong digest is WORSE than none, because the desktop then reports the part as
 * changed rather than missing.
 *
 * WHY IT RUNS UNDER THE APPLICATION'S MODULE. It reads the release's own `.orc`
 * files, the system pass of `ComponentPresetDatabaseLoader`, but with the
 * application's Guice module installed, so the presets are built against the
 * material database and preferences the desktop boots with. A bare file load
 * disagrees for some types, and the application's database is the one the
 * desktop compares against.
 *
 * WHY THE BUILD MATTERS. A part whose `.orc` row states a MASS has its material
 * replaced by one looked up by density, so its digest depends on the material
 * database that build ships: a release and a source checkout give such a part
 * different digests, while parts with no stated mass agree across both. So the
 * digests are only as right as the build this is pointed at, which is why the
 * script that drives this checks that build against the pinned release.
 *
 * Output: one TAB-separated row per preset,
 *
 *   TYPE  names  partNo  digest  mass  geometry  parachute  legacy  massDensity  description
 *
 * - names: every name the maker goes by (`Manufacturer.getAllNames()`), joined
 *   by `|`. The desktop folds aliases into one maker ("LOC Precision" and "LOC"
 *   are both "LOC/Precision") and finds a part by any of them.
 * - partNo: exactly as the desktop holds it, trailing spaces included, because
 *   `ComponentPresetDatabase.find` compares it with `equals`.
 * - mass: kilograms, empty when the preset states none.
 * - geometry: `Key=value` pairs joined by `;`, every stated size in meters, so
 *   parts that share a maker, part number and description can be told apart.
 * - parachute: empty for any other type; otherwise what `Parachute.loadFromPreset`
 *   leaves on a new parachute, as `Key=value` pairs joined by `;` (see
 *   {@link #parachute}).
 * - legacy: `true` for a preset from one of the library's legacy files
 *   (`ComponentPreset.LEGACY`, set from the file's `<Legacy/>`), which the
 *   desktop's chooser hides until "Show Legacy Database" is checked; `false`
 *   otherwise.
 * - massDensity: for a preset that states a mass, the density
 *   `ComponentPresetFactory` gave its material (the mass over the part's
 *   volume), `Infinity` when that build gives the part no volume; empty when
 *   the preset states no mass.
 * - description: last because it is free text; tabs and line breaks in it are
 *   flattened to spaces.
 */
public class PresetDump {
    /** The sizes a catalog row also states, by the preset key that holds them. */
    private static final List<TypedKey<Double>> GEOMETRY = List.of(
            ComponentPreset.OUTER_DIAMETER,
            ComponentPreset.INNER_DIAMETER,
            ComponentPreset.LENGTH,
            ComponentPreset.DIAMETER,
            ComponentPreset.FORE_OUTER_DIAMETER,
            ComponentPreset.AFT_OUTER_DIAMETER,
            ComponentPreset.WIDTH,
            ComponentPreset.HEIGHT);

    /** Where the release jar keeps its `.orc` files. */
    private static final String SYSTEM_PRESET_DIR = "datafiles/components";

    public static void main(String[] args) throws Exception {
        if (args.length < 1) {
            System.err.println("usage: PresetDump <out.tsv>");
            System.exit(2);
        }
        // The application's own module, so the material database and preferences
        // are the ones the app boots with. Under CoreModule the user's own
        // materials are an empty set, so the material database is the release's.
        CoreModule core = new CoreModule();
        Module plugins = new PluginModule();
        Injector injector = Guice.createInjector(core, plugins);
        Application.setInjector(injector);

        // Only the presets the release ships. `ComponentPresetDatabaseLoader`
        // also reads the user's own `.orc` files from the desktop's component
        // directory, and a row matched to one of those would carry a digest no
        // other desktop has. This is that loader's system pass, step for step.
        ComponentPresetDatabase db = new ComponentPresetDatabase();
        FileIterator files = DirectoryIterator.findDirectory(SYSTEM_PRESET_DIR, new SimpleFileFilter("", false, "orc"));
        if (files == null) {
            System.err.println("no " + SYSTEM_PRESET_DIR + " on the class path");
            System.exit(1);
        }
        while (files.hasNext()) {
            Pair<File, InputStream> f = files.next();
            try (InputStream in = f.getV()) {
                db.addAll(new OpenRocketComponentLoader().load(in, f.getU().getName()));
            }
        }

        int rows = 0;
        try (PrintWriter out = new PrintWriter(args[0], "UTF-8")) {
            for (ComponentPreset p : db.listAll()) {
                out.println(String.join("\t",
                        p.getType().name(),
                        String.join("|", new ArrayList<>(p.getManufacturer().getAllNames())),
                        p.getPartNo(),
                        p.getDigest(),
                        p.has(ComponentPreset.MASS) ? Double.toString(p.get(ComponentPreset.MASS)) : "",
                        geometry(p),
                        p.getType() == ComponentPreset.Type.PARACHUTE ? parachute(p) : "",
                        Boolean.toString(p.has(ComponentPreset.LEGACY) && p.get(ComponentPreset.LEGACY)),
                        p.has(ComponentPreset.MASS) && p.has(ComponentPreset.MATERIAL)
                                ? Double.toString(p.get(ComponentPreset.MATERIAL).getDensity())
                                : "",
                        p.has(ComponentPreset.DESCRIPTION)
                                ? flat(p.get(ComponentPreset.DESCRIPTION))
                                : ""));
                rows++;
            }
        }
        System.out.println("presets=" + rows);
    }

    private static String flat(String s) {
        return s.replaceAll("[\\t\\r\\n]+", " ").trim();
    }

    private static String geometry(ComponentPreset p) {
        List<String> out = new ArrayList<>();
        for (TypedKey<Double> k : GEOMETRY) {
            if (p.has(k)) out.add(k.getName() + "=" + p.get(k));
        }
        return String.join(";", out);
    }

    /**
     * What `Parachute.loadFromPreset` applies, read back from a parachute it was
     * applied to: the line count and length, the packed length and diameter it
     * sets only when the preset states them, the canopy and line materials it
     * takes from the preset (absent when it falls back to the default), and the
     * mass the desktop then gives the canopy and lines. Material names are
     * flattened the way the description is, and never hold `;` or `=`.
     */
    private static String parachute(ComponentPreset p) {
        Parachute chute = new Parachute();
        chute.loadPreset(p);
        List<String> out = new ArrayList<>();
        out.add("LineCount=" + chute.getLineCount());
        out.add("LineLength=" + chute.getLineLength());
        if (p.has(ComponentPreset.PACKED_LENGTH) && p.get(ComponentPreset.PACKED_LENGTH) > 0) {
            out.add("PackedLength=" + p.get(ComponentPreset.PACKED_LENGTH));
        }
        if (p.has(ComponentPreset.PACKED_DIAMETER) && p.get(ComponentPreset.PACKED_DIAMETER) > 0) {
            out.add("PackedDiameter=" + p.get(ComponentPreset.PACKED_DIAMETER));
        }
        if (p.has(ComponentPreset.MATERIAL) && chute.getMaterial() == p.get(ComponentPreset.MATERIAL)) {
            material(out, "Material", chute.getMaterial());
        }
        if (p.has(ComponentPreset.LINE_MATERIAL) && chute.getLineMaterial() == p.get(ComponentPreset.LINE_MATERIAL)) {
            material(out, "LineMaterial", chute.getLineMaterial());
        }
        out.add("ComponentMass=" + chute.getComponentMass());
        return String.join(";", out);
    }

    private static void material(List<String> out, String key, Material m) {
        out.add(key + "=" + flat(m.getName()).replaceAll("[;=]", " "));
        out.add(key + "Density=" + m.getDensity());
    }
}
