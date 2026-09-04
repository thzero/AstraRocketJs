# Reusable audit prompt — `packages/app`

Paste the block below to an agent (Claude Code or similar) to re-run the full-package audit that produced `AUDIT.md`. It encodes the slicing strategy, per-slice focus, verification discipline, and known false-positives so results stay comparable run over run.

Update the "Baseline facts" section whenever the codebase changes materially (new tooling, resolved findings) so each run starts from current truth rather than re-deriving it.

## The prompt

---

> Do a full engineering audit of `packages/app` in this repo (browser re-creation of OpenRocket; React 18 + TypeScript + Vite + Vitest + three.js). Cover: security, correctness bugs, bad/over-complex code, architecture, missing unit tests, dead code, linting/tooling gaps, convention drift, and accessibility.
>
> **Method — fan out, don't read it all in one context.** Launch parallel review agents, one per slice below. Each agent reads its files fully, reports concrete findings as `severity | file:line | issue | why it matters | fix`, ranked by severity, findings-only (no preamble). Then synthesize all reports into one prioritized `AUDIT.md` at the repo root, grouped by category, with a "recommended order of attack" at the end.
>
> **Slices:**
> 1. **File-parser services** — `src/services/{orkFile,rasaeroFile,rocksimFile,exMotors,thrustcurve,saveFile,session,shareLink,hostMigration,motorDb,csvUtil,xmlUtil}.ts`. These parse UNTRUSTED user files (`.ork`/`.rkt`/`.CDX1`) and fetch remote data. Hunt: decompression bombs (uncapped `unzipSync`/inflate), unescaped round-trip on export (XML/CSV injection), prototype-key lookups on untrusted strings, unbounded recursion on nesting depth, `Number('')===0` accepting malformed tokens, swallowed errors producing partial models, encoding assumptions.
> 2. **`src/App.tsx`** (the god component) + `main.tsx`. Hunt: extractable hooks/services, business logic trapped in the component (flight pipeline, motor matching, export mapping), unmemoized per-render recomputes, effects-as-events, the `exhaustive-deps` disables (assess each: safe or hiding a bug), dead state/handlers, what's untestable because it's inline.
> 3. **`src/components/*` (excluding App.tsx)** — prioritize the largest/untested: `TreeSchematic`, `PropertyPanel`, `Rocket3D`, `BatchSimulate`, `MotorBrowser`, `StatTiles`, `DragPanel`, `SimResults`, `ScaleDialog`, `MeasuredMassBox`, `ComponentTree`, `FinPointsEditor`, `PresetPicker`, `NumField`. Hunt: god-components, business logic that belongs in services, missing memoization on expensive renders (3D/charts/sweeps run in render body), inline object/function props, mid-async state-after-unmount, duplicated-and-drifted JSX, weak numeric-input validation, `dangerouslySetInnerHTML`, unsafe `href`/`target`, accessibility gaps (pointer-only SVGs, icon buttons without `aria-label`).
> 4. **`src/tree/*`** (geometry/model). Hunt: divide-by-zero / NaN / Infinity from zero-dimension inputs, degenerate triangles, winding/manifoldness, mutation of shared model objects, index-out-of-bounds (tsconfig has `noUncheckedIndexedAccess`), duplicated helpers (`num()` reader, shoelace area), math without tests, truly-unused modules (VERIFY by grepping imports across `src` before claiming dead).
> 5. **Dead code + tooling/conventions (whole package).** No knip/ts-prune installed — do a grep-based export-usage sweep; flag exports imported by nothing (or only their own test) and never-imported modules, but distinguish real dead code from the deliberate "export for unit-test access" pattern. Assess: lint enforcement (ESLint/Prettier presence, CI lint step, inert `eslint-disable` comments), tsconfig `noUnusedLocals`/`noUnusedParameters`, named-vs-default export consistency, file/test naming, duplicated helpers. Recommend a concrete minimal lint setup.
>
> **Verification discipline — do NOT relay agent claims unchecked:**
> - Independently confirm every HIGH/MED **security** finding against the actual source lines before it goes in the report (read the lines; confirm the escape/cap is genuinely absent).
> - Confirm every **dead-code** claim by grepping the whole `src` for imports (and note test-only usage) before asserting it.
> - Be skeptical: only report issues with a specific `file:line` and a plausible failure scenario. No style nitpicks presented as findings.
>
> **Known false-positives — verify current state, don't blindly carry forward, but these were cleared last run:**
> - Browser `DOMParser` does not resolve external entities → **XXE not exploitable** in the XML parsers.
> - The only `dangerouslySetInnerHTML` (`GuideDialog`) is fed build-generated static HTML from `data/userGuide.ts` (written by `scripts/build-user-guide.mjs`) → not an XSS sink unless the build pipeline is compromised.
> - Remote nav URLs (`SiteBand`/`useMmrNav`) pass an `isHttpUrl` gate in `parseNav` → keep that guard load-bearing; not a live injection.
> - The XML parsers have **no prototype-pollution write surface** (parsed keys never used as write keys; IDs go through `freshId()`/Maps/Sets).
> - Many exports exist only so a unit test can reach an internal helper (e.g. `Rocket3D` camera cluster, `EXPORT_VARS`, tick-size constants) — deliberate, not dead.
>
> **Output:** overwrite `AUDIT.md` at the repo root. Severity emojis (🔴 security / 🟠 architecture+tooling / 🟡 correctness+tests+a11y / 🟢 dead code). End with a stepwise "recommended order of attack" that front-loads small verified fixes and defers large refactors. Date-stamp it.

---
