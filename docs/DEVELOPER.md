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

- **Node 24+** (npm ships with Node) - for the web app and the catalog tools.
- **Only if you rebuild the engine or refresh the parts catalog:** a **JDK** (the engine builds with Temurin **21**; CI pins 21.0.12). You don't need to install Gradle - it's bundled via the wrapper (`engine-java/gradlew`). The catalog's digest step (`sync:preset-digests`) compiles a small Java program against the OpenRocket jar. Most contributors never need this; the built engine and the catalogs are committed.

**Install** - `web/` and `website/` (the Help site, which `npm run docs:build` builds) have npm dependencies. `engine-java/` has **no** `npm install` (it uses the bundled Gradle wrapper + plain-Node scripts):

```bash
cd web
npm install
cd ../website
npm install
```

**Run the app** (from `web/`):

```bash
npm run dev          # dev server with hot reload - prints a local URL
npm run build        # typecheck (tsc) + lint + production build; must pass before a PR
npm run preview      # serve the production build locally
npm run test         # Vitest: unit tests (.test.ts) and component tests (.test.tsx)
npm run test:watch   # Vitest in watch mode while developing
npm run e2e          # Playwright end-to-end tests against a fresh production build on port 5180
                     # (run `npx playwright install chromium` once first; nothing installs the browser for you)
npm run dupes        # jscpd copy-paste check over src (see below); part of verify
npm run verify       # the pre-push gate: format, spell, typecheck, lint, knip,
                     # dupes, the production build, and the unit suite. ~100 s.
npm run verify:ci    # the same list, but the suite runs WITH coverage and fails if
                     # it drops below the minimum percentages in vitest.config.ts
                     # (lines 82, statements 81, branches 74, functions 76).
                     # Not run by CI; `npm run audit` runs its coverage half.
npm run audit        # every web check CI does not run: coverage, then the files
                     # the app saves opened in desktop OpenRocket, then every
                     # part of them read back and compared with what the app's
                     # kernel flies, then the Java helpers compiled (needs a JDK
                     # and the pinned OpenRocket; pass --jar <OpenRocket.jar> if
                     # it is not installed).
                     # ~350 s, which is why CI runs `verify` and you run this one by hand.
```

`npm run dupes` runs jscpd with `web/.jscpd.json`. It scans the TypeScript and TSX under `web/src` and fails on any repeated block of at least 45 tokens and 5 lines (the reported duplication threshold is 0%), so a copied helper, formula, parser step or option list fails the gate before the two copies can drift apart. Below that size, the repeats are JSX table and chart boilerplate. What it leaves out, and why:

- `web/tests`: fixtures and parallel test cases repeat by design, and a scan of them reports hundreds of clones.
- `src/engine/vendor` (generated) and `*.d.ts` (declarations mirror the engine's parallel signatures and hold no logic).
- Import blocks (`ignorePattern`): two files importing the same modules is not duplicated logic.

When it fails, move the shared code into one function, component, type or constant and call it from both places. When the repeat is structure that should stay separate (two charts drawing their series at different weights, say), wrap one copy in `// jscpd:ignore-start` and `// jscpd:ignore-end` (`{/* jscpd:ignore-start */}` inside JSX) with a one-line reason on the start marker.

`npm run knip` runs knip with `web/knip.json`. JSON takes no comments, so the one setting there that needs a reason is explained here: `ignoreExportsUsedInFile` is on for types and interfaces only. An exported type that its own file also uses is part of that module's signature (a component's props, a function's options or result), exported so a caller can name it rather than rebuild it with `Parameters<>` or `ReturnType<>`. Values stay strict: an exported function or constant used only in its own file is still reported.

Please **verify UI changes in a real browser**, not just that it compiles.

A few house rules that keep the codebase consistent:

- **All user-facing text goes through i18n.** Add keys to `web/src/i18n/locales/en.json` **and** every other locale file (`web/tests/i18n/locales.test.ts` fails otherwise) - never hardcode strings in components. See [Translation](../CONTRIBUTING.md#translation).
- **Never hardcode the app name, version, or the help/docs URL.** They come from `web/src/services/app/appInfo.ts` - name from i18n, version from `package.json`, and `HELP_URL` from `package.json`'s `wiki.url` (overridable at build time with `HELP_URL=…`).
- **Match the surrounding code** - its naming, comment density, and style.
- **No em dash (U+2014).** Prose takes a colon, comma, period or parentheses. `web/tests/noEmDash.test.ts` fails on the character or its HTML entity anywhere in the project's own text; its header lists what it scans.
- **Comments and test titles state the present constraint.** A comment says what holds and why; a test title says what it guards, not the bug it came from. No change history, issue or PR tags, audit finding IDs, dates or named people. `web/tests/commentsStateTheConstraint.test.ts` scans comments and `describe`/`it`/`test` titles in `web/src` (not `src/engine/vendor`), `web/tests`, `web/e2e`, `web/scripts` and `engine-java/src/api` for issue references (`#123`, `PR #12`, `issue 12`, `openrocket#123`), audit IDs (`finding 12`, an ID beside the word audit or finding), ISO dates, and history phrases such as "until now", "previously", "used to be" and "we now". String literals and Markdown are not scanned. A line that needs one of these for a present-tense reason goes in the test's `ALLOWED` list with that reason.

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

The reference catalogs - motors and components - are **build artifacts** under `web/public/data/`, regenerated by scripts in `web/scripts/` and committed. The app fetches them at runtime rather than bundling them, so a refresh can ship without rebuilding (see **Catalog publishing** below). Run them from `web/`. The sync scripts need only Node; `sync:components` and the two digest steps also need a JDK, and every step that reads OpenRocket needs the pinned release jar:

```bash
cd web
npm run sync:all                     # every step below except check:digests, in this order, stopping at the first failure
npm run sync:database                # clone or update the community parts database into web/openrocket-database (gitignored) at the pinned commit
npm run sync:motors                  # sweep thrustcurve.org → a staged motor catalog (~1,150 motors), not yet in public/data
npm run sync:motor-digests           # after sync:motors: OpenRocket's motor digests → public/data/motors.generated.json (needs a JDK and the jar)
npm run sync:materials               # OpenRocket's material database + ours → public/data/materials.generated.json (97 materials)
#   reads the extractor's own .openrocket-src, or --src <openrocket checkout>. The app's OWN materials
#   (adhesives, and corrections to upstream values that are wrong) are in scripts/data/materials.app.json,
#   hand-maintained; this merges them in but never writes to that file. Every row keeps a `kind` saying
#   which input it came from, and `extract --check` holds the upstream rows to upstream.
npm run sync:components              # the OpenRocket-Components DB plus the part files OpenRocket ships → a staged parts catalog (~5,200 parts)
#   reads OPENROCKET_PRESETS (or --src <path-to>/openrocket-database/orc) if the DB isn't at the default local path,
#   and the files under datafiles/components/internal in the OpenRocket jar: --jar <OpenRocket-24.12.jar>,
#   OPENROCKET_JAR, or an installed OpenRocket (or --internal <dir of .orc>). A part whose file does not define its
#   material takes it from the jar's built-in materials (scripts/preset-digests/MaterialDump.java, needs a JDK),
#   so the jar is needed with --internal too
npm run sync:preset-digests          # after sync:components: each part's digest and stated mass → public/data/components.generated.json (needs a JDK)
#   runs scripts/preset-digests/PresetDump.java against --jar <OpenRocket-24.12.jar> or an installed OpenRocket
npm run check:digests                # not part of sync:all: the digest coverage per type, and a failure below the floors the publish step holds the catalogs to
npm run sync:examples                # OpenRocket's example rockets → public/examples/ (16 designs, ~330 kB)
#   pulls from the commit engine-java/extract/UPSTREAM pins, and strips each file's stored flight data
#   (90% of the bytes). --src <full-openrocket-checkout> to work offline; the extractor's own sparse
#   .openrocket-src does NOT have them (it is limited to core/src/main/java).
npm run sync:contributors            # GitHub contributors → public/data/contributors.generated.json (About dialog)
#   avatars are inlined as data URIs; set GITHUB_TOKEN to avoid the 60 req/hour unauthenticated limit
```

**The pinned release.** `web/scripts/data/openrocket-release.json` names the OpenRocket release the catalogs are built against: the jar's URL and SHA-256, and the parts database commit whose `.orc` files that release ships inside its jar. The scripts and the scheduled workflow both read it. Every jar a script is given or finds installed is checked against the SHA-256, and a different one stops the run, because a digest is right only for the build it was computed with. `OPENROCKET_UNPINNED=1` lets another jar, or a built source tree passed as `--or <checkout>` to a digest step, through with a warning, for trying a build locally; a catalog made that way is not one to commit or publish. To move to a new release, change the pin file, then run `sync:database` to check out the database commit it names.

**Staging.** The motor and parts catalogs are each made in two steps, and only the digest step writes them. `sync-motors.mjs` and `sync-components.mjs` write their rows to a staging file in the system temp folder, named for the checkout so two checkouts never share one (`web/scripts/lib/catalogStaging.mjs`), not to `public/data`. `sync-motor-digests.mjs` and `sync-preset-digests.mjs` read the staged catalog, add the digests, write the finished catalog to `public/data`, refresh `manifest.json` and remove the staged file. A digest step that fails leaves `public/data` holding the last finished catalog, and running it again reads the same staged file. Run on its own, with nothing staged, a digest step reads and rewrites the catalog already in `public/data`. `sync:materials` and `sync:contributors` write their own files and refresh the manifest too.

The parts catalog takes both steps, in that order. `sync-components.mjs` reads the two sets of `.orc` files desktop's parts library reads: the community database and the files OpenRocket ships in its jar (the legacy manufacturer files, several parachute makers and `RailButton_Database.orc`). The community database has to match the copy inside the pinned jar file for file (line endings aside); a database at another commit stops the run, and `sync:database` checks out the right one. A part's material is looked up the way desktop's loader does it: in the part's own file by type and exact name, then among desktop's built-in materials (read from the pinned jar by `scripts/preset-digests/MaterialDump.java`, so a run with `--internal` needs the jar too; name compared ignoring case), and with neither the part gets density 0. A row is dropped only when an earlier one matches it in every field, and for a parachute that includes the line count, line length, packed size and materials the digest step later fills in (`scripts/lib/partRows.mjs`), because desktop keeps parts that share a part number and tells them apart by digest. Nose cone rows carry their wall and shoulder; rail buttons are a catalog type of their own.

`sync-preset-digests.mjs` then adds what only OpenRocket's loader knows, matched on type, manufacturer, part number and description (or type, manufacturer and part number when that names one part): the digest a saved `.ork` needs to keep its link to the part, and the part's stated mass. The manufacturer matches under any name desktop knows the maker by ("LOC Precision" is desktop's "LOC/Precision"), the part number is compared trimmed and then takes desktop's spelling, trailing spaces included, and parts that share all four but differ in size each take the preset of their own size. A stated mass becomes the row's `materialDensity`, the mass divided by the part's volume, and the volume is measured in the app's own engine (`scripts/lib/presetVolume.mjs`) because OpenRocket builds disagree on a preset's volume. A parachute's stated mass becomes its mass override, and a parachute row also takes the line count and length, packed size, and canopy and line materials desktop applies when the part is picked. A rail button's mass override is the button, screw and nut masses from its file, and a stated drag coefficient becomes its drag override. Both digest steps refuse to write a catalog in which a row that is in both the previous and the new catalog lost its digest, or one below the floors in `scripts/lib/digestCoverage.mjs`. A row the source dropped takes its digest with it; that is reported, not refused.

`check:digests` reads both catalogs in `public/data` and fails if either is below its floor. It prints the coverage per type, and adds it to the job summary when it runs in a workflow.

Examples are the one artifact here that is **not** published to the `data` branch: they are pinned to the engine's upstream ref, so they change with a rebuild rather than on a schedule, and they are precached so an example opens offline. Re-run `sync:examples` when bumping `extract/UPSTREAM`; `exampleLibrary.test.ts` fails if the index's ref and `UPSTREAM` disagree.

## Catalog publishing

Catalogs do not ride along with a deploy. `.github/workflows/sync-catalogs.yml` (weekly on Mondays, plus **Run workflow**) regenerates the motor and component catalogs and pushes them, with a manifest of just those two, to an orphan **`data`** branch, which jsDelivr serves. It reads the pin file (`web/scripts/data/openrocket-release.json`), checks out the parts database at the pinned commit, sets up Java, downloads the pinned release jar and checks its SHA-256, and runs `sync:motors` then `sync:motor-digests`, and `sync:components` then `sync:preset-digests`, against it, then `check:digests`, which fails the run before it publishes if either catalog has fewer digests than its floor (`scripts/lib/digestCoverage.mjs`) and puts the coverage per type in the job summary. It starts from the catalogs already on the `data` branch and never commits the copy under `web/public/data`. It publishes only `motors.generated.json` and `components.generated.json`, with a manifest that names only those two, and removes any materials or contributors file an earlier run left on the branch. After the push it asks jsDelivr to purge the two catalogs and then the manifest, so a refresh does not wait up to 12 hours for the CDN copy to expire; a failed purge is a warning, not a failure. Every action the workflow uses is pinned by commit SHA, because the job holds a write token for the branch the live app reads. The built app reads that branch via `VITE_DATA_BASE` (set in `deploy.yml`), so **a catalog refresh goes live without rebuilding or redeploying the app**.

The deployed app reads the motors and components from the `data` branch and nowhere else, so it never shows a catalog older than the published one. Its build leaves its own copy of the two out of the output and the precache (`vite.config.ts`). Offline, the service worker answers from its cached download, which `src/services/app/warmCatalogs.ts` fetches in the background on the first visit. The copy committed under `web/public/data/` is what dev, preview and the tests read; refresh it by running the scripts above and committing.

Run a sync locally only if you want the catalogs current in a dev build, or to refresh the committed copy. The parts catalog keeps its previous `generated` timestamp when the finished parts (after the digest step) are unchanged, so a run that changes nothing leaves the file and its manifest hash untouched.

Materials and the contributor list are the exception: the app reads both from its own build, never from the `data` branch (`src/services/app/remoteData.ts`), so they change with a deploy. Materials change with a commit. The Pages deploy re-runs `sync-contributors.mjs` before `npm run build`, so a newly merged contributor is credited automatically on the next deploy to `master`. That step is best-effort (`continue-on-error`) - if the GitHub API is unavailable the build falls back to the committed JSON, which is why the file stays in the repo. Run `npm run sync:contributors` locally only if you want the list current in a dev build.

## Pull requests

Open a PR from your branch to **`master`**. In the description:

1. Which issue it addresses - e.g. "Solves #123, where …".
2. The underlying cause.
3. How you fixed it.

Make sure `npm run verify` passes (the same gate list CI runs, in the same order), and that you've checked the change in the browser. Add or update tests for any logic you touch under `web/src/services` or `web/src/engine`. Keep engine `.mjs`/`.wasm` regenerations in the same PR as their Java changes.

What CI gates on the PR itself (`.github/workflows/gates.yml`):

| Job              | Runs                                                                                                      |
| ---------------- | --------------------------------------------------------------------------------------------------------- |
| `build-and-test` | `npm run verify` (the gate list and the unit suite, without coverage)                                     |
| `e2e`            | `npm run e2e:core`, the core Playwright specs (`CORE_SPECS` in `playwright.config.ts`), in one job        |

The engine checks are not CI gates. After a change under `engine-java/` or to the vendored engine, run `npm run audit` in `engine-java/` (needs a JDK): parity, a rebuild that fails if the committed engine binaries differ, the extraction check, the pinned upstream date, and the aero scorecards. It stops at the first failure and names the step.

The checks against desktop OpenRocket are not CI gates either, since they need a JDK and the pinned release jar. `npm run check:ork` in `web/` opens the `.ork` and `.rkt` files the app writes in desktop; `orkDesktopSamples.test.ts` writes them when `ORK_SAMPLES_DIR` is set (see `web/scripts/check-ork-opens.mjs`). `npm run check:fields` reads every part of those files back in desktop and compares it with what the app's kernel flies, which the samples test writes beside each file (see `web/scripts/check-desktop-fields.mjs`). Run `npm run audit`, which does all three, after changing anything either writer emits or anything the bridge builds. The catalog Java helpers under `web/scripts/` (`MotorDump.java`, `PresetDump.java`, `MaterialDump.java`) compile when a sync step runs them, by hand or in the weekly catalog workflow, and in `npm run audit` (its `helpers` step).

Every change goes through the change audit in [`docs/AUDIT_PROMPT_CHANGES.md`](./AUDIT_PROMPT_CHANGES.md) before it is called done, and every fix for an audit finding ships with a test whose expected value comes from the kernel, the Java or desktop and that fails without the fix ("Fixes" in [`docs/AUDIT_PROMPT.md`](./AUDIT_PROMPT.md)).

The full Playwright suite is not a PR gate. It runs by hand from `.github/workflows/e2e-full.yml` (**Run workflow**), sharded two ways.

A push to **any branch but `master` and `beta`** runs every `gates.yml` job (`dev.yml`), then a `verify` job that fails if any gate failed; branch protection requires `Dev / verify`. A broken test shows up on the push that broke it rather than when the PR to `master` is opened. `master` is excluded because it is reached through a PR, which `ci.yml` gates. `beta` is excluded because it carries only work already gated on `dev`, and its deploy is started by hand (`beta-deploy.yml`). `web/tests/ciTriggers.test.ts` fails if the trigger is narrowed to a list of branch names.

A pull request runs every `gates.yml` job on the merge result (`ci.yml`), then its own `verify` job, `CI / verify`: one check that stands for every gate on the merge result, and the one a pull request from a fork also gets. `web/tests/ciTriggers.test.ts` fails if either `verify` job stops running after a failed gate or stops failing with it.

The service worker checks (`npm run e2e:update`, `npm run e2e:offline-data` and `npm run e2e:offline-help`, against production builds) are the `update-flow` job in `e2e-full.yml`, run by hand with the full suite. No PR job builds the Docusaurus site; a broken MDX page, config or `sidebars.ts` fails `e2e-full.yml` and the deploy.

The axe scans (`a11y.spec.ts`, `a11y-phone.spec.ts`) are not in `CORE_SPECS`. There are about 300 of them, and on a runner's two workers they take longer than a pull request should wait. They run in the full suite.

Each `gates.yml` job restores `node_modules` from a cache keyed on the lockfile and runs `npm ci` only when the lockfile changed.

`gates.yml` is a reusable workflow. `ci.yml` calls it on a PR and `dev.yml` on a push to any other branch, so there is only one definition to maintain. Add a gate to `gates.yml` and both get it.

On merge, `deploy.yml` builds the docs and the app and publishes to Pages. It runs no gate set of its own: the PR's run of `ci.yml` tested the merge result. Its `npm run build` is `typecheck`, `lint` and `vite build`, so a type or lint error still stops the publish. A direct push to `master`, or a PR merged after `master` moved, publishes without the rest of the gates.

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

The `KNOWN` lists in the first two are empty. Finding IDs are numbered per audit run and `docs/AUDIT.md` is replaced each run, so an entry cites an ID in the current `docs/AUDIT.md` or states its reason in words. `tests/testing/kernelGeometry.ts` is the shared helper, reading the kernel's geometry through the bridge's `getComponentGeometry`.

**Prefer a `.test.ts`.** If logic is hard to reach without rendering, that is usually a sign it should move into a module of its own, as the launch-condition unit bridge did (`prefs/launchUnits.ts`).

## Maintainer tasks

Occasional, advanced tasks - you won't need them for a typical change.

### Validation & fidelity tests

Two harnesses guard the engine (both need Node 24+; run from the repo root):

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

The parity harness compiles **only** under `-Pparity`, so the shipped engine carries no test code. After any engine change run `npm run audit` in `engine-java/`, which runs the parity test along with the other engine checks.

### Re-extraction / upgrading OpenRocket

The extracted OpenRocket sources are a committed snapshot - you only touch this when adopting a newer OpenRocket. `engine-java/extract/extract.mjs` regenerates `src/java/` from an OpenRocket source tree (repo checkout, plain source tree, or an extracted `-sources.jar`) and overlays the patches in `patches/`:

```bash
cd engine-java
node extract/extract.mjs --check --src /path/to/openrocket   # verify only: report drift & missing files
node extract/extract.mjs --src /path/to/openrocket           # regenerate src/java/
# (or set OPENROCKET_SRC instead of --src)
```

`--check` writes nothing; it reports any manifest file missing upstream (version mismatch) and any extracted file that differs from `upstream (+patch)`. On a version bump, re-diff each file in `patches/` against the new upstream, then re-extract and rebuild.
