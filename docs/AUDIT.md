# Engineering Audit - AstraRocketJs

**Date:** 2026-09-19 (fin-geometry cluster closed the same day, see **Fixed in this round**)
**Scope:** `web/` (browser re-creation of OpenRocket; React 18 + TypeScript + Vite + Vitest + three.js). The TeaVM-compiled kernel under `web/src/engine/vendor/` is generated and out of scope; the audit boundary is the `@JSExport` facade wrapped by `web/src/engine/openRocketEngine.ts`.
**Method:** fan-out review, five parallel agents (parsers/export/persistence, state layer, components, tree/geometry, dead-code/tooling), each reading its files in full. Every HIGH below was re-read against the source by the orchestrator before it went in.

**Baseline at audit time:** `tsc --noEmit` clean, `eslint . --max-warnings 0` clean, 1175 tests passing across 106 files, `knip` exit 0 with no output, `prettier --check .` clean, `cspell` 0 issues. **Nothing in this report is visible to the existing gates.** That is the point of it.

---

## Read this first

> **Status: the fin-geometry cluster below is FIXED.** All four call sites now
> share one kernel-exact module (`web/src/tree/finPlanform.ts`), verified by a
> differential harness against the committed Java
> (`web/src/tree/finPlanform.kernel.test.ts`). The findings are kept here with
> their evidence because the _reason_ they survived is the useful part. See
> **Fixed in this round** at the end.

**The headline is that the app disagrees with itself about the shape of a fin.**

An elliptical fin is generated four different ways in four different modules, and three of them are wrong. `solidMesh` (the STL/OBJ/GLB you 3D-print), `reportGeometry` (the 1:1 PDF template you cut from) and `Rocket3D` (what you see on screen) all draw a **sine arch**, `y = height*sin(pi*t)` over `x = root*t`. The kernel that actually flies the rocket uses a **half-ellipse**. `dxfExport` is the only copy that matches it. On a 50 x 30 mm fin the two curves differ by **94% at the x = 5 mm station** (18.0 mm vs 9.3 mm) and by 19% in total planform area. The user prints one shape, cuts another from the PDF, lasers a third from the DXF, and the simulator flies a fourth.

This survived because of the test that was written to prove it. `reportGeometry.test.ts:21` is named _"draws an elliptical fin as a true sampled half-ellipse, not a trapezoid"_ and asserts exactly two things: that the curve has more than 10 points, and that its apex reaches full height. A sine arch satisfies both. **The test pins the curve's endpoints and extremum and nothing in between, so it cannot tell the correct shape from the wrong one.** Two more findings in this report have the same shape: a test that locks in the behavior it was written to verify.

**The second theme is drift between copies of the same helper.** Beyond the fin curve: the freeform root chord (`dxfExport` still uses the `Math.max` that `tree/position.ts:12-25` documents at length as the wrong measure and that four other modules were converted away from), the trapezoid `tipChord` default (30 mm in two modules, `root * 0.6` in two others), the fin tab clamp (clamped in one exporter, unclamped in two), the impulse class letter (two implementations that disagree below 1.25 N-s), three `niceStep` ladders and two different `hexToRgb`. In every case the divergence is invisible to the type checker because the copies have compatible signatures.

**The third is that the storage tier can lose a save and report success.** `idbKeyValueStore.set()` falls back to localStorage on an IndexedDB quota failure and returns `true`, but `get()` reads IndexedDB first and only consults the fallback when the IDB _read_ throws. A quota-refused write therefore lands in localStorage, every layer above reports success, and the next page load serves the stale IndexedDB copy.

**What is genuinely good:** the previous audit's tooling gaps are all closed and then some. `gates.yml` now runs `format:check`, `cspell`, `test:coverage`, `build`, `knip` and a 3-way-sharded Playwright `e2e`, all gated behind a `parity` job (JVM vs TeaVM-JS vs WASM-GC) and a `reproducible` job (`extract:check` against the pinned OpenRocket tree). The `.ork` zip-bomb caps, nesting-depth caps, remote-fetch byte caps and XML escaping on export were all checked and are real. i18n is at full key parity (1054/1054). The state layer's physics is already extracted into pure tested services. The five `exhaustive-deps` disables were each assessed individually and all five are safe.

Legend: security (red), architecture and tooling (orange), correctness / tests / a11y (yellow), dead code (green). Severity per finding: **HIGH / MED / LOW**. A check mark means re-read against source by the orchestrator.

---

## Security

**HIGH - Fresh thrust-curve samples bypass the validator the cache path uses** (verified)
`web/src/services/thrustcurve.ts:266-272`. `fetchSamplesCached` validates the _cached_ read with `isSampleArray` (line 257, an alias of `motorStore.isThrustSampleArray`, which rejects NaN/Infinity/non-numbers) but writes and returns `file.samples` from the network with no validation at all. A garbled or hostile `download.json` carrying `samples: [{time: null, thrust: 5}]` flows into `samplesToMotorSpec`, `cumImpulse` goes NaN, and the array reaches the TeaVM kernel, which lines 107-133 already document as producing an opaque "cannot be converted to a BigInt" blank-design failure. **Fix:** run `isSampleArray(file.samples)` before `writeEntry`, and apply the same to the `TcMotor[]` from `resolveTcMotor`.

**MED - Runtime motor catalog validated only with `Array.isArray`**
`web/src/services/motorDb.ts:92`. The catalog can be served from a separately deployed host (`VITE_DATA_BASE`, jsDelivr `data` branch). `allClasses` and `allManufacturers` call `a.localeCompare(b)` on the values and `filterMotors` calls `m.designation.toLowerCase()`, so one row missing `class` throws and takes down the whole motor picker rather than its own entry. This is the exact hazard `motorStore.ts:91-92` already guards for _custom_ motors. **Fix:** pass a row-level predicate to `fetchCatalog`'s existing `valid` hook so a bad host fails over to the in-build copy.

**MED - `windLevels` elements never validated**
`web/src/services/settings.ts:436-438`. The surrounding block is meticulous about exactly this ("every field here reaches `simConditions()` and then `simulate()` ... unchecked"), but `windLevels` gets `Array.isArray` and nothing more. A stored `[{altitudeM: "x", speed: null}]` walks straight into the kernel. **Fix:** filter to elements whose four `WindLevel` fields are all finite.

**LOW - `partColors` spread into styles with no key or value validation**
`web/src/services/settings.ts:377`. Contrast lines 445-449, which clamp `treePaneWidth` specifically _because_ the value reaches a style attribute. The same reasoning was not applied here. **Fix:** filter to values matching `/^#[0-9a-f]{3,8}$/i`.

**LOW - Uncapped motor-configuration count in `.ork` import**
`web/src/services/orkImport.ts:85-94, 118-136`. `captureDeployments` does `Array.from(el.children).find(...)` once per config per recovery device. A 500 KB file declaring 20 000 configurations against a few thousand components makes the import O(configs x children) on the main thread and freezes the tab. The zip-bomb and nesting-depth caps cover the other two vectors but not this one. **Fix:** cap declared configs and index the lookups into a Map once.

> **Checked and clean:** the `.ork` zip-bomb guard (`orkImport.ts:39-48`) is real and correct against fflate 0.8.3 (a lying declared size truncates to a clean XML parse error rather than exhausting memory); `MAX_NESTING_DEPTH` exists; XML escaping in `orkExport`/`rasaeroExport` is complete; DXF group-code injection is blocked by the `ascii` sanitizer at `dxfExport.ts:292-303`; CSV formula injection is handled wherever file-sourced text reaches a cell (`reportCsv.ts:30-33`, `flightPathExport.ts:1017`); remote fetches have staged TTFB/body abort budgets plus byte-counted caps enforced on bytes _received_; XXE is not exploitable (browser `DOMParser`); there is no prototype-pollution write surface.

---

## Architecture and tooling

**HIGH - Batch simulation failures overwrite each other and then get overwritten** (verified)
`web/src/state/store.ts:940-963`. Inside `runSims`, each row's `catch` does `set({ err: msg })`, so last writer wins and the message carries no row name; then after `Promise.all` settles, `if (skipped.length) set({ err: ... })` overwrites whatever the failures left. The same function already solves this correctly for _skips_ via the `skipped: Unflyable[]` array, and the comment at :843-846 describes this exact bug as the reason. Run a 6-row batch where rows 2 and 5 time out and row 3 has no motor: the user sees only "Simulation 3 has no motor" and has no idea two flights failed. **Fix:** collect failures into a `failed: {id, name, msg}[]` alongside `skipped` and emit one combined, row-named banner.

**HIGH - The 1.6 MB motor catalog is downloaded on app start, defeating its own lazy loading** (verified)
`web/src/components/sim/MotorDashboard.tsx:232-252` and `web/src/components/sim/MotorDialog.tsx:111-132`. Both catalog-loading effects are keyed on `[attempt]` with **no `open` guard**, and both components are mounted unconditionally (`AppHeader.tsx:448` mounts `<MotorDashboard open={motorsOpen} .../>`; `MotorRow.tsx:125` mounts `<MotorDialog open={open} .../>`). They only `return null` when closed, which does not stop the effect. Both files' own comments claim the opposite ("fetched only when something first needs it", "the first open pays a fetch"). `fetchCatalog` memoizes, so it is one download rather than many, but it is an unconditional 1.6 MB on first paint, which on a phone at a launch site is the entire reason the deferral exists. **Fix:** add `if (!open) return;` to both effects, keeping `attempt` in the deps.

**MED - `saveDesign` bumps the workspace generation it only needs to observe** (verified)
`web/src/state/store.ts:1135, 1153`. `claimWorkspace()` increments `workspaceGen`; `saveDesign`/`saveDesignAs` do not replace the workspace, they only need to notice if someone else did. Drop a large `.ork` on the app and hit File > Save while it is parsing: `openOrkFile`'s `stale()` now returns true, and because _both_ its success and its error paths are gated on `stale()`, nothing loads and nothing is reported. Secondary: two `saveDesign` calls in flight make the first return `false`, which `AppHeader.tsx:282-285` reads as "never named" and opens Save As, creating the duplicate library entry the comment at :1127-1141 says was fixed. **Fix:** split into `claimWorkspace()` (bump and check) and `observeWorkspace()` (capture and check).

**MED - `outdated` is staleness-as-a-flag where the codebase already has the right pattern** (verified)
`web/src/state/store.ts:596-601` plus `useWorkspaceEffects.ts:224-227`. `Simulation.outdated` is a persisted boolean written by an effect watching other state. `selectRunFailed` (store.ts:310-313) answers the identical "is this result still valid" question the right way, by recording the tree the run happened on and comparing in a selector. The flag is what makes the HIGH staleness bug below possible, and it forces `restore()` to hand-set it and `patchTargets` to remember it at six separate call sites (:691, :695, :707, :716, :722, :785). Any new sim-editing action that forgets one shows stale numbers as current. **Fix:** store the `flightKey` each result was flown against and derive `outdated` as a selector. Removes the effect, the flag, and all six manual writes.

**MED - Ignition timing forces a full engine rebuild it cannot affect** (verified)
`web/src/state/useWorkspaceEffects.ts:214`. The static-info effect lists `ignitionEvent` and `ignitionDelay` in its deps, but ignition timing cannot change mass, CG, CP, static margin or Cd. The delay field is a raw number input with a per-keystroke `onChange` (`MotorRow.tsx:187`), so typing "1.25" runs four complete `buildConfiguredRocket` + `staticInfo()` + `aeroSweep()` cycles for four identical results. `setExtraIgnition` does the same through the `extraMotors` object identity. **Fix:** drop the ignition deps from the static-info effect and key the extra-motor dep on a mass/geometry digest.

**MED - `optimizeDeps.exclude` points at a file that does not exist** (verified)
`web/vite.config.ts:113` excludes `./src/engine/vendor/orkengine.mjs`; the vendored kernel is `openrocket-engine.mjs` (the only two `orkengine` hits in the tree are this line and a stale comment at `openRocketEngine.ts:619`). The stated purpose, keeping esbuild from choking while pre-bundling the 2.9 MB TeaVM module, is not happening. **Fix:** correct the path or delete the entry, and fix the comment.

**MED - The build's own config files are typechecked by nothing** (verified)
`web/tsconfig.json:20` is `include: ["src"]`, `tsconfig.e2e.json:19` is `include: ["e2e"]`, and `npm run typecheck` is exactly those two projects, so `vite.config.ts`, `vitest.config.ts`, `playwright.config.ts` and `eslint.config.js` are in no tsc project. These files decide what ships (PWA workbox globs, `__APP_VERSION__`, worker format, base path, shard counts). ESLint lints them but with no type-aware rules. The `tsconfig.e2e.json` header already anticipates this. **Fix:** add a `tsconfig.node.json` and chain it into `typecheck`.

**MED - The spell gate skips every locale file** (verified)
`cspell.json:26` ignores `**/*.json`, which excludes `web/src/i18n/locales/{en,es}.json`: 1054 keys of user-facing copy, the single largest body of UI strings in the repo. `gates.yml` documents this gate as covering "comments, UI strings and docs", and `cspell.json`'s `flagWords` list exists precisely to make the common British spellings impossible. cspell reports 330 files checked and none of them are the locales. Grepping both files for the flagged forms finds 0 hits today, so this is an open hole rather than a live defect. **Fix:** narrow the ignore to the specific generated JSON files and add the locales to `files`.

**MED - `reportModel` writes the app's live engine handle, and drops the ignition override doing it** (verified)
`web/src/services/reportModel.ts:169, 172`. `buildWhole` calls `buildConfiguredRocket(tree, active.motor, active.extraMotors)` with no fourth `primaryIgnition` argument, then `restore` installs that handle via `s.applyBuild(...)`. The live rebuild effect always passes the ignition. After exporting a report, a multi-stage design's `store.rocket`/`store.info` describe a rocket whose primary ignition override was silently dropped, and the rebuild effect will not correct it because none of its deps changed. Separately, assembling a _report_ should not be writing the app's engine handle at all: the dynamic-import dance at `store.ts:1232-1237` exists only to break the cycle this causes. **Fix:** pass the ignition; longer term have `assembleReport` restore the handle it borrowed.

**MED - Three subsystems disagree about whether an auto-sized tube fin is valid** (verified)
`tree/tubefins.ts:15-22` implements the kernel's auto rule for an absent `outerRadius`; `services/requiredComponent.ts:32` lists `outerRadius` as required and `tubefinset` is **not** in `AUTO_COMPONENT_FIELDS` (:61-65), so `badDimensions()` flags it and the Run button refuses; `solidMesh.ts:414` substitutes 12 mm. Load an `.ork` written by desktop OpenRocket with auto tube fins: the schematic renders correctly, the Run button refuses to fly it, and the exporter emits a wrong-size part. **Fix:** add `tubefinset: ['outerRadius']` to `AUTO_COMPONENT_FIELDS` and make `solidForNode` use `tubeFinRadius`.

**MED - Unsynchronized read-modify-write on the design-library index**
`web/src/services/designLibrary.ts:107-119`. `write()` does `readIndex()` then `writeIndex()` with several awaited IDB round trips between. This is an installable PWA and IndexedDB is shared across tabs: A and B both read `[X]`, A writes `[A,X]`, B writes `[B,X]`, and A's entry is gone. Since `activeId()` filters against the index, A's design becomes unreachable and its bytes are orphaned. `remove()` racing a `write()` has the same shape. **Fix:** mutate the index inside a single readwrite transaction, or serialize library mutations behind a promise chain.

**LOW - `AppHeader` mounts six dialogs unconditionally**
`web/src/components/layout/AppHeader.tsx:29-54, 448-465`. Eleven `useState` flags, six always-mounted dialogs plus the hidden file input, the menu keyboard model and the global undo shortcut. The unconditional mounting is what makes the catalog HIGH above possible. **Fix:** gate each dialog behind its open flag and lift the set into an `AppDialogs` component driven by one `dialog: string | null`.

**LOW - `RAW_FIELDS` is 170 lines of domain schema inside a React component**
`web/src/components/design/PropertyPanel.tsx:136-303`. The OpenRocket component vocabulary, shape lists, event vocabularies, unit kinds and required-ness, already imported by three test files and cross-checked against `services/requiredComponent`. It means `services/` depends on a component module's shape for its own invariants, and it is most of why the file is 898 lines. **Fix:** move to `services/componentFields.ts`.

**LOW - `build` repeats the lint command instead of calling the lint script** (verified)
`web/package.json`. `scripts.lint` is `eslint . --max-warnings 0` and `build` repeats the identical string, so nothing in CI ever runs `scripts.lint` and the two can drift. **Fix:** `build` should call `npm run typecheck && npm run lint && vite build`.

**LOW - Duplicated helpers with the same name and different contracts** (verified)
Three separate issues, all invisible to the type checker in at least one direction:

- `niceStep` exists in `prefs/units.ts:264` (thresholds 1.5/3.5/7.5, ladder 1-2-5-10) and `components/canvas/schematicGeometry.ts:28` (divides by 8 first, ladder 1-2-**2.5**-5-10), plus a third unnamed ladder in `services/groundTrack.ts:127`. Normalized 2.2 gives 2, 2.5 and 5 respectively, so the ruler, the spinner step and the range rings can never agree. `schematicGeometry.niceStep` is also tested twice with the same cases (`schematicGeometry.test.ts:15`, `TreeSchematic.test.ts:16`).
- `hexToRgb` in `services/flightPathExport.ts:216` returns a packed int (fallback 0); in `services/reportPdf.ts:48` it returns an `[r,g,b]` tuple (fallback `[17,24,39]`).
- `const M_TO_MM = 1000` is declared three times (`dxfExport.ts:26`, `meshExport.ts:21`, `reportGeometry.ts:14`), the unit constant for every dimensional export.

---

## Correctness, tests and accessibility

### Geometry: the app disagrees with itself and with the kernel

**HIGH - Elliptical fins are a sine arch, not a half-ellipse, in three of four modules** (verified)
`web/src/services/solidMesh.ts:333`, `web/src/services/reportGeometry.ts:166` (and :41), `web/src/components/canvas/Rocket3D.tsx:178`. All three generate `x = root*t, y = height*sin(pi*t)`. The kernel (`EllipticalFinSet.java:17-22`) uses `POINT_X[i] = (cos a + 1)/2`, `POINT_Y[i] = sin a` with `a` sweeping pi to 0, i.e. `x = root*(1 - cos(pi*t))/2`, `y = height*sin(pi*t)`. `services/dxfExport.ts:100` is the only copy that matches. Verified numerically for `root = 0.05 m`, `height = 0.03 m`: at the x = 5 mm station the kernel's fin is **18.0 mm** tall and the app's is **9.3 mm**, a 94% error, with 19% less planform area overall (955 mm2 vs 1178 mm2). The comment at `reportGeometry.ts:160` claims "A true half-ellipse (height*sin(pi*t))", which is false. The user 3D-prints one shape, cuts a second from the 1:1 PDF, lasers a third from the DXF and flies a fourth. **Fix:** hoist one `ellipticalFinPoints(root, height, n)` into `tree/position.ts` next to `freeformRootChord` and convert all four consumers.

**HIGH - The DXF writer still uses the freeform root chord that four other modules were converted away from** (verified)
`web/src/services/dxfExport.ts:118` uses `Math.max(...top.map(p => p.x))`. `tree/position.ts:12-25` documents this at length as the wrong measure and exists specifically to replace it ("Exported because four other modules need the same number ... They each had their own `Math.max` copy"); `reportGeometry.ts:24` and `solidMesh.ts:311` use `freeformRootChord`. The DXF writer did not get converted. `root` feeds `withTab(...)` then `finTabFront(node, root)`: for points `[[0,0],[0.02,0.04],[0.09,0.03],[0.05,0]]` with `tabOffsetMethod:'middle'` and `tabLength:0.02`, the STL and PDF put the tab front at 15 mm and the DXF at 35 mm. **The laser-cut fin's tab is 20 mm out of place relative to the printed one and the airframe slot.** The root-chord reference line at :122 is wrong by the same amount. **Fix:** use `freeformRootChord(freeformPoints(node))`.

**HIGH - Auto-sized tube fins export at a hardcoded 12 mm** (verified)
`web/src/services/solidMesh.ts:414`: `const R = num(node, 'outerRadius', 0.012)`. Tube fins legitimately carry no `outerRadius` (`orkImport.ts:352-353` only sets the key when `<radius>` is present) and the kernel auto-sizes them, a rule this repo already implements in `tree/tubefins.ts` and which the schematic and the PDF side view both call. Import an `.ork` with 6 auto-sized tube fins on a 25 mm-radius body: the app draws 25 mm tubes and the STL/OBJ/GLB writes **12 mm**, less than half the diameter, with no warning. `solidForNode(node)` structurally cannot fix this because it never sees the parent radius. **Fix:** give it an optional `parentRadius` (as `componentExport.ts` already resolves for disc types) and return `null` when the radius cannot be resolved rather than inventing 12 mm.

**MED - Trapezoid `tipChord` default differs between exporters** (verified)
`num(node,'tipChord', 0.03)` in `solidMesh.ts:336` and `reportGeometry.ts:43,149`; `num(node,'tipChord', root * 0.6)` in `dxfExport.ts:105` and `schematicShapes.tsx:360`. A trapezoid node with no `tipChord` and `rootChord = 0.10 m` is a 30 mm tip in the STL and PDF and a 60 mm tip in the DXF and on screen: two exports of the same component from the same menu are different parts. **Fix:** one shared `trapezoidPlanform(node)`.

**MED - The fin tab is clamped to the body radius in one exporter and not the other two** (verified)
`dxfExport.ts:55` clamps `tabH = Math.min(tabHeight, pRadius)`; `solidMesh.ts:349` and `reportGeometry.ts:52` do not. A `tabHeight = 0.020` fin on a 12 mm-radius body: the DXF cuts a 12 mm tab, the STL extrudes a 20 mm tab straight through the airframe axis, and the PDF prints the 20 mm one. Whichever the user cuts first is the one that does not fit. **Fix:** shared `finTabSpan(node, root, parentRadius)`.

**MED - The 3D view positions a freeform fin from normalized points but draws it from raw ones**
`web/src/components/canvas/Rocket3D.tsx:163`. `addFins` reads `root`/`height` from `freeformPoints(child)` (kernel-normalized, translated by `-p0`) but builds the extruded `THREE.Shape` from raw `child['points']`. This is exactly the mismatch `tree/position.ts:47-53` documents as fixed everywhere else. A fin whose first vertex sits at `(0.02, 0)` is drawn 20 mm aft of where it is positioned, so the 3D view disagrees with the schematic, the PDF, the DXF and the STL. **Fix:** use the already-computed `ffPoints` for the shape too.

**MED - The PDF whole-rocket side view silently omits pods and parallel stages**
`web/src/services/reportGeometry.ts:199-223`. `rocketSideView` walks only `chain` and within each only `isFinSet` children. The on-screen schematic does draw them (`schematicGeometry.ts:261-273`). A two-booster rocket's report shows a single-body rocket with no boosters and no warning, and that figure is exactly what a reader uses to confirm the design is the one they think it is. **Fix:** recurse into `isAssembly(n.type)` children using `resolveAssemblyRadius` the way `computeSchematicLayout` already does.

**MED - Tube-fin axial station sampled from a phantom 50 mm root chord**
`web/src/services/reportGeometry.ts:126, 129-130`. For a `tubefinset`, `root` falls back to `num(node,'rootChord', 0.05)`, but tube fins have no `rootChord`, so it is always 50 mm; that phantom length then picks the station at which the body radius `R` is sampled. The real span is recomputed at :140 but only for the drawn rectangle. A `middle`-positioned set of true length 0.08 m on a 12 to 8 mm boat tail samples the transition radius 15 mm forward of its real front, so the PDF draws the tubes floating off or buried in the taper. **Fix:** compute the span before the `axialStart` call and use it for both.

**MED - Non-chain stage children resolve against a zero parent length**
`web/src/tree/position.ts:166`: `const len = chainTypes.has(n.type) ? num(n,'length',0) : 0;`. Any stage child that is not a nosecone/bodytube/transition gets `pLen = 0` into `fixChildren` and then `startFromPosition`, where `middle` returns `(0 - childLen)/2 + offset`. A stage-level `parallelstage` or `podset` containing a `middle`-positioned 0.3 m body tube resolves that tube to **-0.15 m**, forward of the assembly's own nose. The absolute-position rebase at :140 is wrong for the same nodes. **Fix:** fall back to `axialLength(n)`, and skip or re-base the absolute rebase inside off-axis assemblies.

**MED - Scaled launch lugs gain mass they do not gain volume for**
`web/src/tree/scaleRocket.ts:90, 151`. `LENGTH_KEYS.launchlug` excludes `outerRadius` and `thickness` (both written by `orkImport.ts:427-428`) but `launchlug` is not in `FIXED_SIZE`, so it still gets `MASS_EXPONENT ?? 3`. Scale 2x and a lug with `overrideMass = 1 g` becomes **8 g** while only doubling in length. Total mass and CG of the scaled design are then wrong, which are the only numbers the scale workflow exists to produce. **Fix:** either add it to `FIXED_SIZE` or set `MASS_EXPONENT.launchlug = 1`.

**MED - Non-convex cap fan produces a self-intersecting "watertight" solid**
`web/src/services/solidMesh.ts:150-159`. The boundary-loop cap uses the arithmetic mean of the loop's vertices as the fan apex, not the polygon centroid, then fans unconditionally. For a non-convex loop the mean can fall outside the loop and the fan emits overlapping, mixed-orientation triangles, while `countBoundaryEdges` still returns 0 so the function reports success. Reachable when `dropDegenerate` removes a sliver and opens a notch in a fin extrusion whose tab makes the boundary non-convex. **Fix:** ear-clip (or `THREE.ShapeUtils.triangulateShape`) and reject the cap if any triangle's normal disagrees with the loop's signed-area normal.

**MED - `thrustAt` returns 0 at the final sample time, losing the tail of every curve** (verified)
`web/src/services/motorCombine.ts:15`: `if (t >= samples[n-1][0]) return 0;`. `combineCurves` evaluates every curve at the union of all breakpoints, which includes each curve's own last time. A curve ending non-zero (RSE and thrustcurve.org data frequently do; `engParser` appends no trailing zero) loses its whole tail trapezoid: for `[[0,0],[0.1,10],[1.8,5]]` the true impulse is 13.25 N-s and `combineCurves` reports **9.0**, a 32% understatement that feeds `avgThrust` and the NAR class letter in the Motor Dashboard. **Fix:** return `samples[n-1][1]` at equality and 0 only past it.

**MED - Two `impulseClass` implementations disagree below 1.25 N-s** (verified)
`web/src/services/engParser.ts:16` and `web/src/services/motorCombine.ts:69`. Both were run against the standard ladder: identical for A through O, but for 0.3 / 0.6 / 1.25 N-s the parser returns `'A'` and the combiner returns its dash placeholder. Their invalid-input guards also differ (`ns <= 0` gives `'?'` vs `!isFinite || ns <= 1.25` gives the dash). A quarter-A or micro-impulse motor imported from a `.eng` file shows two different classes depending on which path rendered it. **Fix:** have `engParser` import the exported, more defensive `motorCombine` version and drop its private copy plus `CLASS_LETTERS`.

**LOW - `lerpAt` indexes its upper-extrapolation return off the wrong array** (verified)
`web/src/services/interpolate.ts:19` returns `ys[ys.length - 1]` rather than `ys[xs.length - 1]`, so a `ys` longer than `xs` returns a value from outside the `xs` domain: `lerpAt([0,1],[0,10,999],5)` returns **999** instead of 10. Separately, the `span === 0` guard at :16 is unreachable for the sorted-ascending `xs` the function requires (reaching `i` means `x > xs[i-1]`, so `xs[i] === xs[i-1]` cannot hold), and reads as a real divide-by-zero guard when the real one is at :9.

**LOW - Absolute mesh tolerances on a design the user can scale arbitrarily**
`web/src/services/solidMesh.ts:24, 233`. `WELD_TOL = 1e-6` m and the `area > 1e-12` cut are absolute, but `scaleRocket` accepts any positive factor. Scale a 70 mm nose cone by 0.003x and every one of the 96x96 lathe triangles has area about 2.6e-13, so `dropDegenerate` removes all of them, `countBoundaryEdges` of an empty index returns 0, `makeWatertight` reports success, and the user downloads a valid-but-empty STL. **Fix:** derive both tolerances from the bounding-box diagonal, or reject an empty post-`dropDegenerate` index.

**LOW - A wall thicker than the radius exports as a solid rod**
`web/src/services/solidMesh.ts:420`: `discSolid(R, Math.max(0, R - wall), len)` collapses to the no-bore branch. This is the opposite policy to `discSolid:278`, which returns `null` for an inverted ring precisely so a blocked bore is not shipped silently. A tube imported with `thickness 0.02` and `radius 0.012` (a units slip in a hand-edited `.ork`) exports as a solid 24 mm rod; printed, nothing fits inside it. **Fix:** return `null` when `wall >= R`.

**LOW - `segmentsCross` misses the touching case**
`web/src/services/solidMesh.ts:188` uses strict inequalities on all four cross products, so a vertex lying exactly on a non-adjacent edge, or two coincident non-adjacent vertices, is not a crossing. A figure-8 outline (reachable by dragging one vertex onto another in `FreeformFinEditor`) passes `isSimplePolygon` and extrudes into a non-manifold pinch point that `mergeVertices` then welds into a vertex shared by four shell faces.

**LOW - Packed recovery lengths do not scale**
`web/src/tree/scaleRocket.ts:93-95`. `parachute`, `streamer` and `shockcord` scale their canopy/strip/cord dimensions but not `length`, which `orkImport` fills from `<packedlength>` and which `position.ts:83` uses for layout. After a 2x scale a 25 mm packed chute still occupies 25 mm in a doubled airframe, so anything positioned `middle` or `bottom` relative to it, and the caliper snap targets built from `axialLength`, land at the wrong stations.

**LOW - Range-ring radii accumulate float error into the label**
`web/src/services/groundTrack.ts:129`: `for (let r = step; r <= extent + 1e-9; r += step)` gives `0.1, 0.2, 0.30000000000000004, ...`, which `GroundTrack.tsx:42` renders directly as a label. **Fix:** `i*step`.

**LOW - Truthiness fallback undoes a deliberate zero**
`web/src/components/design/RecoverySizingReadout.tsx:51`: `num(node, 'cd') || 0.8`. `nodeProps.num` already returns 0 for absent/non-finite, so a parachute with an explicitly stored `cd: 0` silently becomes 0.8 and the readout reports a finite descent rate for a canopy with no drag, instead of the infinite rate that `descentRate`'s own guard was written to produce and render as a dash. `requiredComponent.ts:40` lists `cd` as required precisely because 0 is invalid.

### Parsers, export and persistence

**HIGH - A failed thrust-curve download silently flies a C6** (verified)
`web/src/services/loadOrk.ts:111-113`. When the catalog lookup misses, the `!cat` branch deliberately seats `unresolvedMotor(ref)` so "the sim never silently flies a motor the file didn't specify". When the _curve download_ throws, the `catch` only pushes a note and leaves `motorSpecs[mountId]` unset, and `mountMotors.ts:36-40` then seeds a default **C6** for that mount. One transient thrustcurve.org failure while opening an L-motor design yields a runnable simulation flying a 10 N-s C6, with the only warning buried in the import-notes list that `settings.showImportNotes` can hide. **Fix:** seat `unresolvedMotor(ref)` in the `catch` exactly as the `!cat` branch does.

**HIGH - A quota-refused save reports success and is then shadowed by the stale copy** (verified)
`web/src/services/idbKeyValueStore.ts:141-148` vs `:130-138`. On an IDB write failure `set()` writes to localStorage and returns `true`; `get()` reads IndexedDB **first** and only consults the fallback when the IDB _read_ throws. A `QuotaExceededError` aborts the write transaction but leaves reads working, so the save lands in localStorage, `designLibrary.write` and `workspaceStore.save` both report success, and the next page load serves the stale IndexedDB copy. The user's save is silently lost, with no "storage full" signal, which is the exact signal this boolean was built to carry (see the comment at :81-95). **Fix:** track fallback keys in a Set (or write an IDB tombstone) so `get()` prefers the fallback for any key `set()` fell back on; or fail the `set` rather than diverging the two tiers.

**HIGH - Cached flight results are parsed and trusted with no shape check** (verified)
`web/src/services/designLibrary.ts:145-154`. `readResults` does `JSON.parse(raw) as StoredResults` and checks only `typeof parsed === 'object'`; the values are re-attached to sims by `workspaceStore.withResults`. `read()` at :96-104 is covered by `workspaceStore.validate`, but `readResults` has no equivalent. Two concrete failures: `NaN`/`Infinity` anywhere in a result becomes `null` through `JSON.stringify`, and `flightPathExport.ts:542` does an unguarded `result.summary.maxVelocity.toFixed(1)` (unlike `maxAltitude` one line above, which goes through `fmtLength`), so a KML/GPX export after a reload throws; and a results blob from a different build shape is trusted wholesale into charts and CSV. **Fix:** add an `isStoredResult` guard mirroring `workspaceStore.validate` and make the summary formatters non-finite-safe.

**HIGH - Six launch-condition fields export the literal string `null`** (verified)
`web/src/services/orkExport.ts:810, 815, 831, 833, 855, 856`. `launchRodLengthM`, `launchRodAngleDeg`, `windAverage`, `windStdDev`, `launchAltitudeM` and `latitudeDeg` are all `number | null` (`orkTree.ts:33-54`) and are interpolated raw, so a design saved mid-edit writes `<launchrodlength>null</launchrodlength>`. Lines 824-826 handle this correctly for the adjacent legacy `<windaverage>`/`<windturbulence>` pair, with a comment explaining that a hole is written as zero rather than blocking the save; these six were missed. Re-importing drops the field silently and desktop OpenRocket 24.12 logs a parse warning on each. **Fix:** apply the same `?? 0` or omit the element.

**MED - A blank required CSV cell becomes a 0 m/s wind level**
`web/src/services/windProfileCsv.ts:81-85`: `Number(cells[idx]!.trim())`, and `Number('')` is 0, which passes `Number.isFinite`. Lines 87-93 show the author special-cased blank cells for `stddev` only. The module's stated contract is that every failure throws rather than returning a short list; this one does not. **Fix:** reject the empty string explicitly for the three required columns.

**MED - `.eng` header accepts negative propellant mass and non-monotonic time**
`web/src/services/engParser.ts:50-52`. The check is `Number.isFinite` only. `samplesToMotorSpec` catches non-finite, `prop > total` and non-positive diameter/length, but not a _negative_ `propWeightG`: `masses = totalMass - propMass*(impulse/totImpulse)` then makes the rocket **gain** mass as the motor burns. Descending sample times make `totalImpulse` negative, so `impulseClass` returns `'?'` and the mass interpolation runs backwards. **Fix:** require `diameter > 0`, `length > 0`, `0 <= propKg <= totalKg`, and a monotonic time column.

**MED - `remove()` deletes the blobs before it updates the index, and ignores the result**
`web/src/services/designLibrary.ts:172-177`. If the index write is refused (quota, or the degraded localStorage fallback), the index still lists a design whose blob is gone: `activeId()` returns it, `read()` returns null, and `workspaceStore.readActive` throws `unreadable-design`, so the app opens broken. Every other path in this file was hardened to gate on the index write; `remove` was not. **Fix:** rewrite the index first, then delete, and propagate the boolean.

**MED - `setActive` and `rename` discard the write result**
`web/src/services/designLibrary.ts:90-92, 137-140`. `KeyValueStore.set` reports failure by returning `false` rather than throwing, so both resolve cleanly on a quota failure. The user renames a design and sees the new name from in-memory state; the next session shows the old one. Worse for `setActive`: switching designs appears to work, this session edits the new one, and the next load reopens the previous one.

**MED - Material and template writes swallow the same failure the motor store was fixed for**
`web/src/services/materialStore.ts:56-58` and `templateStore.ts:167-169` throw away `kv.set`'s boolean as "best-effort (re-addable)". `motorStore.addCustomMotor:158-163` was fixed for exactly this and now throws `'storage-full'`, with a comment describing the symptom: "the dialog awaited the import, got a clean resolve, and re-rendered a catalog that simply did not contain the motor, with no error." The material and template dialogs still have that bug.

**MED - A journal written before the first save is never replayed and never cleared**
`web/src/services/workspaceStore.ts:132, 154, 243`. `saveSync` writes the unload journal with `id: this.activeId`, which is `null` before the first successful save. `load()` requires `journal.id && journal.id === this.activeId`, and the stale-journal cleanup is also false for `null !== null`. Work done before the first debounced autosave completes is lost on reload even though `saveSync` wrote it, and the dead blob (a whole lean workspace) squats in the roughly 5 MB localStorage budget forever.

**LOW - `playbackSpeed` accepts NaN, 0, Infinity and negatives**
`web/src/services/settings.ts:382` uses `typeof === 'number'` where every neighboring field uses `Number.isFinite` plus a clamp. A stored `NaN` makes the flight playback clock never advance, with no way back but clearing storage: the same failure the `treePaneWidth` clamp was added to prevent.

**LOW - `onblocked` leaks the IndexedDB connection and latches the fallback**
`web/src/services/idbKeyValueStore.ts:44` rejects the promise but never aborts the underlying `indexedDB.open`. When the blocking tab closes, `onsuccess` fires on an already-settled promise and the `IDBDatabase` is leaked with nobody to `close()` it, which then blocks the next upgrade in turn, while `markDegraded()` has latched the session into the localStorage fallback permanently, contradicting the "never memoize a failure" intent at :46-52. Latent until `DB_VERSION` is bumped past 1.

**LOW - Unbounded spread in the DXF bounds calculation**
`web/src/services/dxfExport.ts:118, 130`: `Math.max(...top.map(...))` on an array with no cap (`orkImport.ts:323-330` puts no limit on `<finpoints><point>` count). A freeform fin with more than roughly 100k points dies with an opaque `RangeError: Maximum call stack size exceeded`.

### Components and state

**HIGH - `NumberInput` rejects NaN but not Infinity** (verified)
`web/src/components/common/NumberInput.tsx:66-79`. `parseFloat(raw)` is guarded with `Number.isNaN` only, and the clamp cannot catch `+Infinity` (`Infinity < min` is false, and most callers pass no `max`). `<input type="number">` accepts `1e999` as a valid floating-point string, so typing it into any length or mass field calls `onChange(Infinity)`; `PropertyPanel.tsx:362-365` writes it into the node, where it is persisted, exported to `.ork`, and read back as `0` by `num()`. The field shows Infinity while the geometry behaves as if the dimension were absent. **Fix:** `if (raw === '' || !Number.isFinite(n)) { onChange(null); return; }`.

**HIGH - Count fields have a floor and no ceiling** (verified)
`web/src/components/design/PropertyPanel.tsx:645`: `onChange({[f.key]: Math.max(1, Math.round(v))})`, and `NumberField` passes no `max`. Grepping `finCount` confirms there is no upper cap anywhere in the codebase: every consumer is `Math.max(1, Math.round(...))`. Every renderer then loops that count allocating per iteration (`Rocket3D.tsx:194-202` clones an `ExtrudeGeometry` per fin; also `schematicShapes.tsx:141`, `AftView.tsx:134`). Typing `100000` into Fin count, a plausible fat-finger on a 3-fin design, hard-locks the tab and can OOM it. A hostile `.ork` can carry the same value. **Fix:** give `Field` a `max` (64 fins, 16 instances) and defensively cap the render loops.

**HIGH - Every restored simulation is flagged outdated on load** (verified)
`web/src/state/useWorkspaceEffects.ts:224-227`. The flight-key effect has no `ready`/first-run gate, unlike the rebuild effect at :198-199 which explicitly waits for hydration. On mount `flight` is the _default_ rocket's key; `hydrate()` then swaps in the saved design, the key changes, and `markOutdated()` flags every restored result stale. With `simulation.autoRunOutdated` on and a result view open, `CenterView.tsx:169-173` immediately re-fires a full flight sim for results that were already current. The existing fixture cannot catch this: `useWorkspaceEffects.test.tsx:55-62` builds the "saved" workspace as `{...s().tree, name: 'Restored'}` and `flightKey` strips `name`, so its hydrate never changes the key. **Fix:** hold the last flight key in a ref and seed it on the first post-hydration run, or adopt the derived-`outdated` fix above. Add a test whose saved tree differs structurally, not just by name.

**HIGH - Per-stage report rows seat the sustainer's motor in the booster** (verified)
`web/src/services/reportModel.ts:167`. Each stage is built in isolation as `buildConfiguredRocket({name, components: [st]}, active.motor, active.extraMotors)`. `buildConfiguredRocket` seats `active.motor` (the primary mount's motor) into whatever mount `findMountId` finds _inside that one stage_, and the `extraMotors` loop then skips the stage's own motor because `id === mountId` on the single-stage fake tree. On a two-stage rocket the booster's per-stage mass and CG rows in the PDF report and in the `.ork` `<designinfo>` block are computed with the sustainer's motor loaded into the booster's mount, then exported and shared as authoritative. **Fix:** resolve the mount id against the full tree and pick `active.motor` for the primary and `active.extraMotors[id]` otherwise.

**MED - The Mach readout and the tables can disagree on the same screen** (verified)
`web/src/components/canvas/AeroAnalysis.tsx:79, 250` vs `:116`. `machPick` is never re-clamped when `machMax` shrinks: the strip header prints `machPick` raw while `useSampleAt` snaps the tables to the nearest existing sample. Set Max Mach to 5, scrub to 3.0, switch back to M1: the header reads "at Mach 3.00" and the three tables read "at Mach 1.00", so the component figures are attributed to a Mach that was never computed. **Fix:** `useEffect(() => setMachPick(m => Math.min(m, machMax)), [machMax])`.

**MED - A 48-sample aero sweep runs synchronously per keystroke** (verified)
`web/src/components/canvas/AeroAnalysis.tsx:87-98`. `rocket.aeroSweep()` (48 to 50 Mach samples, full per-component force analysis) runs inside a `useMemo` in the render body with `aoaDeg`/`thetaDeg`/`rollRate` in its deps, and those three are wired to `Num` inputs whose `onChange` fires per keystroke (:842-845). Typing "12" into Wind direction runs two complete kernel sweeps back-to-back on the main thread, with no busy state and no debounce. **Fix:** commit on blur/Enter as `NumberInput.onCommit` does elsewhere, or move the sweep behind a transition.

**MED - The app-wide confirm modal has no focus trap and no focus restore** (verified)
`web/src/components/common/ConfirmDialog.tsx:17` calls `useFocusTrap<HTMLDivElement>(true)` with a constant, but the panel is not rendered until `request` exists (:32). `useFocusTrap`'s effect deps are `[active]` (`useFocusTrap.ts:71`), so it runs once on mount with `ref.current === null`, returns early, and never re-runs when the panel appears. This is the modal mounted permanently at the app root and used for Delete component, Close design and Delete simulation: it declares `role="alertdialog" aria-modal="true"` and Tab walks straight into the page behind it. Of the four call sites passing a constant `true`, the other three (`FlightPathExport` twice, `FlightCsvDialog`) are mounted conditionally by their parents, so this is the only one affected. **Fix:** pass `!!request`, or make the hook depend on the node via a callback ref.

**MED - Global undo destroys typing in every text field**
`web/src/components/layout/AppHeader.tsx:147-161`. The Ctrl/Cmd+Z handler calls `preventDefault()` and `undo()` unconditionally, including while a text field is focused. Mid-edit in the Save As name box, the component Name field or the motor search, Ctrl+Z discards the last rocket-geometry edit instead of the characters just typed, and the browser's native field undo never fires. `MotorDashboard.tsx:299-301` already does the right check for its arrow-key handler. **Fix:** skip when `document.activeElement` is an INPUT/TEXTAREA/contenteditable.

**MED - Unbounded solver inputs**
`web/src/components/layout/SettingsDialog.tsx:294-300`: `maxTime` has `min={1}` and no max, `timeStep` has `min={0.001}` and no max. `maxTime` divided by `timeStep` is the solver's iteration bound, so `1000000` (a plausible slip for 1000) at the default 0.01 s step asks for 100 M integration steps with no cancel path. Related, `web/src/components/sim/LaunchPanel.tsx:318, 378, 389`: launch altitude, temperature and pressure are the only `QNum`s with neither `minSi` nor `maxSi` while their siblings are bounded, so -300 C and 0 hPa reach the kernel's atmosphere model.

**MED - Playback re-uploads the whole trajectory buffer sixty times a second**
`web/src/components/canvas/FlightPath3D.tsx:88-107, 192`. The rAF loop calls `setProgress(np)` every frame and `<Line points={scenePts.slice(0, idx+1)} .../>` hands drei a new array each time, so drei rebuilds its `LineGeometry` per frame and the `<Html>` callouts re-mount. The animation stutters exactly on the long flights it exists to show. **Fix:** keep the full geometry and animate a draw range, or throttle `setProgress` to the sample index.

**MED - `Streamer`'s geometry is never disposed**
`web/src/components/canvas/FlightPath3D.tsx:484-493` builds a `PlaneGeometry` in a `useMemo` and passes it via the `geometry` prop with no disposal effect. R3F does not dispose objects it did not construct, so every streamer-equipped design leaks one GPU buffer per unmount and per `w`/`L` change. `Flame` (:420), `CalloutLabel` and `buildPieces` all dispose correctly, so this is an omission rather than a policy.

**MED - The aft view rebuilds its whole scene on every pointer sample**
`web/src/components/canvas/AftView.tsx:103-105, 387-400`. The hulls, the recursive `walkChain`/`walkChildren` tree walk and every cluster and fin instance are built in the render body with no `useMemo`, while `onPointerMove` drives a store write. `TreeSchematic` hit this exact problem and fixed it by extracting `buildSchematicShapes` into a memo, with a docblock explaining why; `AftView` never got the same treatment.

**MED - 8K export restores a possibly-disposed renderer**
`web/src/components/canvas/Rocket3D.tsx:874-884`. `snapshot()` awaits `snapshotWithHeader` (seconds at 8K) then unconditionally calls `st.gl.setPixelRatio/setSize/render` in `finally` with no liveness check. Switching away from the 3D view mid-export throws out of the `finally` on a disposed WebGLRenderer as an unhandled rejection, losing the failure signal entirely. `TreeSchematic` routes its export failures to `onError`; `Rocket3D` has no such channel.

**MED - Document-global SVG ids in `FlightChart`**
`web/src/components/canvas/FlightChart.tsx:546, 665, 672` use `fc-clip-${meta.key}` and `fc-${meta.key}`. `TreeSchematic.tsx:292` namespaces with `useId()` for exactly this hazard. Two charts in one document (a comparison view, or the mobile and desktop copies during a breakpoint transition) make `url(#fc-clip-altitude)` resolve to the first match, clipping one chart's panels to the other's width.

**MED - `refreshDesigns` is the only async store action with no generation guard** (verified)
`web/src/state/store.ts:1086-1089`. Every other async action re-checks before writing; this one awaits `lib.list()` and `lib.activeId()` and `set`s unconditionally. It is called from four places that can overlap (`openDesign`'s tail, `deleteDesign`'s tail, `saveDesignAs`, and `DesignLibraryDialog.tsx:51`), so a slower earlier call landing last puts a just-deleted design back in the list.

**MED - Export-path strings are the least localized surface in a fully-i18n'd app**
`TreeSchematic.tsx:802, 813, 821, 833`; `ImageExportMenu.tsx:119, 122`; `Rocket3D.tsx:957`; `ExportDialog.tsx:114, 199, 212`. Hardcoded English in a repo where `i18n/locales.test.ts` gates catalog parity. These include the error strings a user must read to recover ("Image export failed: ... try a smaller width, or use the SVG", "Could not export PDF: ...").

**LOW - Undo does not restore the selection and run-list fields it prunes** (verified)
`web/src/state/store.ts:500-511` restores `tree`, `selectedId`, `sims` and `activeId`, but `deleteSim` (:755-771) also prunes `selectedSimIds`, `lastRunIds` and `resultSimId`, none of which are in `HistoryEntry` (:66-71). Tick three rows, delete one, undo: the row comes back without its tick, so the Run button's count is wrong, and it is gone from `lastRunIds`, so the Results picker collapses to a single name even though the run really did fly it. Related: `openOrkFile`, `resetWorkspace` and `hydrate` all leave those three fields pointing at the previous workspace's sim ids, and it is only harmless because four unrelated components each defend themselves.

**LOW - Four store actions are typed `() => void` and implemented `async`** (verified)
`web/src/state/store.ts:263-267` vs `:1206, 1215, 1252, 1280` (`newWorkspace`, `saveOrk`, `saveRasaero`, `exportComponent`). The declared type is a lie, so no caller and no test can await them, which is part of why none of the four is tested.

**LOW - Unmemoized ruler marks**
`web/src/components/canvas/TreeSchematic.tsx:361-388` rebuilds `rulerMarks`, `rulerMinorMarks`, `vTicks` and `vMinorTicks` in the render body (minor ticks every `rulerStep/5` across the viewport, typically 150 to 300 entries) on every hover and selection change. The file memoized the far more expensive `buildSchematicShapes` for precisely this reason; the rulers are the remaining unmemoized derivation and they are on by default.

**LOW - Color inputs write persistent settings on every drag tick**
`web/src/components/canvas/FlightPath3D.tsx:252-266` calls `update({phaseColors: ...})` on every `onChange` of an `<input type="color">`, which fires continuously while the OS picker is dragged, writing the whole settings object through the provider to storage dozens of times per gesture. `PropertyPanel.tsx:590-591` avoids this by deferring to `onBlur`.

**LOW - Unguarded post-await `setState` in `MaterialPicker`**
`web/src/components/design/MaterialPicker.tsx:85-101`. `submitCustom`/`deleteCurrentCustom` do `setMats(await materialsForType(type))` with no mounted guard, while the effect ten lines above carefully uses a `live` flag.

**LOW - Geolocation denial is completely silent**
`web/src/components/sim/LaunchPanel.tsx:353-367`. The error callback is an empty block and there is no pending state during the 10 s timeout, so pressing the locate button with permission denied produces no visible change at all and the user presses it repeatedly.

### Accessibility

**MED - The view toggle marks its active segment with color alone**
`web/src/components/canvas/ViewToggle.tsx:161-169`. The 2D/3D/Aero and Flight/Path/Ground segmented controls use `bg-sky-600` with no `aria-pressed`, `role="tablist"`/`aria-selected` or `aria-current`. Every sibling toggle in the app got this right (`AeroAnalysis.tsx:909`, `CenterView.tsx:486`, `TabBar.tsx:72`, `SettingsDialog.tsx:97-98`), so this is the one that was missed.

**MED - The first-run dialog is the only one with no focus trap**
`web/src/components/layout/WorkInProgressDialog.tsx:20-25`. All 17 other dialogs use `useFocusTrap`; this one does not, and by design it has no Escape and no backdrop dismissal. It is `aria-modal="true"` and blocks the whole app on first load, so the very first keyboard interaction with the app escapes a modal that claims to be modal. It mounts only when shown, so a constant `true` is safe here (unlike `ConfirmDialog`).

**MED - The caliper handles are pointer-only**
`web/src/components/canvas/TreeSchematic.tsx:675-683, 739-747`. Bare `<rect onPointerDown={...}>` with no `tabIndex`, `role` or key handler, and the measured value is rendered only inside the SVG. The app's only way to read a distance off the drawing is unusable without a pointer, in a file whose siblings were explicitly given keyboard paths for this reason (`AeroAnalysis.tsx:965-980`, `FlightChart.tsx:252-267`, `FreeformFinEditor.tsx:114-131`). **Fix:** `tabIndex={0}`, `role="slider"` with `aria-valuenow`, and arrow-key nudging through the existing `snapNear` path.

**LOW - The update toast's live region is created with its content**
`web/src/components/layout/UpdateToast.tsx:128-134`. The `role="status"` container is created at the same moment as its text (the component returns null immediately above). A live region must exist in the DOM before content is inserted to be announced, so most screen readers announce nothing when an update becomes available, which is the entire purpose of the toast.

**LOW - `role="menu"` with no menuitems**
`web/src/components/canvas/ImageExportMenu.tsx:64, 91`. Plain `<button>` children with no `role="menuitem"`, no arrow-key roving and no Escape handler (only outside-pointerdown closes it). Screen readers announce "menu, 0 items". `AppHeader.tsx:111-140` implements the full menu-button contract. **Fix:** either complete the pattern or drop `role="menu"` for a plain popover.

**LOW - `PaneSplitter` announces a maximum it cannot reach**
`web/src/components/layout/PaneSplitter.tsx:230-233, 292-294`. `aria-valuemax={max}` is the static prop, but the effective maximum is `min(max, window.innerWidth - reserve)` computed in `clamp()`. On a narrow window End lands somewhere other than the announced maximum.

### Tests

**MED - The elliptical-fin tests cannot distinguish the right curve from the wrong one** (verified)
`web/src/services/reportGeometry.test.ts:21-27` and `:178-182`. The test named "draws an elliptical fin as a true sampled half-ellipse, not a trapezoid" asserts `pts.length > 10` and that the apex reaches full height. The half-ellipse and the sine arch share both properties (both peak at `t = 0.5`). The second test asserts only `f.length > 10`. **This is why the HIGH above survived.** Any test for a parameterized curve that checks only endpoint and extremum properties pins nothing. **Fix:** assert an interior point against the closed form: for `root = 0.05`, `height = 0.03`, the point nearest `x = 5 mm` must have `y` near 18.0 mm. Add the same to `oneFinSolid` and `rocketSideView`.

**MED - The store's file-producing and library-mutating actions are untested** (verified)
`web/src/state/store.test.ts`. No test exercises `scaleDesign`, `saveDesignAs`'s storage-full branch (the only caller of `setStorageWarning('full')` outside the autosave effect), `deleteDesign`'s `wasActive` to `resetWorkspace` branch, `newWorkspace`'s confirm/decline branches, `saveOrk`'s `saveDesignInfo` branch, `saveRasaero`, or `exportComponent`. These are precisely the actions that touch the design library and produce downloaded files, where a regression is silent: the user gets a wrong file or a lost design with no exception. The rest of the store is very well covered, which makes the gap sharper.

**MED - The untrusted-input parser has no direct test**
`web/src/services/orkImport.ts` is 1010 lines and the app's only parser of untrusted files; it is exercised only indirectly through `orkFile.test.ts` (33 round-trip/shape cases). Nothing tests the zip-bomb caps (:16-18, 39-48), the `MAX_NESTING_DEPTH` guard (:563-566), or the malformed-XML/missing-`<rocket>` paths. `loadOrk.ts`, which holds the C6-substitution HIGH above, has no test at all. `keyValueStore.ts`, `saveOrk.ts`, `fetchProgress.ts` and `componentExport.ts` are also untested, and `fetchProgress.readStreamWithProgress` is the single enforcement point for every remote size cap.

**MED - The camera-framing math was extracted to be testable and never tested**
`web/src/components/canvas/Rocket3D.tsx:484, 516, 547, 576, 664`. `calloutGadget`, `piecesBounds`, `isFittableBox`, `fitCameraToBox` and `exportCamera` all carry doc comments saying they were extracted _because_ they are the provable part ("this is where the export framing is actually proven", "Pure so the numbers are provable"), but there is no `Rocket3D.test.*` and no e2e asserts the framing. The corner-by-corner fit (:642-654), the degenerate-`up` nudge (:607-613) and the NaN-box guard (:547) are subtle, regression-prone geometry with a stated test rationale and zero tests.

**LOW - `AeroAnalysis`'s color ramp port is untested**
`web/src/components/canvas/AeroAnalysis.tsx:338-373, 45-51`. `hsv()`/`heat()` are a formula-for-formula port of `java.awt.Color.getHSBColor` plus the desktop's absolute 1.5 Cd anchor, and `niceName()` and the nearest-sample search are module-private. Only `buildLinePath` is exported for test. The e2e `aero-heat.spec.ts` can see that shading exists but cannot verify the port matches OpenRocket's ramp, which is the whole claim the docblock makes. The file already demonstrates the export-for-test pattern one function below.

---

## Dead code

knip runs in CI and exits clean, so everything here is below its configured threshold rather than a miss.

**LOW - `shapeUsesParameter` is exported, unit-tested, and has zero production callers** (verified)
`web/src/tree/shapeProfile.ts:44`. Verified: only `shapeProfile.ts` and its test mention it. The reason is that `shapeParameter` has no editor field at all; every production reference (`solidMesh.ts:384/397`, `reportGeometry.ts:80/120/186`, `schematicGeometry.ts:144`, `Rocket3D.tsx:338/389`, `orkImport.ts:243/266`, `orkExport.ts:266`) only reads or writes it. So a power/haack/ogive/parabolic nose imported from a `.ork` carries a shape parameter that changes its whole profile, that the user can see and can never edit, and round-tripping freezes whatever the file said. **This is a missing feature wearing a dead-code costume:** either wire it into `PropertyPanel` gated on `shapeUsesParameter` and clamped with `shapeParamMax`, or delete the export.

**LOW - Six value exports with no external importer** (verified)
`components/common/useMediaQuery.ts:20` (only `useIsDesktop` is imported elsewhere), `services/csvExport.ts:69` (`DEFAULT_CSV_OPTIONS`), `services/settings.ts:43,44,288` (`clampTreePane`, `clampSidePane`, `DEFAULT_PATH_EXPORT`), `state/store.ts:297` (`selectEditIds`). Verified two ways: re-running knip with `ignoreExportsUsedInFile:false` lists exactly these six, and a grep of `src` and `e2e` finds each referenced only inside its own file. None is imported by any test, so none is the "exported for a test" pattern. **Fix:** drop the `export` keyword, then consider removing `ignoreExportsUsedInFile` so knip holds the line (the flag is not needed for test-only exports, since knip already treats test files as entries).

**LOW - 24 exported types with no external importer** (verified)
Same verification route. `settings.ts:121,281`; `orkTypes.ts:17,129`; `componentDb.ts:17,26,36,44,54`; `flightPathExport.ts:265,292,306`; `reportModel.ts:30,40`; `rasaeroExport.ts:108,112`; `reportPdf.ts:22`; `openRocketEngine.ts:520,585,596,689`; `useUnits.ts:15`; `state/store.ts:76`; `AeroAnalysis.tsx:335`. Type-only, so zero runtime cost. Keep the ones that are deliberately part of a module's published shape (`FlightSummary`/`FlightBranch`/`EngineWarning`/`DragCurve` on the engine boundary are plausible keeps) and say so in a comment.

**LOW - `e2e/` is outside knip's project set** (verified)
`web/knip.json:4`. The project globs are `src/**/*.{ts,tsx}` plus `scripts/**/*.mjs` plus `src/**/*.css`. The playwright plugin adds the spec files as _entry_ files, whose exports are ignored, and the shared helper `e2e/base.ts` is neither entry nor project, so nothing in it is ever checked. 25 spec files plus a fixtures directory accumulate dead helpers invisibly while `src` is held clean. Adding `"e2e/**/*.ts"` to `project` was tried and reported exactly one new item, `export type WipState` at `e2e/base.ts:6`. **Fix:** add the glob; it costs one de-export.

**LOW - `msToFtS` has no production caller**
`web/src/services/recoverySizing.ts:107`. `RecoverySizingReadout` formats every rate through `useUnits().at(...)`. The module doc says "the bands are quoted in ft/s" and the band constants are built from `FT_S`, so the helper reads as live API. Delete it, or use it to show the code-quoted ft/s alongside the SI rate the way `safetyLimits.limitText` deliberately does for mph.

**LOW - `scaleRocket` has a row for a component type that does not exist**
`web/src/tree/scaleRocket.ts:98`: `protuberance: ['width','height','length']`. There is no `protuberance` type: `DISPLAY_NAME` has no such key and `ComponentType` does not list it. The real type is `fairing`, at :97 with an empty key list. Harmless, but it makes the table look like it covers a type it does not.

---

## Confirmed closed since the last audit

Evidence gathered, not re-reported as findings.

- **All five previously-open tooling gaps are closed.** `gates.yml` runs `format:check`, `cspell`, `test:coverage`, `build`, `knip` and a 3-way-sharded `e2e` (fail-fast off, browser cached on resolved version, report uploaded on failure). Both `ci.yml` (PR) and `deploy.yml` (master push) call it.
- **The engine parity harness is gated.** `gates.yml`'s `parity` job runs `npm run parity` in `engine-java/` (JVM vs TeaVM-JS vs WASM-GC) plus a rebuild-and-`git diff --exit-code` check that the committed engine matches `src/java`; a separate `reproducible` job runs `extract:check` against the pinned OpenRocket tree. `build-and-test` and `e2e` both declare `needs: [parity, reproducible]`. This is the finding that dominated the last audit and it is fixed.
- **`prettier --check .` passes on every tracked file.** The `es.json` drift is gone, which is what allowed `format:check` into CI.
- **No inert `eslint-disable` comments.** There are five directives, all `react-hooks/exhaustive-deps`, which is enabled at `warn`. Unused-directive reporting was verified live by planting a throwaway `no-undef` disable and confirming ESLint flagged it. Each of the five was then assessed individually and all five are safe: `FlightChart.tsx:197` keys on a value-key derived from the same data the closure reads; `:282`'s closure bottoms out in exactly the listed deps; `:319`'s omitted dep is a `useCallback` over listed deps; `RocketConfigDialog.tsx:33` and `MotorDialog.tsx:187` deliberately seed on open.
- **Named-vs-default exports: no violations.** Exactly two `export default` in `src`, both documented exceptions (`App.tsx:30`, `i18n/index.ts:39`).
- **i18n is at full parity.** en 1054 keys, es 1054 keys, 0 missing, 0 orphan, gated by `i18n/locales.test.ts` for key parity, placeholder parity and empty strings. The 63 byte-identical values are cognates and abbreviations (`2D`, `CP`, `RASAero`), not untranslated copy.
- **Dependencies are clean.** knip reports none unused or undeclared. `@thzero/library_cli` has no source references but supplies the `library-cli` binary used by `build:inc`.
- **`.test.tsx` is not a knip blind spot.** `knip.json`'s own `entry` lists neither test extension, but the vitest plugin resolves both from `vitest.config.ts` (confirmed with `knip --debug`). Proof: `src/testing/renderWithProviders.tsx` is imported only by `.test.tsx` files and knip does not report it.
- **`kernelLogSink.ts` has no exports at all**, so there is nothing to flag about the side-effect import.
- **The state layer's physics is already in the right place.** The static-info build pipeline, `.ork` import wiring, export field-mapping and motor matching are extracted into pure, tested services (`buildRocket.ts`, `wireLoadedOrk.ts`, `exportMotors.ts`, `mountMotors.ts`). Only the per-stage report rebuild is still doing physics in the wrong place. `App.tsx` holds no business logic. No dead store fields or actions.
- **Geometry checked and clean:** every unit factor in `prefs/units.ts` (including the Fahrenheit offset/scale round-trip both ways and `siToUiDelta`); the `shapeRadius` port of conical/ellipsoid/power/parabolic/haack/ogive against the kernel, including every `acos`/`sqrt` domain; `cluster.ts`'s 14 patterns, `R5` circumscribed radius and rotation sign; `tubefins.ts`'s auto-radius and collision formulas; `recoverySizing.ts`'s ISA density; `windTurbulence.ts`; `safetyLimits.ts`; `makeWatertight`'s directed-edge walk; `nodeProps.num` is genuinely the only `num()` in the codebase, with no duplicate to drift.
- **Components checked and clean:** `saveFile.ts` revokes every object URL; no `dangerouslySetInnerHTML`; every `target="_blank"` carries `rel="noreferrer"` or `noopener noreferrer`; all `addEventListener`/`ResizeObserver`/rAF registrations have matching teardown; `buildPieces`/`markerTexture`/`labelTexture`/`Flame` all dispose; `useMediaQuery` uses `useSyncExternalStore` correctly; TreeSchematic, FlightChart, GroundTrack and schematicShapes are properly memoized.

---

## Recommended order of attack

Front-loaded with small verified fixes; large refactors last.

### 1. One-line safety fixes (under an hour total, each independently shippable)

1. `loadOrk.ts:111-113` - seat `unresolvedMotor(ref)` in the `catch`. Stops the app flying a C6 the file never asked for. **Add the test the `!cat` branch already has, for the download-failure path.**
2. `NumberInput.tsx:66-79` - `!Number.isFinite(n)` instead of `Number.isNaN(n)`. Closes Infinity into geometry from every numeric field at once.
3. `thrustcurve.ts:266-272` - run the existing `isSampleArray` on the fresh path. The validator is already written and already imported.
4. `orkExport.ts:810-856` - `?? 0` on the six null-interpolated launch fields, matching the two lines that already do it.
5. `vite.config.ts:113` - fix the path to `openrocket-engine.mjs`, and the stale comment at `openRocketEngine.ts:619`.
6. `MotorDashboard.tsx:232` and `MotorDialog.tsx:111` - add `if (!open) return;`. Removes 1.6 MB from first paint.
7. `ConfirmDialog.tsx:17` - pass `!!request`. Restores the focus trap on the app's most-used modal.
8. `ViewToggle.tsx:161-169` - add `aria-pressed`. `WorkInProgressDialog.tsx:20` - add `useFocusTrap(true)`.
9. `settings.ts:382, 436-438` - clamp `playbackSpeed`, validate `windLevels` elements.
10. `interpolate.ts:19` - `ys[xs.length - 1]`.

### 2. The fin-geometry cluster (do it as one change)

11. **First, fix the test.** Add the interior-point assertion to `reportGeometry.test.ts:21` (`y` near 18.0 mm at `x = 5 mm` for a 50 x 30 mm fin) and watch it fail. Everything below is then verified rather than asserted.
12. Hoist `ellipticalFinPoints(root, height, n)`, `trapezoidPlanform(node)` and `finTabSpan(node, root, parentRadius)` into `tree/position.ts` beside `freeformRootChord`, and convert all consumers: `solidMesh`, `reportGeometry`, `Rocket3D`, `dxfExport`, `schematicShapes`.
13. `dxfExport.ts:118` - use `freeformRootChord`. This is the last unconverted `Math.max` copy and the comment naming the other four is already in the tree.
14. `Rocket3D.tsx:163` - build the shape from `ffPoints`, not raw points.
15. Tube fins as one unit: add `tubefinset: ['outerRadius']` to `AUTO_COMPONENT_FIELDS`, give `solidForNode` a `parentRadius` and route it through `tubeFinRadius`, and fix the phantom-`rootChord` span at `reportGeometry.ts:126`.

### 3. Storage integrity

16. `idbKeyValueStore.ts` - make `get()` prefer the fallback for keys `set()` fell back on, or fail the `set`. Nothing downstream can report "storage full" correctly until this is right.
17. `designLibrary.ts` - propagate the boolean from `setActive`/`rename`/`remove`, and reorder `remove()` to rewrite the index before deleting blobs.
18. `materialStore.ts:56` and `templateStore.ts:167` - throw `'storage-full'` the way `motorStore.addCustomMotor` now does.
19. `designLibrary.ts:107-119` - serialize the index read-modify-write.
20. Add the `isStoredResult` guard to `readResults` and make `flightPathExport.ts:542` non-finite-safe.

### 4. State-layer correctness

21. `useWorkspaceEffects.ts:224` - gate the flight-key effect on first run. **Fix the fixture too:** the saved workspace must differ structurally, not just by name, or the new test passes against the old code.
22. `reportModel.ts:167` - resolve each stage's mount against the full tree. This is exported, shared, wrong data.
23. `store.ts:940-963` - collect failures into a `failed[]` array beside `skipped`.
24. `store.ts:1135` - split `claimWorkspace` into claim and observe.
25. `store.ts:1086` - add a guard to `refreshDesigns`. `store.ts:500` - add the three fields to `HistoryEntry`.

### 5. Gate the holes the gates do not cover

26. Narrow `cspell.json:26` so the locale files are actually spell-checked. The `flagWords` list is useless without it.
27. Add `tsconfig.node.json` for the four config files and chain it into `typecheck`.
28. Add `"e2e/**/*.ts"` to `knip.json`'s `project` (costs one de-export), and consider dropping `ignoreExportsUsedInFile` after clearing the 30 surplus exports.
29. Make `build` call `npm run lint` rather than inlining it.

### 6. Performance and the remaining refactors

30. Drop the ignition deps from the static-info effect (`useWorkspaceEffects.ts:214`) and debounce the `AeroAnalysis` condition inputs. Both are per-keystroke kernel work.
31. Memoize the `AftView` scene build the way `TreeSchematic` already does; memoize the `TreeSchematic` ruler marks; fix the `FlightPath3D` playback allocation and the `Streamer` disposal.
32. Unify the duplicated helpers: the two `niceStep`s plus `groundTrack`'s third ladder, the two `hexToRgb`s, the three `M_TO_MM`s, and `impulseClass`.
33. Derive `outdated` from a stored flight key instead of maintaining the flag at six call sites. Do this **after** step 21, which it subsumes.
34. Move `RAW_FIELDS` out of `PropertyPanel` into `services/componentFields.ts`; gate `AppHeader`'s six dialogs behind their open flags.
35. Add the missing test suites named above: `Rocket3D` camera framing, `orkImport` hostile input, `loadOrk`, and the seven untested store actions.

### Deliberately deferred

The `solidMesh` cap triangulation (ear-clipping), the scale-relative mesh tolerances and the `segmentsCross` touching case are all real but need mesh-validation test infrastructure that does not exist yet. Build that once, then do all three together. Wiring `shapeParameter` into the editor is a feature, not a fix; decide whether you want it before deleting `shapeUsesParameter`.

---

## Fixed in this round (2026-09-19)

The fin-geometry cluster and its root cause are closed. What changed:

**One module owns the shape.** `web/src/tree/finPlanform.ts` is now the only
place a fin outline is generated: `ellipticalFinPoints` (kernel-exact, the
31-point table from `EllipticalFinSet`), `trapezoidFinPoints` (including the
kernel's tip-collapse rule at 0.0001 m), `finPlanformPoints`, `finRootChord`,
`finSpan`, `finTabSpan` (with the kernel's `min(parentFrontRadius,
parentTrailingRadius)` clamp), `finCutContour` and `parentRadiusOf`. Converted:
`solidMesh`, `reportGeometry` (both the 1:1 template and the side view),
`dxfExport`, `Rocket3D`, `schematicShapes`, `AftView`, `schematicGeometry`.

**The specific defects, all closed:**

- Elliptical fins are the kernel's half-ellipse in every consumer, not a sine
  arch. At the x = 5 mm station on a 50 x 30 mm fin the app now returns 18.0 mm.
- `dxfExport` uses `finRootChord` (kernel `last.x - first.x`), not `Math.max`,
  so an overhanging freeform fin's tab is no longer up to 20 mm out of place.
- `Rocket3D` builds the freeform shape from the same normalized points it
  measures, so a fin whose outline starts at x = 20 mm is drawn where it is
  mounted.
- Tube fins auto-size from the body radius and fin count in the mesh export
  (`tubeFinRadius`), instead of a hardcoded 12 mm, and return `null` rather
  than inventing a size when no parent radius is known. `tubefinset` is in
  `AUTO_COMPONENT_FIELDS`, so the Run button no longer refuses a valid
  auto-sized import, and `reportGeometry` measures a tube-fin set by its own
  length instead of a phantom 50 mm root chord.
- One set of dimension fallbacks (`FIN_DEFAULTS`), so `tipChord` is no longer
  30 mm in the STL and 60 mm in the DXF.
- The tab is clamped to the parent radius on every path; `reportPdf` and
  `componentExport` now pass the mounting radius.
- `finSpan` had three near-copies (here, `AftView`, `schematicGeometry`) that
  differed on the zero floor; there is now one, floored at 0.

**The gate that makes it stick** is `web/src/tree/finPlanform.kernel.test.ts`
(21 cases). It is not an ordinary unit test:

1. **Source-drift guard** - reads the committed Java under
   `engine-java/src/java` and asserts the formulas are still the ones the port
   was written against, for `EllipticalFinSet`, `TrapezoidFinSet`,
   `TubeFinSet` and `FinSet`'s tab clamp. Verified to fail by perturbing
   `POINT_Y[i] = Math.sin(a)` in the Java and watching it break.
2. **Independent re-derivation** - expected values are computed from the
   kernel's algorithm transcribed in the kernel's structure, never by calling
   the code under test.
3. **Recurrence guard** - fails if kernel trigonometry appears anywhere outside
   the three modules that own it. Verified to fail by planting
   `Math.sin(Math.PI * t)` in `csvExport.ts`; it named the file.
4. **Cross-path consistency** - the STL/DXF contour and the PDF template must
   describe the same polygon, for every fin type, with and without a tab.

The weak test that let this through was replaced: `reportGeometry.test.ts` now
asserts every sample against the closed form rather than point count and apex.

**Still open from the geometry slice:** the `reportGeometry` side view still
omits pods and parallel stages; `position.ts:166` still hands non-chain stage
children a zero parent length; launch-lug mass still scales as k^3; the
`solidMesh` cap triangulation, tolerance scaling and `segmentsCross` touching
case are unchanged (see **Deliberately deferred**).

**The general lesson, now recorded in `docs/AUDIT_PROMPT.md`:** `web/src/tree`
and `web/src/services` are a hand-port of kernel math that the `parity` job
does not cover, because parity compares the kernel to itself across three
runtimes. Ported math must be checked against `engine-java/src/java`, never
against another copy in `web/`.

---

## Second pass, same day: the deferred geometry items are closed too

Everything listed under "Still open from the geometry slice" above is now done,
plus the mesh-validation infrastructure that was the reason for deferring three
of them. Each fix has a test that was **verified to fail against the old code**
before the fix landed.

### The PDF side view now matches the 2D schematic

`rocketSideView` walked only the core nose-to-tail chain, so a strap-on booster
cluster printed as a single plain tube while the screen drew the boosters. It
now recurses into `podset` and `parallelstage` exactly as `schematicShapes`
does, through the same `assemblyChainLength` / `resolveAssemblyRadius` /
`ringInstanceOffsets` helpers, and returns a new `pods: Pt[][]` that `reportPdf`
fills beside the airframe. Fins on a booster mirror about the BOOSTER's
centerline rather than the rocket's axis, and the drawing height grows to fit
the outermost instance so the PDF does not clip it off the page. Five tests in
`reportGeometry.test.ts`, including the three-booster ring angles.

### Off-axis assemblies are positioned against their own extent

`position.ts` gave every non-chain stage child a parent length of **0** and the
core chain's running total as its start. With a parent length of 0,
`startFromPosition` resolves a `middle` child to `-childLen/2`, forward of the
assembly's own nose, so an `after` sibling chained off a wrong station and an
`absolute` child was rebased against the wrong origin. Each such child is now
walked with its own `axialLength` and anchored where its position actually puts
it in the stage. Two tests in `position.test.ts`, both confirmed failing on the
old walk.

### Launch lugs scale by the one dimension that grows

`LENGTH_KEYS.launchlug` scales only `length` (the bore is the launch rod), but
the type was not in `FIXED_SIZE`, so a pinned mass took the default `k^3`: a 1 g
lug became 8 g after a 2x scale, straight into the scaled design's mass and CG.
Now `MASS_EXPONENT.launchlug = 1`.

### A mesh validator, and the three solid-mesh defects under it

`services/meshValidate.ts` is the new single place that asks whether a geometry
is really a printable solid: empty index, non-finite vertices, degenerate and
repeated-vertex triangles, non-manifold edges, and inconsistent winding
(a directed edge traversed the same way by two faces). `solidForNode` is now the
choke point: every printable solid is validated on the way out, and a failure
returns `null` so the caller reports "this part cannot be exported" instead of
writing a file no slicer can use. All thirteen real component types are held to
it in `meshValidate.test.ts`.

The three defects, all fixed and all proven:

1. **Caps are ear-clipped, not fanned.** The fan used the arithmetic mean of the
   loop's vertices, which is not the polygon's centroid and for a non-convex
   loop can fall outside the loop entirely. `THREE.ShapeUtils.triangulateShape`
   on the loop's own plane replaces it, using only existing vertices, with each
   triangle's facing checked against the loop's Newell normal rather than
   assumed.
2. **Weld and degeneracy tolerances scale with the model.** They were absolute
   (1e-6 m, 1e-12 m^2) while the scale tool accepts any positive factor, so a
   heavily scaled-down part had every triangle dropped, and an empty mesh has no
   open edges, so it "succeeded". `meshTolerances` derives both from the
   bounding-box diagonal, capped at 1 m so a normal rocket keeps exactly the
   tolerances it always had. The 0.2 mm nose cone that used to export empty now
   exports 18432 triangles.
3. **`segmentsCross` counts touching.** Strict inequalities meant a vertex
   exactly on a non-adjacent edge, or two vertices dragged onto each other in
   `FreeformFinEditor`, was not a crossing, so a pinched outline passed
   `isSimplePolygon`. On-segment cases are now crossings, plus an explicit
   duplicate-vertex scan that does not depend on exact floating-point zeros.

**An honest note on what the validator does and does not catch.** The cap fan is
a GEOMETRIC defect, not a topological one: a fan from an outside apex is still a
closed, consistently wound surface (each spoke is traversed once in each
direction), so neither an edge count nor the winding check can see it. The two
tests that pin it therefore assert the property directly, that every cap
triangle's centroid lies inside the outline it is closing and that capping adds
no vertex of its own. Both were confirmed to fail against the fan. Full
self-intersection testing is still not implemented and would need spatial
indexing.

### Gates after this pass

1234 tests across 108 files, `tsc` clean, eslint clean, knip clean, prettier
clean, cspell clean.

---

## Third pass: the five one-line HIGHs

The batch at the top of the recommended order, all closed, each with a test
confirmed failing against the old code.

1. **A failed thrust-curve download no longer flies a C6.** `loadOrk.ts` now
   seats `unresolvedMotor(ref)` in the `catch`, exactly as the catalog-miss
   branch already did. Leaving the mount unset was not neutral: `mountMotors`
   seeds a default C6 into any mount without one.
2. **Six launch fields no longer export the literal string `null`.** `?? 0` on
   each, matching the legacy wind pair two lines away.
3. **Fresh thrust-curve samples are validated.** `thrustcurve.ts` runs the same
   `isSampleArray` guard on the network path that the cache read always used,
   and falls back to a stale curve or throws rather than handing nulls to the
   kernel.
4. **`NumberInput` rejects Infinity.** The parse moved into an exported pure
   `parseFieldValue(raw, min, max)`, because jsdom refuses to deliver "1e999"
   to a `type="number"` input at all, so a rendered test of the overflow case
   passes for the wrong reason. A real browser does deliver it. The function is
   unit-tested directly; the rendered tests keep the ordinary cases.
5. **The 1.6 MB motor catalog is no longer fetched on app start.** Both load
   effects are gated on `open` (and `open` added to their deps). Both dialogs
   are mounted unconditionally and only `return null` when closed, which does
   not stop an effect, so the deferral both files' comments described was not
   happening.

### Gates after this pass

1252 tests across 111 files, `tsc` clean, eslint clean, knip clean, prettier
clean, cspell clean.

### Remaining

6 HIGH, 36 MED, 30 LOW. The next coherent block is storage integrity: the
quota-refused save shadowed by a stale IndexedDB copy, cached flight results trusted with no
shape check, the unsynchronized library index, `remove()` ordering, and the
discarded write results in `setActive`/`rename` and the material/template
stores. They share one failure mode, silent data loss, and want doing as a unit.

---

## Fourth pass: storage integrity

All seven findings in the block, done as a unit because they share one failure
mode: silent data loss. Each has a test confirmed failing against the old code
(12 of the 15 new cases fail on it).

**The tier gained one primitive.** `KeyValueStore.update(key, fn)` does a
read-modify-write in a SINGLE store transaction. IndexedDB transactions are
atomic across connections, which is what makes the index safe against a second
tab; the localStorage fallback does it synchronously, which is atomic within a
tab and is all that degraded mode can offer.

1. **A quota-refused save is no longer shadowed by the stale copy.**
   `idbKeyValueStore` now tracks keys whose newest value went to the fallback
   and prefers the fallback for those, AND deletes the stale IndexedDB entry so
   it cannot come back in a later session where that memory is gone. A delete
   frees space, so it can succeed where the write that just failed did not.
2. **Stored flight results are shape-checked.** `readResults` validates each
   entry and drops the ones that fail, keeping the rest. The check is strict
   about FINITENESS only for the three fields the exporters format with
   `.toFixed()`, because discarding a whole flight over a peripheral field
   would be a worse trade than the crash it prevents. `flightPathExport` got a
   non-finite-safe formatter as the second line of defense.
3. **The design index is mutated atomically** through the new `update`, so two
   tabs saving at once no longer drop one another's entry.
4. **`remove()` writes the index FIRST** and only deletes the bytes if that
   lands, returning false otherwise. Orphaned bytes cost space; the old order
   cost a working app (`activeId()` returned a design whose blob was gone, and
   the next load threw `unreadable-design`).
5. **`setActive` and `rename` return their write result** instead of resolving
   cleanly on a refusal.
6. **The material and template stores throw `storage-full`**, as the motor
   store already did. Both delete call sites in the UI (`MaterialPicker`,
   `FlightPathExport`) gained error handling, since they could not throw before.
7. **A journal written before the first save is replayed into a new design**
   rather than being neither replayed nor cleared. It carried a null id, and
   `null !== null` is false, so both the replay test and the staleness test
   skipped it: the work was lost and the dead blob squatted in the ~5 MB
   localStorage budget forever.

### Gates after this pass

1267 tests across 112 files, `tsc` clean, eslint clean, knip clean, prettier
clean, cspell clean.

### Remaining

4 HIGH, 30 MED, 30 LOW. The HIGHs left are all in the state and component
layers: batch simulation failures overwriting each other, every restored
simulation flagged outdated on load, the per-stage report seating the wrong
motor, and count fields with no upper bound.

---

## Fifth pass: the last four HIGHs

**Every HIGH in this audit is now closed.** Each fix has a test confirmed
failing against the old code (9 of the 12 new cases fail on it).

1. **A batch reports every failure, naming each row.** Each row's `catch` did
   `set({ err })` on its own, so in a batch every message overwrote the one
   before it and none carried a row name; the skip line then overwrote
   whatever survived. Failures are now collected into a `failed[]` array
   beside `skipped[]` and emitted as one combined banner, which is exactly the
   fix the function already had for skips, described in a comment sitting
   directly above the code that still had the bug. New i18n key
   `sim.failedNamed` in both locales. A single-row failure is now named too,
   matching how skips have always read.
2. **Restoring a design no longer invalidates its flights.** The flight-key
   effect had no `ready` gate, unlike the rebuild effect beside it, so the
   key changing from the default rocket to the hydrated one marked every
   restored result stale, and `autoRunOutdated` then re-flew them. It now
   keeps the last key in a ref and seeds it on the first post-hydration run.
   The old fixture could not catch this (it differed only by `name`, which
   `flightKey` strips), so the new tests use a structurally different tree.
3. **Each stage's summary uses the motor in THAT stage's mount.** Extracted as
   a pure `stageMotor(stageTree, primaryMountId, active)` so the decision is
   testable on its own. `buildConfiguredRocket` seats whatever motor it is
   handed into whatever mount it finds, so passing the active simulation's
   motor for every stage put the sustainer's motor in the booster, and the
   extras loop then skipped the booster's own motor because its id matched the
   mount just filled. The same call site also stopped dropping the primary
   ignition override when it rebuilt the live handle.
4. **Counts have a ceiling.** `countOf(node, key, fallback)` in
   `tree/nodeProps.ts` clamps to `[1, MAX_INSTANCE_COUNT]` (64) and replaces
   all eleven `Math.max(1, Math.round(num(...)))` sites, so the cap cannot be
   applied in some loops and forgotten in others. `PropertyPanel` clamps at
   the source too and passes `max` to the input, since the value was persisted
   and exported before any renderer saw it.

### Gates after this pass

1279 tests across 113 files, `tsc` clean, eslint clean, knip clean, prettier
clean, cspell clean.

### Remaining

**0 HIGH, 30 MED, 30 LOW.** The MEDs cluster into: components and performance
(8), state layer (4), parsers (3), tooling (4), accessibility (3), tests (3),
and a few architecture items. Nothing left is a correctness bug that silently
produces wrong numbers or loses data; the remaining correctness items are
localized (a Mach readout disagreeing with its own tables, `thrustAt` losing a
curve's tail, two `impulseClass` implementations).

---

## Sixth pass: the motor-curve findings, and a correction to one of them

### Correction: the "32% impulse understatement" was wrong

The `thrustAt` finding was reported with a 32% figure. That came from a
SYNTHETIC three-point curve with a 1.7-second final interval, not from data.
Measured against the 1477 curves in the bundled catalog: 1471 end at zero
thrust and were unaffected, and the 6 that do not had errors of **0.0% to
0.4%** (worst: a D9, 0.09 N-s). The bug was real; the impact figure was not.
A worst-case constructed input is not an impact estimate, and it should have
been checked against the shipped data before being written down.

### But checking it properly turned up something much worse

Auditing the same function against the real catalog found a THIRD bug in it,
which no one had reported:

**A step encoded as two samples at the same timestamp was read as the value
BEFORE the step.** Thrust curves use a duplicated time to mean a vertical edge
(an instant ignition spike, or a cut-off). The union of breakpoints
de-duplicates those times, and `thrustAt` returned the first sample at a time
rather than the last. **K543 begins `[0, 0], [0, 2117]` and was reported as
771.8 N-s against a true 2117.3 N-s: a 63.5% understatement, a K-class motor
shown as if it were barely a J.** Nine of the 781 motors the Motor Dashboard
can display had a wrong combined total; the others were off by 0.1% to 13.9%.

Scope: `combineCurves` has exactly one caller, the Motor Dashboard's
comparison panel. None of this reaches the simulation, which uses the raw
`MotorSpec` through the kernel.

### What changed

- **`thrustAt`** returns the final sample's thrust AT its time (0 only past
  it), and at a duplicated timestamp returns the LAST sample there, which is
  the curve's value going forward.
- **`combineCurves` sums the curves' own impulses** rather than integrating a
  resampled curve. Simultaneous ignition means the cluster's impulse is the
  sum of the motors' impulses, exactly, by linearity: no resampling, nothing
  to lose at a step or a breakpoint. All 1477 catalog curves now combine to
  exactly their own trapezoidal impulse, asserted as a test.
- **A terminator point** is added just after any curve that ends non-zero, so
  the chart shows the abrupt stop instead of a ramp. Without it, a cluster
  whose shorter motor ended abruptly was credited with thrust it no longer
  made (an 8 N-s pair read as 10).
- **One `impulseClass`.** `engParser`'s private copy clamped every sub-A
  impulse to index 0, filing a 0.75 N-s MicroMaxx as an **"A"**. It now uses
  the shared classifier, which gained the real NAR fractional classes
  (1/8A <= 0.3125, 1/4A <= 0.625, 1/2A <= 1.25) instead of reporting a dash
  for everything below A.

`MicroMaxx` was added to the project dictionary; it is a Quest product name
that will recur.

### Gates after this pass

1288 tests across 113 files, `tsc` clean, eslint clean, knip clean, prettier
clean, cspell clean. 8 of the new cases fail against the old code.

---

## Seventh pass: the remaining 28 MEDs

**Every finding in this audit is now closed: 0 HIGH, 0 MED, 30 LOW.**

**Untrusted input (4).** The runtime motor catalog is validated row by row
(`isCatalogMotor`), not just `Array.isArray`, so one bad row can no longer take
down the whole picker. `windLevels` elements are filtered for four finite
fields. A blank required cell in a wind CSV now fails the row instead of
importing as a genuine 0 m/s reading. A `.eng` header must have a positive
diameter and length and a propellant mass between 0 and the total: a negative
one made the rocket GAIN mass as the motor burned.

**Wrong number on screen (1).** `machPick` is re-clamped when `machMax`
shrinks, so the strip header can no longer read "at Mach 3.00" above three
tables reading Mach 1.00.

**State layer (4).** `observeWorkspace()` joins `claimWorkspace()`, and the two
save actions use it: saving during a large `.ork` import no longer aborts the
import silently. `refreshDesigns` got a generation guard. Ignition is read from
the store inside the rebuild effect instead of being a dependency, so typing a
delay no longer runs four full engine rebuilds. `outdated` is now set ONCE in
`patchTargets`/`patchActive` rather than remembered at seven call sites.

**Performance (5).** The aero-sweep inputs commit on blur or Enter. The
playback path's geometry is pinned to the sample index, so drei rebuilds it
when a point is revealed rather than sixty times a second, and the flight
callouts are keyed by identity. `Streamer` disposes its geometry. The aft view
memoizes its whole scene on `[tree, motors]`. The 8K export only restores the
renderer if the component is still mounted.

**Accessibility (4).** `ConfirmDialog` passes `!!request`, so the app's
most-used modal finally has a focus trap. `WorkInProgressDialog` has one at
all. The view toggle has `aria-pressed`. The caliper handles are focusable
`role="slider"` controls with arrow/Home/End nudging.

**UI correctness (3).** Global undo ignores keystrokes while a text field has
focus. `maxTime` and `timeStep` are bounded, as are launch temperature and
pressure. `FlightChart` namespaces its SVG ids with `useId()`.

**Tooling (4).** `tsconfig.node.json` brings the four build config files into
`typecheck`. `build` calls `npm run lint` instead of repeating it.
`optimizeDeps.exclude` points at the file that exists. The spell gate now
covers `en.json` - and doing so immediately found a real British spelling of
"stabilize" live in shipped UI copy, which is precisely what `flagWords` was
added for and could never reach. `es.json` stays out: the dictionaries are
en-US, so it would report every Spanish word.

**Test gaps (3).** `orkImportHostile.test.ts` exercises the zip-bomb caps, the
entry-count cap and the nesting-depth limit with real hostile archives.
`Rocket3D.test.ts` proves the export framing, including that every corner of a
long thin box lands inside the frustum. `storeActions.test.ts` covers
`scaleDesign`, `saveDesignAs`'s storage-full branch, `deleteDesign`'s
open-vs-other paths, `newWorkspace`'s confirm and decline, and
`exportComponent`.

### Two judgment calls

`outdated` was centralized in the two patch helpers rather than rewritten as a
derived flight-key selector. The finding's substance is the fragility of seven
call sites each having to remember; centralizing removes that. A derived key
would also change a PERSISTED shape, and the live bug it protected against is
already fixed and tested.

The first version of the nesting test asserted `expect(threw || true)`, a
tautology that passed no matter what, and used a depth so large that jsdom's
own parser timed out. Both fixed: 150 levels against a cap of 100, asserting
the thrown message.

### Gates after this pass

1328 tests across 116 files, `typecheck` (now three projects) clean, eslint
clean, knip clean, prettier clean, cspell clean across 343 files.

---

## Eighth pass: the 30 LOWs

**The audit is closed: 0 HIGH, 0 MED, 0 LOW.** (Three of the listed LOWs had
already been fixed in earlier passes, so 29 were outstanding.)

**Correctness (7).** `lerpAt` indexes its extrapolation off `xs`, not `ys`
(`lerpAt([0,1],[0,10,999],5)` returned 999), and the unreachable
`span === 0` branch is gone. A wall at least as thick as the radius returns
null instead of exporting a solid rod. Packed recovery `length` scales.
Range-ring radii are rounded to the step's own decade (see the ninth pass:
the `i * step` this pass shipped did not actually fix the finding).
`RecoverySizingReadout` uses `num(node, 'cd', 0.8)`, so
a deliberate `cd: 0` is no longer swallowed. `playbackSpeed` is clamped. The
DXF bounds use `reduce` rather than spreading an uncapped point array.

**State and storage (3).** `HistoryEntry` carries `selectedSimIds`,
`lastRunIds` and `resultSimId`, so undoing a sim delete restores the tick and
the Results picker. The four async store actions are typed `Promise<void>`.
`onblocked` closes the late connection instead of leaking it and blocking the
next upgrade.

**Components (4).** The ruler graduations are memoized (the last unmemoized
derivation in `TreeSchematic`). The phase-color inputs commit on blur rather
than writing settings on every drag tick. `MaterialPicker` guards both
post-await writes with a mounted ref. Geolocation shows a pending state and
reports refusal in a live region instead of doing nothing visible.

**Accessibility (3).** The update toast's `role="status"` is always mounted
and only its contents change, which is what makes it announce at all. The
image-export menu has `role="menuitem"` children, Escape, and focus return.
`PaneSplitter` announces the clamped maximum it can actually reach.

**Validation (2).** `partColors` values are filtered to hex strings before
reaching a style attribute. Declared motor configurations are capped at 256,
bounding the per-config re-scanning.

**Duplicated helpers (1 finding, 3 pairs).** `niceStep` became
`niceRulerStep` in `schematicGeometry` (it divides by 8 and has a 2.5 rung;
`prefs/units.niceStep` does not), and its duplicate test block in
`TreeSchematic.test.ts` is gone. `hexToRgb` became `hexToRgbInt` (packed, for
KML) and `hexToRgbTuple` (triple, for jsPDF). `M_TO_MM` is declared once in
`prefs/units` and imported by the three exporters.

**Architecture (2).** The six header dialogs mount only while open - the thing
that made the 1.6 MB catalog fetch on app start possible. `RAW_FIELDS`,
`FIELDS` and `PANEL_SCOPE_KEYS` moved to `services/componentFields.ts`;
`PropertyPanel` went from 898 to 637 lines and `services/` no longer depends
on a component module for its own domain shape.

**Dead code (4).** `msToFtS` deleted with its test - nothing rendered ft/s.
The eight surplus value exports are de-exported, and `knip.json` now sets
`ignoreExportsUsedInFile` to `{interface, type}`: a VALUE export must be used
externally, while a type a module's own signatures reference may stay
published. `e2e/**/*.ts` joined knip's project set. The `protuberance` row for
a component type that does not exist is gone.

**`shapeUsesParameter` was a missing feature wearing a dead-code costume**, as
the audit put it, and it is now the feature. Nose cones have a
Shape parameter field (transitions only got theirs in the ninth pass, below),
rendered only for the shapes that use one
(`shapeUsesParameter`) and clamped by `shapeParamMax` - both previously
exported, tested, and called by nothing. Before this, a power/haack/ogive
nose imported from a file carried a parameter that changed its whole profile,
that the user could see the effect of and never edit, and that round-tripping
froze at whatever the file said.

**Tests (1).** `aeroHeat.test.ts` checks the cell-shading port against an
independent transcription of `java.awt.Color.getHSBColor`, plus the absolute
1.5 Cd anchor, the relative sky ramp and `niceName`.

### Gates after this pass

1341 tests across 117 files, `typecheck` clean across three projects, eslint
clean, knip clean under the stricter rule, prettier clean, cspell clean across
345 files, and `npm run build` succeeds.

## Ninth pass: tests for the fixes that had none

The question this pass answers is "which audit fixes shipped without a test
that can see them?" - asked of the suite rather than of memory. Eleven came
back, and writing the tests turned up two fixes that were not fixes. What was
deliberately left alone is listed at the end, with the reason for each.

### Fixed, but invisible to the suite

Each of these had a test file that looked like coverage and could not reach
the changed path. All seven fail against the pre-fix code and nothing else does.

- **`lerpAt`** (`interpolate.test.ts`). Nine existing cases, every one an
  equal-length `xs`/`ys` pair - where `ys[ys.length-1]` and `ys[xs.length-1]`
  are the same element, so both the old and new code pass all nine. The bug
  needed a longer `ys`.
- **`solidMesh` wall at least as thick as the radius**. The neighboring case is
  named "returns null for degenerate geometry" and covers zero radius, zero
  length, zero-area fin and fewer than three points. The wall case is the only
  one whose inputs are all non-zero, which is how it sat outside a block
  written for exactly it.
- **`partColors` hex filter** (`settings.test.ts`). The existing case
  round-trips a valid `#123456`; every rejected shape has to be passed in
  deliberately.
- **`scaleRocket` packed recovery `length`**. The shared fixture's parachute
  declares no `length`, so the added scale entry was unreachable from the
  suite.
- **`rangeRings` on a fractional step**. Every existing case is an integer
  step, where float error cannot arise either way.
- **The DXF bounds guard.** Nothing in the suite passed a large outline, so
  the `reduce` that replaced `Math.max(...outline.map(...))` had nothing
  holding it. The test needed two details to be real: 200 000 points (100 000
  still spreads fine on current V8) and a 20 µm zig-zag in `y`, because
  `dedupe` drops consecutive points within EPS and an evenly-sampled outline
  collapses to a handful before it ever reaches the line in question.
- **The `playbackSpeed` clamp.** The existing case stores the string `'fast'`,
  which the `typeof` guard already rejected before the fix. What the fix added
  is finiteness and a range, and a stored NaN is the case that hurts: it types
  as `number`, so only the finiteness check catches it, and it stops the
  playback clock with no way back but clearing storage.

### Untested entirely

- **The Shape parameter field.** The newest thing in the panel and the least
  covered: `shapeUsesParameter` and `shapeParamMax` were both unit-tested in
  `tree/shapeProfile` with zero production callers, so the helpers were proven
  and the wiring - which is the whole feature - was not. New
  `PropertyPanel.shapeParam.test.tsx`, 16 cases.
- **`hexToRgbInt`.** Its renamed twin `hexToRgbTuple` has a full block; this
  one had nothing. The 3-digit divergence between them is now recorded rather
  than left to be discovered.
- **`MAX_MOTOR_CONFIGS`.** Added to `orkImportHostile.test.ts`, whose own
  docblock makes the argument: a cap nobody has watched trip is a cap nobody
  knows still works.
- **`onblocked`.** Cannot be provoked through fake-indexeddb at a fixed
  `DB_VERSION`, so the request object is stood in for directly. The leak - a
  late `onsuccess` resolving into nobody, leaving a connection open that then
  blocks the next upgrade - is now asserted.
- **The three accessibility fixes.** New `UpdateToast.test.tsx`,
  `ImageExportMenu.test.tsx` and `PaneSplitter.test.tsx`; 11 of their 20 cases
  fail against the pre-fix code. The live region is the clearest example of
  why these needed tests at all: mounted-empty and created-with-its-text look
  identical on screen and differ entirely to a screen reader, so nothing but
  an explicit assertion distinguishes them.

`vitest.config.ts` gained one alias: `virtual:pwa-register/react` is
synthesized by `vite-plugin-pwa` during the app build and fails at RESOLUTION
time under Vitest, before `vi.mock` can intercept it - so `UpdateToast` could
not be rendered in a test at all. It resolves to `src/testing/pwaRegisterStub.ts`.

### Two fixes that were not fixes

**`rangeRings` was fixed wrongly.** The eighth pass replaced the accumulating
`r += step` with `i * step` and claimed labels would stop reading
`0.30000000000000004`. They do not: `0.1 * 3` is `0.30000000000000004` in
IEEE754 just as `0.1 + 0.1 + 0.1` is. Across 800 000 sampled (extent, count)
pairs the two forms differ in **six**, and in two of those six the
accumulating form was the cleaner one. 2112 pairs still produced a long float.
The finding was real and the fix was inert. Each radius is an integer multiple
of `10**exp`, so it has at most `-exp` real decimals and anything past that is
noise: rounding there gives 0 artifacts and 0 over-extent radii across 1.8
million pairs. The only caller happens to format with `Intl.NumberFormat`, so
nothing user-visible was ever wrong - which is why nobody caught the claim.

**The Shape parameter field was only half-added.** The eighth pass said "nose
cones and transitions"; only `nosecone` got the row. A transition offers the
same four parametric shapes, `orkImport` reads `<shapeparameter>` into it,
`orkExport` writes it back, and the mesh, report, schematic and 3D view all
render it - so a power or haack transition had exactly the uneditable frozen
parameter the nose cone was fixed for. The gating code even anticipated it
(`node.type === 'nosecone' ? 'ogive' : 'conical'`). The test asked for a power
transition's field, did not find one, and that is how this surfaced.

### Left without a test, and why

Eight fixes from the earlier passes are deliberately not covered. Three of
those reasons are structural and one is a judgment call, which is a weaker
thing, so they are kept apart here rather than run together as "not worth it".

**Enforced by the compiler, so a test would restate it.**

- The four store actions retyped `Promise<void>`. The declaration IS the
  assertion, and no runtime behavior changed.
- `niceRulerStep`, `hexToRgbTuple` and the single `M_TO_MM`. Renames and a
  dedup with byte-identical behavior; the failure they prevent is importing
  the wrong one of a pair, which is a type error at the call site.
  (`hexToRgbInt` got tests regardless, because it had none at all - that is a
  coverage gap that happens to sit on a renamed function, not a reason to
  test the rename.)

**Behavior-identical by construction.**

- The ruler-graduation memo computes the same values less often. A test would
  have to count renders or recomputes, which pins an implementation detail and
  breaks on any unrelated refactor, and the values themselves are already
  covered by `schematicGeometry.test.ts`.

**Already covered where it actually bites.**

- The six header dialogs mounting only while open. What stopped the 1.6 MB
  catalog fetch on app start is the `open` guard inside `MotorDashboard` and
  `MotorDialog`, and `catalogLazyLoad.test.tsx` asserts exactly that in both.
  The conditional mount in `AppHeader` is a second layer behind a covered
  first one; a test for it would assert that the header renders one particular
  child, which fails every time the header is rearranged and never catches a
  real regression.

**Deferred by judgment. These four could be tested and were ranked below the
rest of this pass; the reason is cost against likelihood, not principle.**

- `RecoverySizingReadout` using `num(node, 'cd', 0.8)`. The most worth doing
  next of the four, because it is a correctness fix rather than a UI nicety: a
  deliberate `cd: 0` was being silently replaced with 0.8, so the readout gave
  a plausible finite descent rate for a canopy with no drag. One render and
  one assertion that the readout shows a dash.
- The phase-color inputs committing on blur rather than on every drag tick.
- `MaterialPicker`'s mounted-ref guard on its two post-await writes. Needs a
  deferred promise and an unmount between resolution and write.
- The geolocation pending state and refusal message.

None of the four is hard to reach: each is a single-component render in the
harness the three accessibility files now establish.

### Gates after this pass

1394 tests across 121 files, `typecheck` clean across three projects, eslint
clean, knip clean, prettier clean, cspell clean, and `npm run build` succeeds.
