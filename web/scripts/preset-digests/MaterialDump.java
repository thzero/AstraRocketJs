import com.google.inject.Guice;
import com.google.inject.Injector;
import info.openrocket.core.database.Databases;
import info.openrocket.core.material.Material;
import info.openrocket.core.plugin.PluginModule;
import info.openrocket.core.startup.Application;
import info.openrocket.core.startup.CoreModule;

import java.io.PrintWriter;
import java.util.List;

/**
 * Dump the built-in materials an OpenRocket build ships: the ones a catalog
 * part falls back to when its own `.orc` file does not define its material.
 *
 * Read from the release jar rather than from `Databases.java` in a source tree,
 * because the two differ: the source tree the engine is extracted from adds
 * materials the release does not have, and a part naming one would weigh
 * something in the catalog and nothing on desktop.
 *
 * Under CoreModule the user's own materials are an empty set, so these are the
 * release's alone.
 *
 * Output: one TAB-separated row per material, `TYPE  name  density`, density in
 * the SI unit of its type (kg/m^3, kg/m^2 or kg/m).
 */
public class MaterialDump {
    public static void main(String[] args) throws Exception {
        if (args.length < 1) {
            System.err.println("usage: MaterialDump <out.tsv>");
            System.exit(2);
        }
        Injector injector = Guice.createInjector(new CoreModule(), new PluginModule());
        Application.setInjector(injector);

        int rows = 0;
        try (PrintWriter out = new PrintWriter(args[0], "UTF-8")) {
            for (Material.Type type : List.of(Material.Type.BULK, Material.Type.SURFACE, Material.Type.LINE)) {
                for (Material m : Databases.getDatabase(type)) {
                    out.println(String.join("\t",
                            type.name(),
                            m.getName().replaceAll("[\t\r\n]+", " "),
                            Double.toString(m.getDensity())));
                    rows++;
                }
            }
        }
        System.out.println("materials=" + rows);
    }
}
