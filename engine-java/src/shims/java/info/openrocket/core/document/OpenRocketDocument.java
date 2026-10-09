package info.openrocket.core.document;

import info.openrocket.core.preferences.DocumentPreferences;

/**
 * SHIM: minimal document container. Rocket.java stores/returns a reference
 * and components would store document materials into the document preferences.
 * They never do in this build: `Rocket.setDocument` is called nowhere in
 * `src/java`, `src/api` or `test`, so `rocket.getDocument()` is always null and
 * every call site short-circuits. The shim `Databases` also creates every material
 * with `documentMaterial = false`. This class exists only to satisfy the field
 * type on `Rocket`.
 */
public class OpenRocketDocument {

    private final DocumentPreferences docPrefs = new DocumentPreferences();

    public DocumentPreferences getDocumentPreferences() {
        return docPrefs;
    }
}
