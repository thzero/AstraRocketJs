---
title: "Contributing"
sidebar_position: 14
---

Hi, and thanks for your interest in AstraRocketJs! 😊 Whether you want to write code, hunt bugs, translate, or help in any other way, this guide will get you started.

AstraRocketJs is a **lightweight web UI over the real OpenRocket engine** — the physics is OpenRocket's, compiled to WebAssembly + JavaScript; the app around it is ours. Most contributions live in the web app. (To save keystrokes, we'll abbreviate the project as **ARJ**.)

By participating you agree to our **[Code of Conduct](https://github.com/thzero/AstraRocketJs/blob/HEAD/CODE_OF_CONDUCT.md)** — be kind and constructive.

#### Contents

- [Testing](#testing) — [Reporting bugs](#reporting-bugs) · [Suggesting features](#suggesting-new-features)
- [Development](#development) — [Project layout](#project-layout) · [Getting started](#getting-started) · [Working on the engine](#working-on-the-engine) · [Catalog tools](#catalog-tools) · [Commit etiquette](#commit-etiquette) · [Pull requests](#pull-requests)
- [Maintainer tasks](#maintainer-tasks)
- [Translation](#translation)
- [Documentation](#documentation)

## Testing

ARJ isn't perfect — we need people to find and clearly document the rough edges. Testers discover bugs, propose features, and try out changes. 📝

### Reporting bugs

Open a GitHub issue with a short, specific title (prefix it with **[Bug]**). Please include:

- What you **expected** to happen, and what happened **instead**.
- The **steps** to reproduce it.
- Your **browser + OS** (e.g. "Chrome 120 on Windows 11") and the **ARJ version** (next to the title in the header, or under **Menu → About**).
- If it's tied to a specific design, attach the **`.ork` file** — usually the fastest path to a fix.

A screenshot or screen recording helps a lot.

### Suggesting new features

Open an issue prefixed with **[Feature Request]**. Explain the behavior you'd like and why it matters. Keep in mind ARJ is intentionally a _focused_ interface, not a full re-creation of OpenRocket's desktop app — features that fit that scope are the easiest sell.

## Development

If you'd like to take an issue, **comment on it first** ("I'd like to work on this") so two people don't duplicate effort.

### Project layout

It's a monorepo with two halves:

- **`web/`** — the app: **Vite + React + TypeScript + Tailwind CSS**. This is where the vast majority of contributions happen (UI, 2D/3D views, `.ork` import/export, editor, simulation setup).
- **`engine-java/`** — OpenRocket's physics `core`, extracted and compiled by **TeaVM** to **WebAssembly + JavaScript**. The app loads the committed build (WASM by default, JS as a fallback) through the typed wrapper `web/src/engine/openRocketEngine.ts`.

For the full architecture — engine build pipeline, WASM/JS backend selection, threading (the sim Web Worker), and the motor/materials/`.ork` data flows — see the **[Architecture & internals](./architecture.md)** page (or the [Developer Guide](./developer-guide.md) for the short version).

### Getting started

**Requirements**

- **Node 22+** (npm ships with Node) — for the web app and the catalog tools.
- **Only if you rebuild the engine:** a **JDK** (Temurin **21** is known-good; the engine targets Java 17). You don't need to install Gradle — it's bundled via the wrapper (`engine-java/gradlew`). Most contributors never need this; the built engine is committed.

**Install** — only `web/` has npm dependencies. `engine-java/` has **no** `npm install` (it uses the bundled Gradle wrapper + plain-Node scripts):

```bash
cd web
npm install
```

**Run the app** (from `web/`):

```bash
npm run dev          # dev server with hot reload — prints a local URL
npm run build        # typecheck (tsc) + production build — must pass before a PR
npm run preview      # serve the production build locally
npm run test         # Vitest: unit tests (.test.ts) and component tests (.test.tsx)
npm run test:watch   # Vitest in watch mode while developing
npm run e2e          # Playwright end-to-end smoke tests (downloads Chromium the first time)
npm run verify       # every gate CI runs on the web app: format, spell, typecheck, lint, knip, test
```

Please **verify UI changes in a real browser**, not just that it compiles.

A few house rules that keep the codebase consistent:

- **All user-facing text goes through i18n.** Add keys to `web/src/i18n/locales/en.json` **and** `es.json` — never hardcode strings in components. See [Translation](#translation).
- **Never hardcode the app name, version, or the help/docs URL.** They come from `web/src/services/appInfo.ts` — name from i18n, version from `package.json`, and `HELP_URL` from `package.json`'s `wiki.url` (overridable at build time with `HELP_URL=…`).
- **Match the surrounding code** — its naming, comment density, and style.

### Working on the engine

Most contributions don't touch the engine. If you do:

- **Don't edit the extracted OpenRocket sources under `engine-java/src/java/` directly** — they're near-verbatim OpenRocket core (a post-24.12 development build). Necessary tweaks go through a documented override in `engine-java/patches/` (see also `engine-java/ATTRIBUTION.md`).
- ARJ's own engine glue — the `@JSExport` facade, the component-tree builder, overrides, etc. — lives in `engine-java/src/api/`. That's fair game.
- Changing the engine requires a **JDK** (see **Requirements** above) and rebuilding **both** targets (WASM-GC is the default backend, JS the fallback):

  ```bash
  cd engine-java
  node build-engine.mjs           # builds + vendors BOTH targets (the default)
  ```

- **Commit the Java change and _both_ regenerated artifacts (`.mjs` + `.wasm`) together** — they must stay in sync, or the app runs stale physics (and the two backends must match).

### Catalog tools

The reference catalogs — motors and components — are **build artifacts** under `web/public/data/`, regenerated by scripts in `web/scripts/` and committed. The app fetches them at runtime rather than bundling them, so a refresh can ship without rebuilding (see **Catalog publishing** below). Run them from `web/` (they need only Node):

```bash
cd web
npm run sync:motors                  # sweep thrustcurve.org → public/data/motors.generated.json (~800 motors)
npm run sync:components              # parse the OpenRocket-Components DB → public/data/components.generated.json (~2,900 parts)
#   sync:components reads OPENROCKET_PRESETS (or --src <path-to>/openrocket-database/orc) if the DB isn't at the default local path
npm run sync:materials               # OpenRocket's material database + ours → public/data/materials.generated.json (97 materials)
#   reads the extractor's own .openrocket-src, or --src <openrocket checkout>. The app's OWN materials
#   (adhesives, and corrections to upstream values that are wrong) are in scripts/data/materials.app.json,
#   hand-maintained; this merges them in but never writes to that file. Every row keeps a `kind` saying
#   which input it came from, and `extract --check` holds the upstream rows to upstream.
npm run sync:examples                # OpenRocket's example rockets → public/examples/ (16 designs, ~330 kB)
#   pulls from the commit engine-java/extract/UPSTREAM pins, and strips each file's stored flight data
#   (96% of the bytes). --src <full-openrocket-checkout> to work offline; the extractor's own sparse
#   .openrocket-src does NOT have them (it is limited to core/src/main/java).
npm run sync:contributors            # GitHub contributors → public/data/contributors.generated.json (About dialog)
#   avatars are inlined as data URIs; set GITHUB_TOKEN to avoid the 60 req/hour unauthenticated limit
```

Examples are the one artifact here that is **not** published to the `data` branch: they are pinned to the engine's upstream ref, so they change with a rebuild rather than on a schedule, and they are precached so an example opens offline. Re-run `sync:examples` when bumping `extract/UPSTREAM`; `exampleLibrary.test.ts` fails if the index's ref and `UPSTREAM` disagree.

### Catalog publishing

Catalogs no longer ride along with a deploy. `.github/workflows/sync-catalogs.yml` (weekly, plus **Run workflow**) regenerates them and pushes the JSON to an orphan **`data`** branch, which jsDelivr serves. The built app reads that branch via `VITE_DATA_BASE` (set in `deploy.yml`), so **a catalog refresh goes live without rebuilding or redeploying the app**.

The copy committed under `web/public/data/` stays in the build as a fallback, used whenever the CDN is unreachable or before the `data` branch exists — so the app always works, at worst with catalogs frozen at the last deploy. Refresh that floor by running the scripts above and committing.

Run a sync locally against the published copy only if you want it current in a dev build; `sync-components.mjs` reuses the previous `generated` timestamp when the parts are unchanged, so a no-op run leaves the file (and its manifest hash) untouched.

The contributor list is the exception: the Pages deploy re-runs `sync-contributors.mjs` before `npm run build`, so a newly merged contributor is credited automatically on the next deploy to `master`. That step is best-effort (`continue-on-error`) — if the GitHub API is unavailable the build falls back to the committed JSON, which is why the file stays in the repo. Run `npm run sync:contributors` locally only if you want the list current in a dev build.

### Commit etiquette

- Use **atomic commits**: one logical change per commit. Fixing a bug _and_ spotting a typo elsewhere? Two commits.
- Give commits **useful names**. If there's an issue, prefix with it: `[#123] Fix stability when fins are swept aft`. The `#123` auto-links the issue.
- A short subject plus a body explaining _why/how_ is ideal.

### Pull requests

Open a PR from your branch to **`master`**. In the description:

1. Which issue it addresses — e.g. "Solves #123, where …".
2. The underlying cause.
3. How you fixed it.

Make sure `npm run verify` passes (it runs the same gates CI does, in the same order), and that you've checked the change in the browser. Add or update tests for any logic you touch under `web/src/services` or `web/src/engine`. Keep engine `.mjs`/`.wasm` regenerations in the same PR as their Java changes.

What CI gates on the PR itself:

| Workflow         | Runs                                                                     | When                      |
| ---------------- | ------------------------------------------------------------------------ | ------------------------- |
| `parity`         | `npm run parity`, then a rebuild compared against the committed binaries | first                     |
| `reproducible`   | `npm run extract:check` against the pinned OpenRocket                    | first                     |
| `build-and-test` | `npm run verify` with coverage, then `vite build`                        | in parallel with `parity` |
| `e2e`            | Playwright, sharded three ways                                           | in parallel with `parity` |

Pushes to `dev` run only the web gates (`dev.yml`, about two minutes), so a broken test shows up on the push that broke it rather than when the PR to `master` is opened.

The Docusaurus site is **not** built on a PR. It is typechecked and built in `deploy.yml` on merge to `master`, so a broken MDX page or `sidebars.ts` shows up as a failed deploy rather than a failed PR check.

Those four jobs live in `.github/workflows/gates.yml`, a reusable workflow. `ci.yml` calls it on a PR and `deploy.yml` calls the same file on merge to `master`, so master is held to exactly what a PR was held to and there is only one definition to maintain. Add a gate to `gates.yml` and both get it.

On merge, `deploy.yml` runs those gates and only then typechecks and builds the docs, builds the app and publishes to Pages. Nothing publishes unless every gate is green.

### Which kind of test

|                                                         | For                                                                                          | Example                               |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------- |
| **`.test.ts`** (Vitest, node)                           | Pure logic: parsers, transforms, conversions, stores. Most tests are these.                  | `prefs/units.test.ts`                 |
| **`.test.tsx`** (Vitest + React Testing Library, jsdom) | A rule that lives in a component and has no service to test instead.                         | `components/common/UnitChip.test.tsx` |
| **`e2e/*.spec.ts`** (Playwright)                        | Whole journeys, and anything needing the real engine, layout or persistence across a reload. | `e2e/units.spec.ts`                   |

Component tests render through `src/testing/renderWithProviders.tsx`, which wraps the component in the app's providers and initializes real translations — so assertions read the strings a user actually sees, and a renamed i18n key fails a test instead of showing a raw key on screen. Seed preferences with `seedSettings({ … })` before rendering and read back what a component wrote with `readSettings()`.

**Prefer a `.test.ts`.** If logic is hard to reach without rendering, that is usually a sign it should move into a module of its own — as the launch-condition unit bridge did (`prefs/launchUnits.ts`), which had been unreachable inside a `.tsx` and therefore untested.

## Maintainer tasks

Occasional, advanced tasks — you won't need them for a typical change.

### Validation & fidelity tests

Two harnesses guard the engine (both need Node 22+; run from the repo root):

```bash
# 1. Parity test — proves BOTH browser engines (TeaVM WASM-GC and JS) return numbers
#    identical to the reference JVM. Builds a parity engine variant (-Pparity), runs the
#    same scenarios on each, and diffs them line-by-line. Both targets by default;
#    --js / --wasm narrow it to one.
node engine-java/test/parity/parity.mjs

# 2. Aero validation — scores the engine against wind-tunnel anchors (ARCAS /
#    Basic Finner / HB-2).
node engine-java/validation/score.mjs               # classic Extended Barrowman
node engine-java/validation/score.mjs --supersonic  # with the supersonic-aero model on
node engine-java/validation/score.mjs --strict      # exit 1 on any gate-point failure
```

From inside `engine-java/` these have shorter names: `npm run parity`, `npm run validate`, `npm run build`. Same scripts, no dependencies to install — see `engine-java/README.md`.

The parity harness compiles **only** under `-Pparity`, so the shipped engine carries no test code. Run the parity test after any engine change.

### Re-extraction / upgrading OpenRocket

The extracted OpenRocket sources are a committed snapshot — you only touch this when adopting a newer OpenRocket. `engine-java/extract/extract.mjs` regenerates `src/java/` from an OpenRocket source tree (repo checkout, plain source tree, or an extracted `-sources.jar`) and overlays the patches in `patches/`:

```bash
cd engine-java
node extract/extract.mjs --check --src /path/to/openrocket   # verify only: report drift & missing files
node extract/extract.mjs --src /path/to/openrocket           # regenerate src/java/
# (or set OPENROCKET_SRC instead of --src)
```

`--check` writes nothing; it reports any manifest file missing upstream (version mismatch) and any extracted file that differs from `upstream (+patch)`. On a version bump, re-diff each file in `patches/` against the new upstream, then re-extract and rebuild.

## Translation

ARJ is multilingual. Translations live in `web/src/i18n/locales/<lang>.json` (currently `en` and `es`, with English as the source of truth). As features land, new English keys sometimes get added before other languages catch up — translators fill those gaps.

To add or update a translation:

- Copy the structure of `en.json` and translate the values (keep the keys and any `{{placeholders}}` intact).
- To add a **new language**, add its `<lang>.json` and register it in `web/src/i18n/index.ts`.

## Documentation

The developer reference is the **[Architecture & internals](./architecture.md)** page (or the [Developer Guide](./developer-guide.md) for the short version) — start there to understand how the app fits together.

These docs are a **Docusaurus site under `website/`**, published alongside the app by the Pages deploy. English pages are `website/docs/*.md`; Spanish lives in `website/i18n/es/docusaurus-plugin-content-docs/current/` under the same filenames, and any page without a Spanish copy falls back to English rather than 404ing.

```bash
cd website
npm install
npm start      # build both languages and serve them — the language toggle works
npm run dev    # English only, with hot reload (Docusaurus serves one locale at a time)
```

If your change affects behavior — or the architecture — that contributors or users should know about, update the relevant page in the same PR (or note it so a maintainer can). The build fails on a broken internal link or anchor, so a stale cross-reference cannot ship.

> When you translate a heading, pin it to the English anchor — `## Vuelo (tras una simulación) {#flight-after-a-simulation}`. Otherwise links from pages that are still English break.

---

_Got a knack for tutorials, design, or spreading the word? Go for it — help in any shape or form is appreciated. 🙃 Not sure where to start? Open a discussion or ask on an issue._
