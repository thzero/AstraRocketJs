# Flight configurations: proposal

> Status: DONE. All seven phases landed. What survives of this document now lives in
> [Architecture & internals](./ARCHITECTURE.md#flight-configurations) and in the
> [Flight Configurations](../website/docs/flight-configurations.md) page, which are the ones
> kept current; this file is the record of how the work was planned and can go. Written
> 2026-09-28 against `dev`.
>
> Bring OpenRocket's flight-configuration panel into the app and have the simulations fly it:
> named motor setups (plus recovery, stage separation and stage activeness) that a simulation
> points at, instead of a motor loadout inlined into every simulation row.
>
> This is a planning document. Once the work lands, what survives of it belongs in
> [Architecture & internals](./ARCHITECTURE.md) and the [website docs](../website/docs/), and
> this file goes away.

## Why

The app can read and write a `.ork` that carries several flight configurations, but it cannot author or switch between them: it opens one and flies that. `website/docs/comparison-openrocket.md` already lists this as a gap against the desktop, and it is the last structural difference in how a design is *set up to fly* rather than in how it is drawn.

The motor loadout is also the only part of a simulation that has no name. Everything else a run depends on (the design, the launch site, the wind profile) is a named thing several runs can point at. The motors are copied into each row, so "the same rocket on a C6 and on a D12" is expressed by duplicating a row rather than by choosing a setup.

## Where we stand today

- **The `.ork` layer already models configurations fully.** `OrkFlightConfig {id, name, isDefault, motors, deployments}` is read on import (`web/src/services/files/ork/importConfigs.ts`), and export deliberately *replays* the configurations that were not opened so a save cannot destroy them (`web/src/services/files/ork/exportMotorConfigs.ts`). That replay is scaffolding standing in for a model that was never built.
- **The app model is one loadout per simulation.** `Simulation` carries `motor` (the primary mount), `extraMotors` (every other mount, keyed by mount id) and per-mount ignition overrides (`web/src/services/flight/simulations.ts`). The comment there says plainly that this *is* OpenRocket's flight configuration, inlined into the row.
- **Recovery and stage separation are not configuration-scoped at all.** `deployEvent` / `deployAltitude` / `deployDelay` and `separationEvent` / `separationDelay` are tree-node properties: one value, shared by every simulation.
- **Stage activeness does not exist.** The importer raises a load note when the chosen configuration deactivates a stage, because the app flies every stage regardless.
- **The kernel needs almost nothing.** `setMotor` seats a motor into the single `FlightConfigurationId` held per rocket handle (`engine-java/src/api/java/api/OpenRocketEngine.java`), so every build already *is* exactly one configuration. N configurations is N builds of a rocket we already know how to build.

## Decisions taken

1. **Full parity in one pass.** All three sub-tabs (Motors, Recovery, Stage separation) and stage activeness. Nothing ships as a control that does not drive the simulation.
2. **The panel is the only place motors are edited.** The simulation editor keeps the name, the launch conditions and the preference overrides, and gains a configuration picker plus a read-only loadout summary. No copy-on-write rule to reason about, and no second surface that can disagree with the first.
3. **Its own top-level tab.** Not a section of the Simulations tab, and not a dialog.

## The model

New `web/src/services/flight/flightConfigs.ts`:

```ts
export interface FlightConfig {
  id: string;                                   // the .ork configid when imported, so a round trip is identity
  name: string | null;                          // null = unnamed, labeled by its motor list (what the desktop does)
  motors: Record<string, MountMotor>;           // EVERY mount, keyed by mount id
  deployments: Record<string, DeployOverride>;  // recovery device id -> event / altitude / delay
  separations: Record<string, SepOverride>;     // stage id -> event / delay
  activeStages?: Record<string, boolean>;       // stage id -> flies; absent means true
}
```

`Workspace` gains `configs: FlightConfig[]` at `version: 2`. `Simulation` gains `configId: string` and loses `motor`, `extraMotors`, `ignitionEvent` and `ignitionDelay`. The launch conditions, the result, `outdated` and `prefs` stay on the row: those are properties of a flight, not of a motor setup.

Two things fall out of it:

- **The primary-mount asymmetry dies.** `motor` versus `extraMotors` is why `mountMotors.activeExtraMounts` exists, why `buildConfiguredRocket` and `store.selectMotorDims` each carry the same "skip the primary or a vanished mount" filter, and why `hydrate` still folds a pre-per-simulation shared map. One uniform map keyed by mount id removes all of it.
- **The `.ork` mint-and-replay path dies.** `resolveWriteConfigs` stops inventing a configuration to carry the working set, and import stops collapsing to one: a file with three configurations opens as three configurations, which is what the file means.

**Migration** (`version: 1` to `2`): mint a configuration from each simulation's loadout, deduped by a loadout signature (mount id, designation, delay, ignition event and delay), left unnamed so the panel labels it by its motor list. Designs in the library each hold a `Workspace`, so they go through the same fold when they are opened.

## The panel

A fourth top-level tab, `'configs'`, added to `Tab` in `state/tabs.ts`, to `WorkbenchTabs.tsx` (the desktop strip inside the header) and to `TabBar.tsx` (the phone bottom bar, going to five buttons). Unlike Results it is offered unconditionally: it is the only place motors are edited, so it can never be conditional.

`components/config/ConfigsPane.tsx`, with three sub-tabs. Rows are configurations; columns are mounts, recovery devices and stages respectively. Toolbar: New, Copy, Rename, Delete, matching the desktop. `MotorRow`, `MotorDialog` and the motor-dashboard entry point move here out of `SimEditor`. Stage activeness is a checkbox per stage column on the Motors sub-tab, where the desktop puts it.

Below `md` the grid becomes one card per configuration. That is a requirement rather than a nicety: with motors editable in one place only, a phone that cannot use this tab cannot change a motor at all.

`SimulationsTable` gains a Configuration column with an inline picker, so pointing a row at a setup stays one click and does not require crossing tabs.

**Two layout constraints to measure, not assume:**

- The desktop tab strip lives *inside the header*, which already fits one row at lg on a 992px budget at 1024 in pt-PT with the save status showing. A fourth label eats into that. First mitigation is a short label; if it still overflows, the badges move from `xl` to one breakpoint earlier. The header one-row test is the gate.
- Five bottom-bar buttons at 320px in the longest locale. If a label will not fit, the icon carries it and the label truncates, the way the other four already scale.

## Engine work

One `@JSExport` on our own facade over `FlightConfiguration.setStageActive`, which is present in the extracted kernel (`engine-java/src/java/info/openrocket/core/rocketcomponent/FlightConfiguration.java`), plus the wrapper method in `web/src/engine/openRocketEngine.ts`. `api/` is our code rather than a patched kernel file, so this needs no `patches/` mirror and no `DIVERGENCE.txt` re-bless.

Nothing else. Per-configuration recovery and separation are applied by patching the node properties in the tree the builder receives, because those values are already node inputs the component factory reads.

## Phases

Each phase is shippable on its own.

1. **Model, migration, and one loadout selector.** DONE. No UI change. `services/flight/flightConfigs.ts` holds `FlightConfig`, `MountMotor` and the reconcile/lookup helpers; `services/storage/workspaceMigrate.ts` lifts a stored `version: 1` workspace; `buildConfiguredRocket`, `computeStaticInfo`, `buildExportMotorMap`, `unflyable`, `simInputs`, the sim-worker payload and `wireLoadedOrk` all take a configuration. `services/mountMotors.ts` is gone, `api.buildRocketTree` no longer seats a motor, and `reportModel.stageMotor` went with the primary-mount special case it existed to correct. A motor edit from the simulation editor forks a shared configuration, so per-row editing behaves exactly as it did.
2. **The tab and the Motors sub-tab.** DONE. `components/config/` holds the pane, the table (rows are configurations, columns are mounts) and the editor; the store gained `selectedConfigId`, add/copy/rename/delete and `setSimConfig`, and `setMountMotor` now names the configuration it writes to. `SimEditor` picks a configuration and links to the tab instead of carrying motor cards, and the simulations table swapped its Motor column for a Configuration picker. The desktop tab strip went to `px-3` so four labels fit the header in one row at 1024.
3. **`.ork` in both directions from real state.** DONE. `loadOrk` resolves EVERY configuration the file declares (one lookup per distinct motor) and hands back `configs` plus the file's default; `wireLoadedOrk` turns each into a flight configuration keeping the file's `configid`, with a simulation per configuration named after it. The export takes the configurations as they stand, so `resolveWriteConfigs` no longer mints a configuration to carry a working set or replays the ones that were not opened, and `OrkTreeExportInput` lost its `motors` / `motor` / `mountId` inputs. A configuration carries the deployment overrides a file gave it (`FlightConfig.deployments`), unedited, so a save cannot flatten another setup's recovery settings before phase 4 gives them a UI.
4. **The Recovery sub-tab.** DONE. The tab gained a Motors / Recovery switch (`ConfigsTab` in the store, so the table and the editor beside it follow one value), and the table's columns are built per sub-tab by `configColumns.tsx`. A configuration overrides deployment per FIELD, the way a simulation overrides a run preference: empty follows the design, and the design's value is the placeholder. `applyDeployments` puts those values into the tree the builder receives, so the flight recovers the way the configuration says on the main thread and in the worker alike. The property panel names every configuration that opens a device differently, and the name is a button that opens the tab on it.
5. **The Stage separation sub-tab.** DONE. A third sub-tab over `findSeparators` (every booster stage and every parallel booster; the top stage has nothing above it to let go of), with the same per-field override shape recovery has. `configuredTree` applies recovery and staging in one pass before the build. The `.ork` writer gives each configuration its own `<separationconfiguration>` values instead of repeating the design's for all of them, and the reader captures every configuration's block, so staging round-trips the way deployment does.
6. **Stage activeness.** DONE. One `@JSExport` on the facade, `setStageActiveById`, addressed by node id rather than by the kernel's stage NUMBER (numbers are handed out in the order stages are added, so a parallel booster shifts the ones after it). The engine was rebuilt and both artifacts re-vendored; JS/WASM parity and the golden reference values are unchanged. A configuration carries the stages it grounds, the Staging sub-tab shows every stage with a flies checkbox, `.ork` writes and reads the real `<stage active>` flags, and the import note that said activeness was not applied is gone.
7. **Docs and CHANGELOG.** DONE. A **Flight Configurations** page in the user guide with its Spanish twin, the motors and simulations pages rewritten around it in both languages, the comparison row moved from "what the desktop has and this does not" to "what this has", a **Flight configurations** section in `docs/ARCHITECTURE.md`, and the CHANGELOG entry. About 50 i18n keys landed across all ten locales over phases 2 to 6.

The run gate moves with the model: `unflyable`'s `noMotor` reason names the configuration rather than the row, because one bad configuration can ground several rows at once and the Run button should say which.

## Costs and risks

- **About 30 new i18n keys across all ten locales**, held by `web/tests/i18n/keys.test.ts`.
- **The workspace migration is one way.** A workspace written by the new build will not open on an older one.
- **A value visible in two places that can disagree.** The design pane's recovery fields become the *default* set, which a configuration may override. Without the marker in the property panel, the design pane would show a deployment altitude the flight did not use. This is the one genuinely new piece of UX, and the reason phase 4 carries the marker rather than deferring it.
- **Test surface:** the store tests, the `.ork` round-trip tests, the header one-row test, and the e2e specs that drive the sim table and the motor cards.
- **The phone is load-bearing here.** Motors editable in one place only means the cards below `md` are not a fallback, they are the interface.

## Alternative considered and rejected

Keep the loadout on each simulation and add configurations as *named saved loadouts* applied to a row, the way saved parts and saved locations work. Perhaps a fifth of the work, no shared state to reason about, and an additive store with no migration.

Rejected because it is not the desktop's model: it does not fix the `.ork` round trip, and it leaves recovery and stage separation stuck as single global values, which is half of what the panel is for.
