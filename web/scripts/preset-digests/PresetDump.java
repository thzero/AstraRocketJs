import com.google.inject.Guice;
import com.google.inject.Injector;
import com.google.inject.Module;
import info.openrocket.core.database.ComponentPresetDatabase;
import info.openrocket.core.database.ComponentPresetDatabaseLoader;
import info.openrocket.core.plugin.PluginModule;
import info.openrocket.core.preset.ComponentPreset;
import info.openrocket.core.startup.Application;
import info.openrocket.core.startup.CoreModule;

import java.io.PrintWriter;

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
 * WHY IT READS THE DATABASE rather than `.orc` files. The file loader and the
 * running application disagree for some types: measured on Estes PK-12, loading
 * the file gave cd19839d… and the application's database gave e38b3873…, and the
 * application's is the one the desktop compares against.
 *
 * WHY THE BUILD MATTERS. A part whose `.orc` row states a MASS has its material
 * replaced by one looked up by density, so its digest depends on the material
 * database that build ships. Measured on Estes PNC-50KA: 24.12 says
 * b3b5899e… and the 26.xx source tree says d1a20a7d…, while parts with no stated
 * mass agree across both. So the digests are only as right as the build this is
 * pointed at, which is why the script that drives this takes that path.
 *
 * Output: one TAB-separated row per preset, `TYPE  manufacturer  partNo  digest`.
 */
public class PresetDump {
    public static void main(String[] args) throws Exception {
        if (args.length < 1) {
            System.err.println("usage: PresetDump <out.tsv>");
            System.exit(2);
        }
        // The application's own module, so the material database and preferences
        // are the ones the app boots with. The preset loader is driven directly
        // rather than through `Application.getComponentPresetDao()`, which is not
        // bound in every release.
        CoreModule core = new CoreModule();
        Module plugins = new PluginModule();
        Injector injector = Guice.createInjector(core, plugins);
        Application.setInjector(injector);

        ComponentPresetDatabaseLoader loader = new ComponentPresetDatabaseLoader();
        loader.startLoading();
        ComponentPresetDatabase db = loader.getDatabase();

        int rows = 0;
        try (PrintWriter out = new PrintWriter(args[0], "UTF-8")) {
            for (ComponentPreset p : db.listAll()) {
                out.println(String.join("\t",
                        p.getType().name(),
                        p.getManufacturer().getSimpleName(),
                        p.getPartNo(),
                        p.getDigest()));
                rows++;
            }
        }
        System.out.println("presets=" + rows);
    }
}
