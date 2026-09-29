---
title: "Contributing"
sidebar_position: 14
---

AstraRocketJs is a **lightweight web UI over the real OpenRocket engine** — the physics is OpenRocket's, compiled to WebAssembly + JavaScript; the app around it is ours. Most contributions live in the web app. (To save keystrokes, we'll abbreviate the project as **ARJ**.)

By participating you agree to our **[Code of Conduct](https://github.com/thzero/AstraRocketJs/blob/HEAD/CODE_OF_CONDUCT.md)** — be kind and constructive.

If you'd like to take an issue, **comment on it first** ("I'd like to work on this") so two people don't duplicate effort.

Building and running the project — project layout, install, the engine, the catalog tools, commits, pull requests and tests — is the **[Developer Guide](./developer-guide.md)**.

#### Contents

- [Testing](#testing) — [Reporting bugs](#reporting-bugs) · [Suggesting features](#suggesting-new-features)
- [Maintainer tasks](#maintainer-tasks)
- [Translation](#translation)
- [Documentation](#documentation)

## Testing

### Reporting bugs

Open a GitHub issue with a short, specific title (prefix it with **[Bug]**). Please include:

- What you **expected** to happen, and what happened **instead**.
- The **steps** to reproduce it.
- Your **browser + OS** (e.g. "Chrome 120 on Windows 11") and the **ARJ version** (next to the title in the header, or under **Menu → About**).
- If it's tied to a specific design, attach the **`.ork` file** — usually the fastest path to a fix.

A screenshot or screen recording helps a lot.

### Suggesting new features

Open an issue prefixed with **[Feature Request]**. Explain the behavior you'd like and why it matters. Keep in mind ARJ is intentionally a _focused_ interface, not a full re-creation of OpenRocket's desktop app — features that fit that scope are the easiest sell.

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

The developer reference is the **[Developer Guide](./developer-guide.md)** for building and submitting, and **[Architecture & internals](./architecture.md)** for how the app fits together.

These docs are a **Docusaurus site under `website/`**, published alongside the app by the Pages deploy. English pages are `website/docs/*.md`; Spanish lives in `website/i18n/es/docusaurus-plugin-content-docs/current/` under the same filenames, and any page without a Spanish copy falls back to English rather than 404ing.

```bash
cd website
npm install
npm start      # build both languages and serve them — the language toggle works
npm run dev    # English only, with hot reload (Docusaurus serves one locale at a time)
```

If your change affects behavior — or the architecture — that contributors or users should know about, update the relevant page in the same PR (or note it so a maintainer can). The build fails on a broken internal link or anchor, so a stale cross-reference cannot ship.

> When you translate a heading, pin it to the English anchor — `## Vuelo (tras una simulación) {#flight-after-a-simulation}`. Otherwise links from pages that are still English break.
