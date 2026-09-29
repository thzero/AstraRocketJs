# Contributing to AstraRocketJs

Code, bug reports, feature ideas, translations and docs are all welcome.

- **Report a bug or request a feature** — open a [GitHub issue](https://github.com/thzero/AstraRocketJs/issues/new/choose); the templates will guide you.
- **Build and run the project** — [Developer Guide](docs/DEVELOPER.md).
- **How it all fits together** — [Architecture & internals](docs/ARCHITECTURE.md).

AstraRocketJs is a **lightweight web UI over the real OpenRocket engine** — the physics is OpenRocket's, compiled to WebAssembly + JavaScript; the app around it is ours. Most contributions live in the web app. (To save keystrokes, we'll abbreviate the project as **ARJ**.)

By participating you agree to our **[Code of Conduct](CODE_OF_CONDUCT.md)** — be kind and constructive.

If you'd like to take an issue, **comment on it first** ("I'd like to work on this") so two people don't duplicate effort.

Building and running the project — project layout, install, the engine, the catalog tools, commits, pull requests and tests — is the **[Developer Guide](docs/DEVELOPER.md)**.

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

## Translation

ARJ is multilingual. Translations live in `web/src/i18n/locales/<lang>.json` (currently `en` and `es`, with English as the source of truth). As features land, new English keys sometimes get added before other languages catch up — translators fill those gaps.

To add or update a translation:

- Copy the structure of `en.json` and translate the values (keep the keys and any `{{placeholders}}` intact).
- To add a **new language**, add its `<lang>.json` and register it in `web/src/i18n/index.ts`.

## Documentation

The developer reference is the **[Developer Guide](docs/DEVELOPER.md)** for building and submitting, and **[Architecture & internals](docs/ARCHITECTURE.md)** for how the app fits together.

These docs are a **Docusaurus site under `website/`**, published alongside the app by the Pages deploy. English pages are `website/docs/*.md`; Spanish lives in `website/i18n/es/docusaurus-plugin-content-docs/current/` under the same filenames, and any page without a Spanish copy falls back to English rather than 404ing.

```bash
cd website
npm install
npm start      # build both languages and serve them — the language toggle works
npm run dev    # English only, with hot reload (Docusaurus serves one locale at a time)
```

If your change affects behavior — or the architecture — that contributors or users should know about, update the relevant page in the same PR (or note it so a maintainer can). The build fails on a broken internal link or anchor, so a stale cross-reference cannot ship.

> When you translate a heading, pin it to the English anchor — `## Vuelo (tras una simulación) {#flight-after-a-simulation}`. Otherwise links from pages that are still English break.
