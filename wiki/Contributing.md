# Contributing

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

Open an issue prefixed with **[Feature Request]**. Explain the behavior you'd like and why it matters. Keep in mind ARJ is intentionally a *focused* interface, not a full re-creation of OpenRocket's desktop app — features that fit that scope are the easiest sell.

## Development

If you'd like to take an issue, **comment on it first** ("I'd like to work on this") so two people don't duplicate effort.

### Project layout

It's a monorepo with two halves:

- **`web/`** — the app: **Vite + React + TypeScript + Tailwind CSS**. This is where the vast majority of contributions happen (UI, 2D/3D views, `.ork` import/export, editor, simulation setup).
- **`engine-java/`** — OpenRocket's physics `core`, extracted and compiled by **TeaVM** to **WebAssembly + JavaScript**. The app loads the committed build (WASM by default, JS as a fallback) through the typed wrapper `web/src/engine/openRocketEngine.ts`.

For the full architecture — engine build pipeline, WASM/JS backend selection, threading (the sim Web Worker), and the motor/materials/`.ork` data flows — see the **[Architecture & internals](Architecture)** page (or the [Developer Guide](Developer-Guide) for the short version).

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
npm run test         # Vitest unit tests (engine services: parsers, transforms, stores)
npm run test:watch   # Vitest in watch mode while developing
npm run e2e          # Playwright end-to-end smoke tests (downloads Chromium the first time)
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
  node build-engine.mjs           # JS   → web/src/engine/vendor/openrocket-engine.mjs
  node build-engine.mjs --wasm    # WASM → web/public/engine/openrocket-engine.wasm (+ runtime)
  ```

- **Commit the Java change and *both* regenerated artifacts (`.mjs` + `.wasm`) together** — they must stay in sync, or the app runs stale physics (and the two backends must match).

### Catalog tools

The bundled reference catalogs — motors and components — are **build artifacts**, regenerated by scripts in `web/scripts/` and committed (the app never fetches them at runtime). Run them from `web/` (they need only Node):

```bash
cd web
node scripts/sync-motors.mjs        # sweep thrustcurve.org → src/data/motors.generated.json (~800 motors)
node scripts/sync-components.mjs     # parse the OpenRocket-Components DB → src/data/components.generated.json (~2,900 parts)
#   sync-components takes --src <path-to>/openrocket-database/orc if the DB isn't at the default local path
```

Refreshing a catalog is a **commit the regenerated JSON + redeploy** step (e.g. a scheduled CI job), not something the app does live.

### Commit etiquette

- Use **atomic commits**: one logical change per commit. Fixing a bug *and* spotting a typo elsewhere? Two commits.
- Give commits **useful names**. If there's an issue, prefix with it: `[#123] Fix stability when fins are swept aft`. The `#123` auto-links the issue.
- A short subject plus a body explaining *why/how* is ideal.

### Pull requests

Open a PR from your branch to **`master`**. In the description:

1. Which issue it addresses — e.g. "Solves #123, where …".
2. The underlying cause.
3. How you fixed it.

Make sure `npm run build` and `npm run test` pass, and that you've checked the change in the browser. Add or update unit tests for any logic you touch under `web/src/services` or `web/src/engine`. Keep engine `.mjs`/`.wasm` regenerations in the same PR as their Java changes.

## Maintainer tasks

Occasional, advanced tasks — you won't need them for a typical change.

### Validation & fidelity tests

Two harnesses guard the engine (both need Node 22+; run from the repo root):

```bash
# 1. Parity test — proves the browser (TeaVM-JS) engine returns numbers identical to
#    the reference JVM. Builds a parity engine variant (-Pparity), runs the same
#    scenarios on both, and diffs them line-by-line.
node engine-java/test/parity/parity.mjs

# 2. Aero validation — scores the engine against wind-tunnel anchors (ARCAS /
#    Basic Finner / HB-2).
node engine-java/validation/score.mjs               # classic Extended Barrowman
node engine-java/validation/score.mjs --supersonic  # with the supersonic-aero model on
node engine-java/validation/score.mjs --strict      # exit 1 on any gate-point failure
```

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

The developer reference is the **[Architecture & internals](Architecture)** page (or the [Developer Guide](Developer-Guide) for the short version) — start there to understand how the app fits together. All docs live in this **Wiki**, but the source of truth is the repo's **`wiki/` folder** — a GitHub Action syncs `wiki/*.md` to the Wiki on every push to `master`. **Edit the `.md` files under `wiki/` in a PR, not the Wiki UI** (UI edits get overwritten by the next sync). If your change affects behavior — or the architecture — that contributors or users should know about, update the relevant `wiki/` page in the same PR (or note it so a maintainer can).

---

*Got a knack for tutorials, design, or spreading the word? Go for it — help in any shape or form is appreciated. 🙃 Not sure where to start? Open a discussion or ask on an issue.*
