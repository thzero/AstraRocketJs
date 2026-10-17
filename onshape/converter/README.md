# AstraRocketOnshapeImport

The Onshape custom feature that builds a rocket as parts in a Part Studio from the JSON that AstraRocket writes with **Menu → Export → JSON**.

Onshape document: [AstraRocketOnshapeImport](https://cad.onshape.com/documents/9efcacdb9e9b2b88f145cb47/w/eff0daafcc1d142d7b608e3c/e/f237069b49a7f9b487688abf)

## Files

| File | What it is |
| --- | --- |
| `AstraRocketOnshapeImport.fs` | The feature itself: the dialog, the JSON check and the part building. |
| `component_sketches.fs` | The sketch for each component type. |
| `utils.fs` | Shared helpers. |

The three files are release builds of the FeatureScript in the [OpenRocket-Onshape](https://github.com/thzero/openrocket-onshape) project (MIT license; the notice is at the top of each file). The feature reads payload schema `1.2` (`EXPECTED_SCHEMA_VERSION` in `AstraRocketOnshapeImport.fs`), the schema AstraRocket's JSON export writes.

## Publishing to Onshape

1. **Create the PDF and upload it to the root of the document.** Build it from the repository root with `node design/onshape-sheet/build.mjs`, which writes `design/AstraRocket-Onshape.pdf`.
2. **Create a `Feature` folder and upload, with the **+** button's **Import**. the three feature files** into it: `utils.fs`, `component_sketches.fs` and `AstraRocketOnshapeImport.fs`.
3. **Set up the imports between them:**
   - In `component_sketches`, import `utils`.
   - In `AstraRocketOnshapeImport`, import `component_sketches` and `utils`.
4. **Upload the images and import them into `AstraRocketOnshapeImport`.** Upload `design/icon.png` and `design/favicon.svg` into the `Feature` folder with the **+** button's **Import**, then import both into `AstraRocketOnshapeImport`.

The `import(path : ..., version : ...)` lines in the files name elements by their Onshape ids, which are different in every document. When Onshape adds an import in steps 3 and 4, replace the matching line in the file with the one Onshape writes:

| File | Line to replace |
| --- | --- |
| `component_sketches.fs` | the `import` of `utils` (third line) |
| `AstraRocketOnshapeImport.fs` | `// @import componentSketches` and `// @import utils` |
| `AstraRocketOnshapeImport.fs` | `icon::import` and `image::import` |
