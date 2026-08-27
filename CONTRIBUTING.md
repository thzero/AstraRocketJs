# Contributing to AstraRocketJs 🚀

Hi, and thanks for your interest in AstraRocketJs! 😊 Whether you want to write
code, hunt bugs, translate, or help in any other way, this guide will get you
started.

AstraRocketJs is a **lightweight web UI over the real OpenRocket engine** — the
physics is OpenRocket's, compiled to JavaScript; the app around it is ours. Most
contributions live in the web app. (To save keystrokes, we'll abbreviate the
project as **ARJ**.)

By participating you agree to our [Code of Conduct](CODE_OF_CONDUCT.md) — be kind
and constructive.

#### Table of contents
[Testing](#testing)
* [Reporting bugs](#reporting-bugs)
* [Suggesting new features](#suggesting-new-features)

[Development](#development)
* [Project layout](#project-layout)
* [Getting started](#getting-started)
* [Working on the engine](#working-on-the-engine)
* [Commit etiquette](#commit-etiquette)
* [Pull requests](#pull-requests)

[Translation](#translation)

[Documentation](#documentation)

[Anything else](#anything-else)

## Testing

ARJ isn't perfect — we need people to find and clearly document the rough edges.
Testers discover bugs, propose features, and try out changes. 📝

### Reporting bugs

Open a GitHub issue with a short, specific title (prefix it with **[Bug]**).
Please include:

* What you **expected** to happen, and what happened **instead**.
* The **steps** to reproduce it.
* Your **browser + OS** (e.g. "Chrome 120 on Windows 11") and the **ARJ version**
  (shown next to the title in the header, or under **Menu → About**).
* If it's tied to a specific design, attach the **`.ork` file** — that's usually
  the fastest path to a fix.

A screenshot or screen recording helps a lot.

### Suggesting new features

Open an issue prefixed with **[Feature Request]**. Explain:

* The behavior you'd like ARJ to have.
* Why it matters / what it unblocks.

Keep in mind ARJ is intentionally a *focused* interface, not a full re-creation
of OpenRocket's desktop app — features that fit that scope are the easiest sell.

## Development

If you'd like to take an issue, **comment on it first** ("I'd like to work on
this") so two people don't duplicate effort.

### Project layout

It's a monorepo with two halves:

- **`web/`** — the app: **Vite + React + TypeScript + Tailwind CSS**. This is
  where the vast majority of contributions happen (UI, 2D/3D views, `.ork`
  import/export, editor, simulation setup).
- **`engine-java/`** — OpenRocket's physics `core`, extracted and compiled to a
  JavaScript module by **TeaVM**. The app imports the committed build at
  `web/src/engine/vendor/openrocket-engine.mjs` through the typed wrapper
  `web/src/engine/openRocketEngine.ts`.

See the [README](README.md) for the full architecture.

### Getting started

You'll need **Node 22+**. The web app needs no JDK — it uses the committed engine
build.

```bash
cd web
npm install
npm run dev          # dev server with hot reload
```

Before opening a PR:

```bash
npx tsc --noEmit     # typecheck
npm run build        # production build must pass
```

Please **verify UI changes in a real browser**, not just that it compiles.

A few house rules that keep the codebase consistent:

- **All user-facing text goes through i18n.** Add keys to
  `web/src/i18n/locales/en.json` **and** `es.json` — never hardcode strings in
  components. See [Translation](#translation).
- **Never hardcode the app name or version.** They come from
  `web/src/services/appInfo.ts` (name from i18n, version from `package.json`).
- **Match the surrounding code** — its naming, comment density, and style.

### Working on the engine

Most contributions don't touch the engine. If you do:

- **Don't edit the extracted OpenRocket sources under `engine-java/src/java/`
  directly** — they're near-verbatim OpenRocket 24.12. Necessary tweaks go
  through a documented patch in `engine-java/patches/LEDGER.md` (see also
  `engine-java/ATTRIBUTION.md`).
- ARJ's own engine glue — the `@JSExport` facade, the component-tree builder,
  overrides, etc. — lives in `engine-java/src/api/`. That's fair game.
- Changing the engine requires a **JDK 21** and a rebuild:

  ```bash
  cd engine-java
  node build-engine.mjs   # TeaVM compile → regenerates web/src/engine/vendor/openrocket-engine.mjs
  ```

- **Commit the Java change and the regenerated `.mjs` together** — they must stay
  in sync, or the app runs stale physics.

### Commit etiquette

- Use **atomic commits**: one logical change per commit. Fixing a bug *and*
  spotting a typo elsewhere? Two commits.
- Give commits **useful names**. If there's an issue, prefix with it:
  `[#123] Fix stability when fins are swept aft`. The `#123` auto-links the issue.
- A short subject plus a body explaining *why/how* is ideal.

### Pull requests

Open a PR from your branch to **`main`**. In the description:

1. Which issue it addresses — e.g. "Solves #123, where …".
2. The underlying cause.
3. How you fixed it.

Make sure `npx tsc --noEmit` and `npm run build` pass, and that you've checked
the change in the browser. Keep engine `.mjs` regenerations in the same PR as
their Java changes.

## Maintainer tasks

These are occasional, advanced tasks — you won't need them for a typical change.

### Validation & fidelity tests

Two harnesses guard the engine (both need Node 22+; run from the repo root):

```bash
# 1. Parity test — proves the browser (TeaVM-JS) engine returns numbers identical
#    to the reference JVM. Builds a parity engine variant (-Pparity), runs the same
#    scenarios on both, and diffs them line-by-line.
node engine-java/test/parity/parity.mjs

# 2. Aero validation — scores the engine against wind-tunnel anchors (ARCAS /
#    Basic Finner / HB-2).
node engine-java/validation/score.mjs               # classic Extended Barrowman
node engine-java/validation/score.mjs --supersonic  # with the supersonic-aero model on
node engine-java/validation/score.mjs --strict      # exit 1 on any gate-point failure
```

The parity harness compiles **only** under `-Pparity`, so the shipped engine
carries no test code. Run the parity test after any engine change.

### Re-extraction / upgrading OpenRocket

The extracted OpenRocket sources are a committed snapshot — you only touch this when
adopting a newer OpenRocket. `engine-java/extract/extract.mjs` regenerates
`src/java/` from an OpenRocket source tree (repo checkout, plain source tree, or an
extracted `-sources.jar`) and overlays the patches in `patches/`:

```bash
cd engine-java
node extract/extract.mjs --check --src /path/to/openrocket   # verify only: report drift & missing files
node extract/extract.mjs --src /path/to/openrocket           # regenerate src/java/
# (or set OPENROCKET_SRC instead of --src)
```

`--check` writes nothing; it reports any manifest file missing upstream (version
mismatch) and any extracted file that differs from `upstream (+patch)`. On a version
bump, re-diff each file in `patches/` against the new upstream per
`patches/LEDGER.md`, then re-extract and rebuild.

Generated reference data (motor catalog, component presets) also refreshes here —
see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the sync scripts.

## Translation

ARJ is multilingual. Translations live in
`web/src/i18n/locales/<lang>.json` (currently `en` and `es`, with English as the
source of truth). As features land, new English keys sometimes get added before
other languages catch up — translators fill those gaps.

To add or update a translation:

- Copy the structure of `en.json` and translate the values (keep the keys and any
  `{{placeholders}}` intact).
- To add a **new language**, add its `<lang>.json` and register it in
  `web/src/i18n/index.ts`.

## Documentation

User and developer documentation lives in the project's **GitHub Wiki**. The
public site is a **GitHub Page**. If your change affects behavior contributors or
users should know about, please update the relevant Wiki page (or note it in your
PR so a maintainer can).

## Anything else

Got a knack for tutorials, design, or spreading the word? Go for it — we
appreciate help in any shape or form. 🙃 Not sure where to start? Open a
discussion or ask on an issue.
