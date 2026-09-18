# Proposal: tabbed workbench, right-hand property editor, parallel simulations

> Design proposal / decision record. Status: **Phases 1-3 implemented; Phase 4 proposed.** Companion to the [Architecture & internals](https://thzero.github.io/AstraRocketJs/docs/architecture) documentation page and to [`engine-worker-proposal.md`](./engine-worker-proposal.md), whose Phase 1 transport this builds on.

## Problem

The desktop workbench is a fixed three-pane grid (`App.tsx`): a 340px design column, the canvas, and a 380px simulations column. Everything the app can do has to fit those three panes at once, and three separate workarounds exist purely to make that possible.

1. **The right pane does four jobs at 380px.** `SimulationsPanel` stacks the Run button and summary tiles (`SimPanel`), the simulations list, a motor card per mount (`MotorRow`), and the whole `LaunchPanel`. It does not fit, so the list was made an accordion (`SimulationsPanel.tsx:62-65`): collapsed it shows only the selected sim, and the per-sim config is hidden entirely while the list is open (`:90`, `:146`). You cannot see the list of simulations and the simulation you are editing at the same time.

2. **The property editor is stacked under the component tree.** `EditorPanel` renders `ComponentTree` and then the 820-line `PropertyPanel` in one scrolling 340px column (`EditorPanel.tsx:77`). Both grow with the design; neither has room.

3. **The view switch mixes two families.** `ViewMode` is `2d | 3d | drag | flight | path` (`ViewToggle.tsx:3`), where the first three read the design and the last two read a flight result. On a phone those already live on different tabs, so `ViewToggle` takes a `mobileFamily` prop (`ViewToggle.tsx:31`) whose only job is to hide the other family's buttons below `lg`.

Meanwhile the mobile layout already solved this. `Tab = 'build' | 'sketch' | 'sim' | 'results'` exists (`TabBar.tsx:4`), the store routes views to the tab that can show them (`store.ts:294` `showing()`, `:617` `setTab`), and each tab gets the full viewport. The bar is just `lg:hidden`.

A separate limitation sits behind all of this: **simulations cannot run in parallel**. `simClient.ts` owns a single worker (`:27`) and the engine call inside it is synchronous (`simWorker.ts:35`), so requests serialize no matter how many are fired.

## Relevant current architecture

- **`web/src/App.tsx`** - the shell. `lg:grid-cols-[340px_minmax(0,1fr)_380px]`, collapsing to `..._2rem` when the sims pane is hidden. Panes are shown/hidden by `tab` below `lg` and by `lg:` utilities above it. The left (design) column is `hidden ... lg:block`: **there is no component editing on mobile today.**
- **`web/src/components/layout/TabBar.tsx`** - the mobile bar. The Results button only exists once a result does (`:24-25`), because a design edit destroys results.
- **`web/src/components/canvas/CenterView.tsx`** - one mounted component backing two mobile tabs, gating on `tab === 'build'` / `'sketch'` / `'results'` in five places with `lg:` overrides layered on top. Also holds the auto-run-outdated effect (`:117`) and the walk-back effect that pushes you off a result view when the result disappears (`:136-138`).
- **`web/src/state/store.ts`** - `tab`, `view`, `sims[]`, `activeId`, `simBusy`, `lastRunFailed`. `runSim` (`:558`) sets `simBusy` (`:572`), awaits the worker, discards a result the design has moved past (`:592`), and on success forces `view: 'flight', tab: 'results'`.
- **`web/src/engine/simClient.ts` / `simWorker.ts` / `simProtocol.ts`** - the Phase 1 sim worker. Generic `{id, method, args}` RPC, one worker, request-id map, 30s timeout with `killWorker` (`simClient.ts:34`). The worker warms its own engine on module load (`simWorker.ts:18`) and calls `resetEngine()` before each build (`:33`), so it holds no state between requests.
- **`web/src/services/simulations.ts`** - `Simulation = { id, name, motor, ignitionEvent?, ignitionDelay?, launch, result }`. One named flight setup over the shared design.

Two properties shape everything below:

- **Results are hard-invalidated, not marked stale.** Every input edit nulls them: `store.ts:406` (`invalidateResults`, from the tree-change effect), `:493` (motor), `:497` (ignition), `:504` / `:514` (extra motors), `:519` (launch). This is why the Results tab has to appear and disappear, and why `CenterView` needs a walk-back effect.
- **Each worker owns an independent engine instance.** Nothing is shared between workers, and `resetEngine()` per request means a worker is reusable. A pool is therefore a transport change only, with no engine work.

---

## Proposed model

Promote the tabs to **all** widths, and let the tab pick the column layout rather than one grid serving every purpose.

| Tab | Left | Center | Right |
|---|---|---|---|
| **Design** | Component tree (~280px) | 2D / 3D / Aero canvas | **Property panel** for the selection (~380px) |
| **Simulations** | (collapsed) | Simulations table, OpenRocket-style | Selected sim's editor: name, motor per mount, ignition, launch conditions, options |
| **Results** | Sim selector with multi-select (~240px) | Flight chart / 3D path / ground track | Plot config + `SimSummary` tiles |

The freed right column on the Design tab is the point of the exercise: the property editor stops competing with the tree for one 340px column, and the simulations list stops competing with the simulation editor for another.

### Tab state

Change the union to the workspace concept:

```ts
type Tab = 'design' | 'sim' | 'results';
type DesignPane = 'stats' | 'sketch'; // below lg only
```

`build` and `sketch` are two top-level tabs today only because a phone cannot show the stats strip and the drawing at once. That is a mobile pane concern, not a workspace concern. Splitting it onto its own axis is what lets a single `tab` value drive both layouts: `CenterView`'s five `tab === 'build' | 'sketch'` gates become `designPane === ...` with no `lg:` escape hatch, and `showing()` (`store.ts:294`) shrinks to keeping `view` and `tab` in the same family.

Mobile keeps four buttons (Design splits into Rocket / Sketch), so the bar and its labels are unchanged for a phone user.

### View switch

`DESIGN_VIEWS` belong to the Design tab and `RESULT_VIEWS` to the Results tab, so `ViewToggle` renders one family and the `mobileFamily` prop is deleted. `isResultView` stops being a layout predicate and becomes the tab router in `setView`.

### Property panel move

`ComponentTree` stays left; `PropertyPanel` moves to the right column. Both already read and write the store, so this is mostly a move, but `EditorPanel` holds the glue between them: node lookup, `parentRadius` for tube fins, `siblingIndex`, the last-motor-mount and last-stage guards, and the delete confirm. That glue should become a `useSelectedComponent()` hook so both panes stay presentational rather than one importing the other.

Because the design column is desktop-only today (`App.tsx`), this costs mobile nothing. It also opens an obvious follow-on: on a phone, Design can show the tree and slide the property panel over it on selection, which is the first time component editing would exist on mobile at all. Out of scope here, but the layout stops blocking it.

---

## Simulations tab

The center becomes a real table, one row per simulation, mirroring OpenRocket's columns:

| Status | Name | Motors | Rod exit | Apogee | Max velocity | Max accel | Time to apogee | Flight time | Ground hit |

Status is a dot: up to date (green), outdated (amber), never run (gray), failed (red). Toolbar: New, Duplicate, Delete, Run selected, **Run all outdated**. Row checkboxes drive batch runs.

The right panel takes everything `SimulationsPanel` currently crams in: the name field, a `MotorRow` per mount, `LaunchPanel`, and the per-sim simulation options. With the list and the editor finally visible together, `SimulationsList`'s accordion (`listOpen`, and the `!listOpen` gates at `SimulationsPanel.tsx:90` and `:146`) is deleted outright.

### Staleness: mark outdated instead of invalidating

This is the behavior change the table makes necessary, and it is worth making on its own merits. Today an edit nulls every cached result at the six sites listed above. Instead, keep the result and mark the simulation outdated:

- The Results tab becomes **permanent**, with no more appearing and disappearing (`TabBar.tsx:24-25`).
- The walk-back effect in `CenterView.tsx:136-138` and most of the `runFailed` / `willAutoRun` interplay dissolve, because a result view is never left holding nothing.
- Stale numbers stay readable while you edit, which is how you actually compare a change against the run that preceded it.
- The existing `settings.simulation.autoRunOutdated` preference gains a natural manual counterpart in "Run all outdated".

Persistence is already fine: `sims` (results included) is in the autosave payload (`store.ts:347` `snapshotOf`), while undo checkpoints already strip results as recomputable output (`:312-319`). Keeping results longer means the autosave payload carries per-timestep arrays more often; if that trips the existing storage warning, strip `result` from the persisted payload the same way `snap()` does and accept a re-run after reload.

---

## Parallel runs

This is the substantive engineering. `simClient.ts` holds one worker with one engine, and `design.simulate(options)` inside the worker is a synchronous call (`simWorker.ts:35`) that blocks that worker's message loop, so concurrent requests queue.

### Worker pool

- Spawn lazily, up to `Math.min((navigator.hardwareConcurrency ?? 4) - 1, 4)`. Cap at 4: each worker holds a full TeaVM engine instance. The WASM module is browser-cached after the first, so the marginal cost per worker is instantiation, not download.
- The `{id, method, args}` RPC already correlates by id. The change is a per-worker pending slot plus a dispatch queue in front of the pool. No protocol change, which is exactly the forward-compatibility the Phase 1 proposal bought.
- **`killWorker` must become per-worker.** Today it rejects every in-flight call (`simClient.ts:34`) because there is only one worker. In a pool, one hung simulation must not take down the other three. One request per worker at a time makes this natural.
- That same property gives Cancel for free: terminating the worker is the only way to interrupt a synchronous engine call, and with one sim per worker it is safe.
- Idle-reap workers after a timeout so a long editing session does not sit on four engine instances.

### Store

- `simBusy: boolean` becomes per-sim status: `'idle' | 'outdated' | 'queued' | 'running' | 'done' | 'failed'`. The table's status column reads it directly.
- `lastRunFailed` (currently a single `{ simId, tree }`, `store.ts:114`) becomes per-sim, folded into the status above.
- `runSim(prefs)` becomes `runSims(ids, prefs)`, enqueuing each. The per-run `ranOn` tree-identity guard (`store.ts:592`) already scopes correctness to a single run and carries over unchanged.
- `runSim` currently forces `view: 'flight', tab: 'results'` on success (`:601`). A batch of twelve must not yank the user anywhere. Navigate on an explicit single "Run and show", not on completion.

### BusyLock

`BusyLock` locks the design editor while `simBusy` is set, because canvas drags are design edits and a run in flight would be describing a rocket that changed underneath it. Once simulations live on their own tab, the design editor is not on screen during a run, and locking the entire editor for a twelve-sim batch would be the wrong behavior regardless. The `ranOn` guard is the real correctness mechanism; `BusyLock` can be dropped from the desktop design path.

---

## Results tab

Center keeps `FlightChart`, `FlightPath3D` and `FlightPathExport` as they are. Two additions the split makes cheap:

- **Left: multi-select over simulations**, so several runs overlay on one chart. OpenRocket cannot do this in a single plot window, and once the results view is no longer bound to `selectActive(s).result` it is mostly a series-mapping change.
- **Right: plot configuration** (series, axes) plus the `SimSummary` tiles, which on mobile already head the Results tab (`CenterView` renders them `lg:hidden` above the charts).

The top-down ground track listed in `TODO.md` lands here as a sixth `ViewMode`, using the projection math already in `flightPathExport.ts`.

---

## Roadmap

Each phase ships on its own.

### Phase 1 - tabs and layout - DONE
- `state/tabs.ts`: `Tab` is `design | sim | results`, with `designPane` (`stats | sketch`) as a separate phone-only axis. `showing()` and `setTab` route on it; new `setDesignPane` action.
- `layout/WorkbenchTabs.tsx` is the desktop strip under the header; `TabBar` stays the phone's bottom bar, four buttons over three tabs.
- `App.tsx` is a flex row whose panes the tab selects, replacing the one fixed
  `[340px_1fr_380px]` grid. Design is tree (300px) · canvas · properties (380px);
  Simulations is one full-width pane capped at `max-w-3xl`; Results is charts ·
  summary (380px). The sims pane's collapse handle and its `simsOpen` state are
  gone - a tab does that job now.
- `EditorPanel` splits into `design/TreePanel.tsx` and `design/PropertyPane.tsx`
  over a shared `design/useSelectedComponent.ts`.
- `ViewToggle` takes `family` and renders one; `mobileFamily` and `hasResult` are
  deleted, along with the `max-lg:hidden` per-button juggling.
- `MotorRow`'s card gained an `aria-label`, so a multi-mount design is no longer
  a run of unnamed sections to a screen reader.
- No simulation behavior changes. Verified: 910 unit tests, 95 e2e, typecheck,
  eslint, knip all clean. `e2e/base.ts` gained `openTab` / `runFlight`, since the
  panes are no longer all on screen at once.

One promise from the original draft did not survive contact: the `lg:` overrides
in `CenterView` do not all disappear. The desktop Design tab shows the stats
strip AND the drawing together while a phone shows one, so that half of the split
is inherently breakpoint-dependent. What did change is what the gates SAY - they
now read `designPane === 'stats'`, a phone pane, instead of `tab === 'build'`, a
workspace mode that no longer exists.

### Phase 2 - simulations table and sim editor - DONE
- `sim/SimulationsTable.tsx`: status dot + label, name, motor, apogee, max speed,
  max accel, rod exit, time to apogee, flight time, ground hit. Columns share
  their unit scope with the summary tiles, so apogee in feet there is apogee in
  feet here. A phone keeps status / name / apogee and drops the rest rather than
  scrolling a ten-column grid sideways.
- `sim/SimEditor.tsx`: name, a motor card per mount, launch conditions, and the
  simulation's own run options. `sim/SimulationsPane.tsx` is the toolbar (Run,
  New, Duplicate, Delete) plus the table.
- **Outdated instead of invalidated.** `Simulation.outdated`; the store's
  `invalidateResults` is now `markOutdated`, and the five edit sites that nulled
  `result` flag it instead. A finished run clears the flag. Two follow-ons fell
  out of it: `restore()` now carries live results through an undo rather than
  blanking them, and `autoRunOutdated` finally means what it says - until results
  survived an edit, the only state that setting could ever see was a MISSING
  result, never an outdated one.
- **Flight results persist, under their own IndexedDB key.** The first cut had
  `snapshotOf` strip them on the way out, on the reasoning that the load path
  discarded them anyway (`sanitizeSims`) and the autosave runs behind every
  keystroke. That reasoning was about the WRITE COST, and it answered it by
  throwing the data away - so a reload still lost every run, which is the thing
  IndexedDB exists to prevent. `lean()` in `workspaceStore` was doing the same
  thing a second time, in the library write.

  The split now happens one level down. `astrarrocketjs:designs:<id>` keeps the
  inputs and is rewritten on every keystroke's debounce; a new
  `astrarrocketjs:designs:<id>:results` holds the flights and is written only
  when a run has actually changed one - `LibraryWorkspaceStore` compares result
  OBJECT IDENTITY against what it last wrote, which is free because a result is
  replaced wholesale by a run and never mutated. `load()` re-attaches them, and
  deleting a design removes them.

  The unload journal still goes out lean: it writes to localStorage, whose
  whole-origin budget is ~5 MB, and per-timestep arrays have no business there.
  The async save following a run lands within the debounce, so the journal loses
  nothing that matters.
- The Results tab now tracks whether ANY sim has a result, not the active one, so
  selecting a never-run simulation does not take the tab away; that row shows the
  "run one" prompt instead. With nothing left to vanish, `CenterView`'s walk-back
  effect is deleted.
- `SimulationsPanel`, `SimulationsList` (the accordion) and `SimPanel` are gone,
  along with the `sims.hide` / `sims.show` strings.
- Verified: 918 unit tests, 98 e2e (new `e2e/simulations-tab.spec.ts`),
  typecheck, eslint, knip all clean.

Two notes on what this actually did:

**`components/common/useMediaQuery.ts` is new, and is the only JS-driven
breakpoint in the app.** The sim editor is the tab's right column at lg+ and
inline under the table below that. Rendering it twice and hiding one copy - the
usual trick, and what the first cut did - puts two elements with the same
`aria-label` in the document, so "the Ignition select" resolves to two matches
and a phone's accessibility tree carries a desktop column nobody can reach.
`display:none` hides pixels, not identity. Everything else stays `lg:` classes.

**Row checkboxes ARE here; "Run all outdated" is not.** These were deferred to
Phase 3 on the reasoning that batching against a single serial worker only
queues - true, but queueing is correct behavior, just slower, and the selection
UI is what makes the tab worth having. So the table has a tick column with a
select-all header, `selectedSimIds` on the store, and `runSims(ids)` which walks
them in order. The Run button reads `selectRunIds` - the ticked rows, or the
active simulation when nothing is ticked - and its label counts them ("Run 2
simulations"), because "Run flight simulation" over a batch of six was a lie
about what the click would do. A batch does not navigate to Results; a single run
still does. Phase 3's pool changes only how fast the loop drains.

Ticking and selecting are deliberately different questions: the tick says "fly
this", clicking the name says "edit this", and ticking a row does not drag the
editor onto it.

The Run button sits at the TOP OF THE RIGHT COLUMN, above the simulation it
flies, and falls back to the pane toolbar on a phone, which has no right column.

One trap worth naming: `selectRunIds` builds a fresh array per call, so
`useWorkspaceStore(selectRunIds)` re-rendered forever - zustand compares by
reference. Components subscribe to `selectedSimIds` and the active id and derive
the list. The selector's doc comment says so.

**Per-simulation options do not round-trip through `.ork`.** They persist in the
workspace autosave, which is where every other per-sim input already lives, but
`orkFile.ts` has never read or written simulation options in either direction -
so a design exported and re-imported comes back on the global values.

### Delivered alongside Phase 2 - OpenRocket simulation-option parity

Not part of the original phasing; found by diffing our bridge against OpenRocket's
own `SimulationOptions` / `SimulationConditions` once the sim editor existed.

- **Random seed "auto" was not random.** `simConditions` left the key out when no
  seed was pinned, and an omitted key is not an absent seed: the bridge reads
  `JsonLite.dbl(o, "randomSeed", 42)`, so every run used the constant 42 and a
  turbulent-wind flight came back bit-identical run to run. It now mints a fresh
  signed 32-bit seed, which is what `randomSeedFixed = false` means upstream.
- **The motor loadout moved onto each simulation.** `Simulation.extraMotors`
  replaces the one workspace-level map, so a multi-mount or staged rocket can be
  flown two ways at once - "C6 sustainer vs. D12 sustainer" is two rows in the
  table. Seating a motor now ages only that simulation. A workspace written
  before the move carries the shared map, and `hydrate` folds it into every
  simulation, which is exactly what it meant. Tree edits reconcile EVERY
  loadout (`reconcileAll`), because the mounts belong to the shared design even
  though the motors in them do not. `duplicateSim` gained the loadout and the
  per-sim options, which it had been silently dropping.
- **The recovery-deployment thresholds reach the kernel.** `deploymentSpeedWarn`
  used to be a tile color and nothing else - the engine warned on its own
  hard-coded 20 m/s. It now maps to `recoverySpeedWarning`, joined by
  `mainHighSpeedWarn` / `mainLowSpeedWarn` for dual-deployment stages
  (OpenRocket's 100 ft/s and 50 ft/s defaults). Needed a Java change plus a TeaVM
  rebuild of both backends.

  All three sit in BOTH places, which is the model the per-simulation options
  already established: a global default under Settings › Simulation, and a
  per-simulation override in the sim editor whose placeholder shows the global it
  would otherwise follow. They were global-only at first, on the reasoning that a
  club safety limit is set once; that was the wrong call for a field OpenRocket
  carries per simulation, and it left them nowhere near where anyone comparing
  two recovery setups would look.
- **Design warnings did not exist, at either end.** `StaticInfo.warningTexts`
  was read by nothing, exactly like the flight warnings - but the deeper problem
  was that it was always EMPTY. The geometry checks (diameter discontinuity, open
  airframe, zero-volume body) live in `checkGeometry`, which `getStaticInfo` never
  called, so a nose cone four times the diameter of the tube behind it reported
  nothing. The bridge now calls it, and `canvas/DesignWarnings.tsx` shows the
  result beside the static stats. Verified against the engine directly: clean
  design 0 warnings, discontinuous design 1.
- **Kernel warning text is now readable.** TeaVM ships no resource bundles, so
  the kernel's own `trans.get("Warning.DISCONTINUITY")` returns the lookup KEY,
  and messages arrived as `[Warning.DISCONTINUITY]:  "Nose cone", "Body tube"`.
  `services/warningText.ts` translates the key and keeps the rest - the value and
  the component names are real content the kernel built. An unknown key degrades
  to a sentence-cased form of itself rather than vanishing.
- **Flight warnings are now displayed at all.** The claim that "the plumbing to
  surface their output already exists" was wrong: `FlightResult.warnings` crossed
  from the kernel and nothing read it, so tuning a threshold would have changed
  nothing anyone could see. `sim/FlightWarnings.tsx` renders them on the Results
  tab, and `e2e/deploy-warnings.spec.ts` drives the whole chain - setting to
  kernel to screen - by running the same flight either side of the threshold.

Remaining gaps are listed in `TODO.md`.

### Phase 3 - parallel runs - PARTLY DONE (2026-09-18)

Done:
- **Worker pool in `simClient.ts`.** Lazy spawn up to `min(hardwareConcurrency - 1, 4)`, a queue in front of the pool, one request per worker at a time, idle reap at 60s. No protocol change, exactly as this section predicted.
- **Per-worker kill.** `killWorker(slot, err)` terminates one worker and rejects only the call it was serving, so a hung sim no longer takes down the three healthy flights beside it. The slot is dropped and the queue drains onto what is left. Covered by `simClient.test.ts`.
- **The timeout starts when a call reaches a worker**, not when it is queued. Behind a full pool a request can wait several flights for its turn, and timing that wait out would punish a healthy batch for being busy.
- **`runSims` submits the whole batch at once** (`Promise.all`) instead of awaiting each row in a `for` loop, which was the actual bottleneck once the transport could fan out.
- **Per-sim status.** `runningId` and `lastRunFailed` are replaced by `simRuns: Record<string, SimRun>` - `queued`, `running`, or `failed` with the design it failed on. `simStatus()` takes the map, and the table gained a `queued` dot: with a pool, submitted and running stop being the same instant. The map is transient and deliberately not part of a persisted `Simulation`, so "running" cannot survive a reload.

Also done:
- **Cancel.** `SimCallOptions.signal` takes an `AbortSignal`: a run still queued is dropped, one already in a worker terminates that worker, and either rejects with `SimCanceledError`. `runSims` holds one controller per batch and `cancelRun()` aborts it. Canceling is not a fault, so a canceled row goes back to what it was rather than turning red, and no banner appears. The Run button becomes **Cancel run** while a batch is in flight, instead of going dead and saying "Simulating…" for up to the full 30-second timeout.
- **Run all outdated.** A toolbar button counting what it will fly (`Run outdated (n)`), deliberately independent of the tick boxes: "bring this workspace up to date" is a different question from "fly these rows". It never navigates, even when exactly one row is stale, which is why `runSims` gained a `reveal` option.
- **`BusyLock` dropped from the design path** - the component tree, the property editor and the 2D/3D canvas. An edit during a run now costs the run rather than freezing the app for it: `runSims` already discarded every answer flown against a different tree, so the lock was preventing what was already handled. With a pool a batch can be seconds long, which made the trade worse.

Still open:
- **`BusyLock` on the simulation editor.** A different hazard, and a real one: a run installs its result with `outdated: false` while editing a simulation's launch conditions sets `outdated: true`, so an edit made mid-run would be overwritten by an answer computed from the conditions it replaced, and the row would claim to be current. Closing it needs the same identity check `ranOn` does, per simulation.

### Phase 4 - results depth
- Multi-sim overlay, plot config panel.
- Ground-track view (see `TODO.md`).

## Caveats

- **Four engine instances.** At the cap the app can hold one main-thread engine plus four workers. Lazy spawn plus idle reap keeps the steady state at one or two; the peak only occurs during a batch, which is when the memory is being used for its purpose.
- **Autosave size.** Keeping outdated results means per-timestep arrays persist more often. Mitigation above.
- **Test churn.** `e2e/mobile-layout.spec.ts`, `smoke.spec.ts` and `component-editor.spec.ts` all assert against the current pane structure; the store tests assert `tab` / `view` coupling. The mobile specs should largely survive Phase 1 if the four mobile buttons keep their labels, but `component-editor.spec.ts` will need the property panel's new home.
- **Do not collapse to two tabs.** Folding Results into Simulations as a detail row puts the table and the charts in tension for center width, which is the same mistake the 380px right pane makes today. Three tabs matches the three things a user is actually doing: changing geometry, managing a matrix of runs, reading one or several of them.

## Recommendation

Build **Phase 1** first. It is self-contained, changes no simulation behavior, deletes three existing workarounds (the accordion's reason for being, the `mobileFamily` prop, and the `lg:` overrides in `CenterView`), and frees the right column that the whole idea depends on. Phases 2 and 3 are then independent: the table is worth having even without the pool, and the pool is worth having even before the table grows a batch toolbar.
