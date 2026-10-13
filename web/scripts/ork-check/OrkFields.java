import com.google.inject.AbstractModule;
import com.google.inject.Guice;
import com.google.inject.Injector;
import info.openrocket.core.database.ComponentPresetDao;
import info.openrocket.core.database.ComponentPresetDatabase;
import info.openrocket.core.document.OpenRocketDocument;
import info.openrocket.core.file.GeneralRocketLoader;
import info.openrocket.core.plugin.PluginModule;
import info.openrocket.core.rocketcomponent.Rocket;
import info.openrocket.core.rocketcomponent.RocketComponent;
import info.openrocket.core.startup.Application;
import info.openrocket.core.startup.CoreModule;

import java.io.File;
import java.io.PrintWriter;
import java.nio.charset.StandardCharsets;

/**
 * Open each `.ork` or `.rkt` in a real OpenRocket and write what every part
 * holds, field by field, as desktop loaded it.
 *
 * The fields are read by the bridge's own `api.ComponentFields`, compiled
 * against this release, so the desktop and the app's kernel are asked the same
 * questions through the same getters. `scripts/check-desktop-fields.mjs`
 * compares the two.
 *
 *   OrkFields <out.json> <file.ork|file.rkt> [...]
 *
 * Writes one JSON object: each file's path mapped to its parts in tree order
 * (the rocket itself left out), each part as its class name, its depth below
 * the rocket (a stage at 0), its name and its fields. The wiring is
 * `OrkCheck`'s: the preset database has to exist before a file that names a
 * catalog part can load.
 */
public class OrkFields {
    static ComponentPresetDatabase presets;

    public static void main(String[] args) throws Exception {
        if (args.length < 2) {
            System.err.println("usage: OrkFields <out.json> <file.ork|file.rkt> [...]");
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

        StringBuilder out = new StringBuilder("{");
        for (int i = 1; i < args.length; i++) {
            OpenRocketDocument doc = new GeneralRocketLoader(new File(args[i])).load();
            if (i > 1) out.append(',');
            out.append(quote(args[i])).append(":[");
            boolean first = true;
            for (RocketComponent c : doc.getRocket()) {
                if (c instanceof Rocket) continue;
                if (!first) out.append(',');
                first = false;
                // Depth below the rocket, a stage at 0, as the app's tree counts it.
                int depth = -1;
                for (RocketComponent p = c.getParent(); p != null; p = p.getParent()) depth++;
                out.append("{\"class\":").append(quote(c.getClass().getSimpleName()))
                        .append(",\"depth\":").append(depth)
                        .append(",\"name\":").append(quote(c.getName()))
                        .append(",\"fields\":").append(api.ComponentFields.of(c)).append('}');
            }
            out.append(']');
        }
        out.append('}');
        try (PrintWriter w = new PrintWriter(args[0], StandardCharsets.UTF_8)) {
            w.print(out);
        }
    }

    private static String quote(String s) {
        StringBuilder sb = new StringBuilder("\"");
        for (char ch : s.toCharArray()) {
            if (ch == '"' || ch == '\\') sb.append('\\').append(ch);
            else if (ch < 0x20) sb.append(String.format("\\u%04x", (int) ch));
            else sb.append(ch);
        }
        return sb.append('"').toString();
    }
}
