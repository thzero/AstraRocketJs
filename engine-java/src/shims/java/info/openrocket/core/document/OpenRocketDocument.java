package info.openrocket.core.document;

import info.openrocket.core.preferences.DocumentPreferences;

/**
 * SHIM: minimal document container. Rocket.java stores/returns a reference
 * and components would store user materials into the document preferences. THEY NEVER DO in this build: `Rocket.setDocument` is called nowhere in `src/java`, `src/api` or `test`, so `rocket.getDocument()` is permanently null and every call site short-circuits. Doubly inert, because the shim `Databases` returns `documentMaterial = false`. This class exists only to satisfy the field type on `Rocket`. The
 * real document model arrives with .ork I/O work (P1.8) and replaces this.
 */
public class OpenRocketDocument {

    private final DocumentPreferences docPrefs = new DocumentPreferences();

    public DocumentPreferences getDocumentPreferences() {
        return docPrefs;
    }
}
