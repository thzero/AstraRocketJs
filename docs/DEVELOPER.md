# AstraRocketJs - Developer Guide

> How to build the project, run it, and submit a change. Internal documentation: it assumes a
> source checkout, so it lives in the repo rather than in the app's Help.

AstraRocketJs is a monorepo: a **web app** (`web/`) and the **OpenRocket engine** (`engine-java/`) compiled to WebAssembly + JavaScript by TeaVM. This page is how to build it, run it and submit a change.

- **[Architecture & internals](./ARCHITECTURE.md)** - how it all fits together: the extracted engine, the WASM/JS build pipeline and backend selection, threading (the simulation Web Worker), and the motor / material / component / `.ork` data flows.
- **[Contributing](../CONTRIBUTING.md)**: reporting bugs, suggesting features, translating, and the docs.
- **[Dependencies](./DEPENDENCIES.md)** - the npm version policy, and why a package is deliberately held back from its latest (read this before "fixing" anything `npm outdated` flags).

## Project layout

It's a monorepo with two halves:

- **`web/`** - the app: **Vite + React + TypeScript + Tailwind CSS**. This is where the vast majority of contributions happen (UI, 2D/3D views, `.ork` import/export, editor, simulation setup).
  Colors come from the semantic tokens in `web/src/index.css` (`bg-surface`, `text-ink-muted`, `ring-line/10`, `text-accent-300`, `text-warn-400`), never a Tailwind palette class such as `bg-slate-800`. A color set in code (an SVG `stroke`, a gradient stop, an inline style) uses `token('name')` from `web/src/components/common/colorTokens.ts`, and the name is defined on `:root` in `index.css`. The 3D views read `scene-*` tokens through `useSceneColors()` (`web/src/components/canvas/sceneColors.ts`), because three.js and a canvas need a value rather than a variable; the schematic draws with `sch-*` tokens on screen, and `PRINT_COLORS` in `services/exports/schematicExport.ts` gives each its color in a downloaded SVG. Hex colors are kept only where the color is not the interface's: part paint, the motor flame, file formats and print output. `tests/colorTokens.test.ts` enforces all three. The themes are those tokens with other values: dark is the base `:root` block, and light and daylight are `:root[data-theme='light']` and `:root[data-theme='daylight']` blocks below it, which may only set tokens the base defines (`tests/services/app/theme.test.ts`). `services/app/theme.ts` turns the setting into the `data-theme` attribute and the `theme-color` meta; an inline script in `index.html` sets the attribute before the first paint, and `main.tsx` applies it again. A new color token needs a value in the base block, and in the light blocks when the dark value does not read on white.
- **`engine-java/`** - OpenRocket's physics `core`, extracted and compiled by **TeaVM** to **WebAssembly + JavaScript**. The app loads the committed build (WASM by default, JS as a fallback) through the typed wrapper `web/src/engine/openRocketEngine.ts`.

For the full architecture - engine build pipeline, WASM/JS backend selection, threading (the sim Web Worker), and the motor/materials/`.ork` data flows - see **[Architecture & internals](./ARCHITECTURE.md)** in the repo.

## Getting started

**Requirements**

- **Node 22+** (npm ships with Node) - for the web app and the catalog tools.
- **Only if you rebuild the engine or refresh the parts catalog:** a **JDK** (Temurin **21** is known-good; the engine targets Java 17). You don't need to install Gradle - it's bundled via the wrapper (`engine-java/gradlew`). The catalog's digest step (`sync:preset-digests`) compiles a small Java program against the OpenRocket jar. Most contributors never need this; the built engine and the catalogs are committed.

**Install** - only `web/` has npm dependencies. `engine-java/` has **no** `npm install` (it uses the bundled Gradle wrapper + plain-Node scripts):

```bash
cd web
npm install
```

**Run the app** (from `web/`):

```bash
npm run dev          # dev server with hot reload - prints a local URL
npm run build        # typecheck (tsc) + lint + production build; must pass before a PR
npm run preview      # serve the production build locally
npm run test         # Vitest: unit tests (.test.ts) and component tests (.test.tsx)
npm run test:watch   # Vitest in watch mode while developing
npm run e2e          # Playwright end-to-end tests against a fresh production build on port 5180 (downloads Chromium the first time)
npm run verify       # the pre-push gate: format, spell, typecheck, lint, knip,
                     # the production build, and the unit suite. ~100 s.
npm run verify:ci    # the same list, but the suite runs WITH coverage and fails if
                     # it drops below the minimum percentages in vitest.config.ts
                     # (lines 70, statements 69, branches 62, functions 61).
                     # ~350 s, which is why CI runs this one and you run the other.
```

Please **verify UI changes in a real browser**, not just that it compiles.

A few house rules that keep the codebase consistent:

- **All user-facing text goes through i18n.** Add keys to `web/src/i18n/locales/en.json` **and** every other locale file (`web/tests/i18n/locales.test.ts` fails otherwise) - never hardcode strings in components. See [Translation](../CONTRIBUTING.md#translation).
- **Never hardcode the app name, version, or the help/docs URL.** They come from `web/src/services/app/appInfo.ts` - name from i18n, version from `package.json`, and `HELP_URL` from `package.json`'s `wiki.url` (overridable at build time with `HELP_URL=…`).
- **Match the surrounding code** - its naming, comment density, and style.

## Where a number comes from

**The engine owns the physics. The UI reports facts known before a run and facts known after a run; it does not calculate.** The kernel is what gets validated against desktop OpenRocket, so a figure the app works out for itself is a second implementation that nothing checks.

Before adding a readout, ask which side of the run it comes from. Before a run, that is the design's own values and what the kernel reports about the built rocket; after a run, it is `result.summary`, `result.events` and `result.series` sampled at an event's time with `lerpAt`. Series and events are per branch, which is the only way to be right about a separated booster.

An app-side **estimate** is allowed as a design aid, and only if the UI says it is an estimate and it is replaced by the kernel's figures once a run has them. `services/flight/recoverySizing.ts` (the estimate) against `services/flight/recoveryFlown.ts` (the reader) is the worked pair.

Full reasoning and the exceptions: [**Who owns a number**](./ARCHITECTURE.md#who-owns-a-number).

## Working on the engine

Most contributions don't touch the engine. If you do:

- **Before patching a kernel file to change flight behavior, try a `SimulationListener` first.** The bridge can add one to `SimulationConditions`, which costs no patched file, no `DIVERGENCE.txt` re-bless, and leaves the default path byte-identical because the listener is simply not attached when the feature is off. `api/GuideClearanceListener.java` is the worked example; see [**The extracted engine**](./ARCHITECTURE.md#the-extracted-engine-engine-javasrcjava) for the hooks it relies on and the two traps.
- **Don't edit the extracted OpenRocket sources under `engine-java/src/java/` directly** - they track OpenRocket's **unstable** branch. Necessary tweaks go through a documented override in `engine-java/patches/` (see also `engine-java/ATTRIBUTION.md`).
- ARJ's own engine glue - the `@JSExport` facade, the component-tree builder, overrides, etc. - lives in `engine-java/src/api/`. That's fair game.
- Changing the engine requires a **JDK** (see **Requirements** above) and rebuilding **both** targets (WASM-GC is the default backend, JS the fallback):

  ```bash
  cd engine-java
  node build-engine.mjs           # builds + vendors BOTH targets (the default)
  ```

- **Keep the Java change and _both_ regenerated artifacts (`.mjs` + `.wasm`) in the same PR**: they must stay in sync, or the app runs stale physics (and the two backends must match).

## Catalog tools

The reference catalogs - motors and components - are **build artifacts** under `web/public/data/`, regenerated by scripts in `web/scripts/` and committed. The app fetches them at runtime rather than bundling them, so a refresh can ship without rebuilding (see **Catalog publishing** below). Run them from `web/`. The sync scripts need only Node; the two digest steps also need a JDK and an OpenRocket release jar:

```bash
cd web
npm run sync:motors                  # sweep thrustcurve.org → public/data/motors.generated.json (~1,150 motors)
npm run sync:all                     # every step below, in order, stopping at the first failure
npm run sync:database                # clone or update the community parts database into web/openrocket-database (gitignored)
npm run sync:components              # the OpenRocket-Components DB plus the part files OpenRocket ships → public/data/components.generated.json (~5,200 parts)
#   reads OPENROCKET_PRESETS (or --src <path-to>/openrocket-database/orc) if the DB isn't at the default local path,
#   and the files under datafiles/components/internal in the OpenRocket jar: --jar <OpenRocket-24.12.jar>,
#   OPENROCKET_JAR, or an installed OpenRocket (or --internal <dir of .orc>)
npm run sync:preset-digests          # after sync:components: each part's digest and stated mass (needs a JDK)
#   runs scripts/preset-digests/PresetDump.java against --jar <OpenRocket-24.12.jar> or an installed OpenRocket
npm run sync:motor-digests           # after sync:motors: OpenRocket's motor digests, the same way (needs a JDK)
npm run sync:materials               # OpenRocket's material database + ours → public/data/materials.generated.json (97 materials)
#   reads the extractor's own .openrocket-src, or --src <openrocket checkout>. The app's OWN materials
#   (adhesives, and corrections to upstream values that are wrong) are in scripts/data/materials.app.json,
#   hand-maintained; this merges them in but never writes to that file. Every row keeps a `kind` saying
#   which input it came from, and `extract --check` holds the upstream rows to upstream.
npm run sync:examples                # OpenRocket's example rockets → public/examples/ (16 designs, ~330 kB)
#   pulls from the commit engine-java/extract/UPSTREAM pins, and strips each file's stored flight data
#   (90% of the bytes). --src <full-openrocket-checkout> to work offline; the extractor's own sparse
#   .openrocket-src does NOT have them (it is limited to core/src/main/java).
npm run sync:contributors            # GitHub contributors → public/data/contributors.generated.json (About dialog)
#   avatars are inlined as data URIs; set GITHUB_TOKEN to avoid the 60 req/hour unauthenticated limit
```

The parts catalog takes both steps, in that order. `sync-components.mjs` reads the two sets of `.orc` files desktop's parts library reads: the community database and the files OpenRocket ships in its jar (the legacy manufacturer files, several parachute makers and `RailButton_Database.orc`). A part's material is looked up in its own file first, then across all files. Only rows identical in every field are dropped, because desktop keeps parts that share a part number and tells them apart by digest. Nose cone rows carry their wall and shoulder; rail buttons are a catalog type of their own.

`sync-preset-digests.mjs` then adds what only OpenRocket's loader knows, matched on type, manufacturer, part number and description (or type, manufacturer and part number when that names one part): the digest a saved `.ork` needs to keep its link to the part, and the part's stated mass. A stated mass becomes the row's `materialDensity`, the mass divided by the part's volume, and the volume is measured in the app's own engine (`scripts/lib/presetVolume.mjs`) because OpenRocket builds disagree on a preset's volume. A parachute's stated mass becomes its mass override. A rail button's mass override is the button, screw and nut masses from its file, and a stated drag coefficient becomes its drag override. Both steps refresh `manifest.json`. Run the digest step against the 24.12 release jar, the one the scheduled workflow pins: a digest depends on the OpenRocket build, and one from another build is rejected by the desktop.

Examples are the one artifact here that is **not** published to the `data` branch: they are pinned to the engine's upstream ref, so they change with a rebuild rather than on a schedule, and they are precached so an example opens offline. Re-run `sync:examples` when bumping `extract/UPSTREAM`; `exampleLibrary.test.ts` fails if the index's ref and `UPSTREAM` disagree.

## Catalog publishing

Catalogs do not ride along with a deploy. `.github/workflows/sync-catalogs.yml` (weekly on Mondays, plus **Run workflow**) regenerates the motor and component catalogs and pushes `public/data` to an orphan **`data`** branch, which jsDelivr serves. It sets up Java, downloads the OpenRocket 24.12 release jar pinned by SHA-256, and runs `sync:motors` then `sync:motor-digests`, and `sync:components` then `sync:preset-digests`, against it. It starts from the catalogs already on the `data` branch and never touches the copy committed under `web/public/data`. The built app reads that branch via `VITE_DATA_BASE` (set in `deploy.yml`), so **a catalog refresh goes live without rebuilding or redeploying the app**.

The copy committed under `web/public/data/` stays in the build as a fallback, used whenever the CDN is unreachable or before the `data` branch exists - so the app always works, at worst with catalogs frozen at the last deploy. Refresh that floor by running the scripts above and committing.

Run a sync locally only if you want the catalogs current in a dev build, or to move that floor up. The parts catalog keeps its previous `generated` timestamp when the finished parts (after the digest step) are unchanged, so a run that changes nothing leaves the file and its manifest hash untouched.

The contributor list is the exception: the Pages deploy re-runs `sync-contributors.mjs` before `npm run build`, so a newly merged contributor is credited automatically on the next deploy to `master`. That step is best-effort (`continue-on-error`) - if the GitHub API is unavailable the build falls back to the committed JSON, which is why the file stays in the repo. Run `npm run sync:contributors` locally only if you want the list current in a dev build.

## Pull requests

Open a PR from your branch to **`master`**. In the description:

1. Which issue it addresses - e.g. "Solves #123, where …".
2. The underlying cause.
3. How you fixed it.

Make sure `npm run verify` passes (the same gate list CI runs, in the same order; CI adds coverage via `verify:ci`), and that you've checked the change in the browser. Add or update tests for any logic you touch under `web/src/services` or `web/src/engine`. Keep engine `.mjs`/`.wasm` regenerations in the same PR as their Java changes.

What CI gates on the PR itself (`.github/workflows/gates.yml`):

| Job              | Runs                                                                                                      | Needs                      |
| ---------------- | --------------------------------------------------------------------------------------------------------- | -------------------------- |
| `golden-report`  | Lists the golden values the PR moved in the job summary (informational, never fails; PRs only)            | none                       |
| `parity`         | `npm run parity -- --expect-lines 359`, then a rebuild compared against the committed binaries            | none                       |
| `reproducible`   | `npm run extract:check` against the pinned OpenRocket, and the pinned date matches the pinned commit      | none                       |
| `validate`       | `validation/score.mjs --check-floors` on the classic model and on the opt-in supersonic path              | none                       |
| `build-and-test` | `npm run verify:ci` (the `verify` list, with coverage)                                                    | `reproducible`, `validate` |
| `e2e`            | `npm run e2e:core`, the core Playwright specs (`CORE_SPECS` in `playwright.config.ts`), in one job        | `reproducible`             |
| `update-flow`    | `npm run e2e:update`, `npm run e2e:offline-data` and `npm run e2e:offline-help` against production builds | `reproducible`             |

The full Playwright suite is not a PR gate. It runs by hand from `.github/workflows/e2e-full.yml` (**Run workflow**), sharded two ways.

A push to **any branch but `master`** runs only the web gates (`dev.yml`, about six minutes: `verify:ci`, so the coverage minimums are checked on the push), so a broken test shows up on the push that broke it rather than when the PR to `master` is opened. `master` is excluded because `deploy.yml` already runs the full set there. `web/tests/ciTriggers.test.ts` fails if the trigger is narrowed to a list of branch names.

The Docusaurus site is typechecked only in `deploy.yml`, on merge to `master`. On a PR, `update-flow` builds it (`npm run docs:build`) for the offline Help check, so a broken MDX page or `sidebars.ts` fails that job; a docs type error shows up as a failed deploy.

`gates.yml` is a reusable workflow. `ci.yml` calls it on a PR and `deploy.yml` calls the same file on merge to `master`, so master is held to exactly what a PR was held to and there is only one definition to maintain. Add a gate to `gates.yml` and both get it.

On merge, `deploy.yml` runs those gates and only then typechecks and builds the docs, builds the app and publishes to Pages. Nothing publishes unless every gate is green.

## Which kind of test

|                                                         | For                                                                                          | Example                               |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------- |
| **`.test.ts`** (Vitest, node)                           | Pure logic: parsers, transforms, conversions, stores. Most tests are these.                  | `prefs/units.test.ts`                 |
| **`.kernel.test.ts`** (Vitest, node, the real engine)   | App-side copies of kernel math checked against the vendored engine. Part of `npm run test`.  | `services/design/geometryParity.kernel.test.ts` |
| **`.test.tsx`** (Vitest + React Testing Library, jsdom) | A rule that lives in a component and has no service to test instead.                         | `components/common/UnitChip.test.tsx` |
| **`e2e/*.spec.ts`** (Playwright)                        | Whole journeys, and anything needing the real engine, layout or persistence across a reload. | `e2e/units.spec.ts`                   |

Component tests render through `web/tests/testing/renderWithProviders.tsx`, which wraps the component in the app's providers and initializes real translations, so assertions read the strings a user actually sees, and a renamed i18n key fails a test instead of showing a raw key on screen. Seed preferences with `seedSettings({ … })` before rendering and read back what a component wrote with `readSettings()`.

**A test of ported math takes its expected value from the kernel or the Java, never from an app constant.** The app resolves automatic radii, profiles and bores itself so it can draw and export without a kernel call, and each of those is a copy of a Java rule. Three tests guard the copies:

- `services/design/geometryParity.kernel.test.ts` builds 200 generated designs in the kernel and compares every automatic radius, bore, profile and fin tab limit the app resolves.
- `tree/geometryFlags.test.ts` toggles every shape flag (flipped, filled, clipped) under every reader (station radius, schematic, report side view, PDF template, printable solid, 3D view). Each pair has to react, or it is listed in `UNAFFECTED` with the reason the reader cannot see the flag.
- `services/parts/catalogPatch.kernel.test.ts` ("a stated catalog mass") builds every catalog row that states a mass and requires it to fly within 0.5% of that mass.

The `KNOWN` lists in the first two are empty; a pair that goes in one names its finding. `tests/testing/kernelGeometry.ts` is the shared helper, reading the kernel's geometry through the bridge's `getComponentGeometry`.

**Prefer a `.test.ts`.** If logic is hard to reach without rendering, that is usually a sign it should move into a module of its own, as the launch-condition unit bridge did (`prefs/launchUnits.ts`).

## Maintainer tasks

Occasional, advanced tasks - you won't need them for a typical change.

### Validation & fidelity tests

Two harnesses guard the engine (both need Node 22+; run from the repo root):

```bash
# 1. Parity test - proves BOTH browser engines (TeaVM WASM-GC and JS) return numbers
#    identical to the reference JVM. Builds a parity engine variant (-Pparity), runs the
#    same scenarios on each, and diffs them line-by-line. Both targets by default;
#    --js / --wasm narrow it to one.
node engine-java/test/parity/parity.mjs

# 2. Aero validation - scores the engine against wind-tunnel anchors (ARCAS /
#    Basic Finner / HB-2).
node engine-java/validation/score.mjs               # classic Extended Barrowman
node engine-java/validation/score.mjs --supersonic  # with the supersonic-aero model on
node engine-java/validation/score.mjs --strict      # exit 1 on any gate-point failure
```

From inside `engine-java/` these have shorter names: `npm run parity`, `npm run validate`, `npm run build`. Same scripts, no dependencies to install - see `engine-java/README.md`.

The parity harness compiles **only** under `-Pparity`, so the shipped engine carries no test code. Run the parity test after any engine change.

### Re-extraction / upgrading OpenRocket

The extracted OpenRocket sources are a committed snapshot - you only touch this when adopting a newer OpenRocket. `engine-java/extract/extract.mjs` regenerates `src/java/` from an OpenRocket source tree (repo checkout, plain source tree, or an extracted `-sources.jar`) and overlays the patches in `patches/`:

```bash
cd engine-java
node extract/extract.mjs --check --src /path/to/openrocket   # verify only: report drift & missing files
node extract/extract.mjs --src /path/to/openrocket           # regenerate src/java/
# (or set OPENROCKET_SRC instead of --src)
```

`--check` writes nothing; it reports any manifest file missing upstream (version mismatch) and any extracted file that differs from `upstream (+patch)`. On a version bump, re-diff each file in `patches/` against the new upstream, then re-extract and rebuild.
