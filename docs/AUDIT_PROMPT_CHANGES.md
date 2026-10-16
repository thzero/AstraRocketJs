# AUDIT_PROMPT_CHANGES: audit of a change set (AstraRocketJs)

The full audit (`docs/AUDIT_PROMPT.md`) reads the whole package. This one reads what a change touches, to the same bar, before the change is called done. Run it on every change: a feature, a refactor, and a batch of audit fixes.

Paste the block below to a capable agent. Run from the repo root (`AstraRocketJs/`).

---

Audit the changes in this repository against `docs/AUDIT_PROMPT.md`, reading only what they touch and what touches them. Read `docs/AUDIT_PROMPT.md` first: its slices, hunt lists, "Ported kernel math" rules, fix rule, verification discipline, reporting bar and upkeep rules all apply here unchanged.

**The change set.** Everything that differs from where the change started: `git diff --name-only $(git merge-base <base> HEAD)` for the tracked files (which covers commits since that point and edits not yet committed) plus `git ls-files --others --exclude-standard` for new files. The base is the ref the person running this names, usually the commit the batch started from. If none is named, it is `HEAD`, which audits the edits not yet committed. Naming `master` audits everything since the last deploy, which on a long-lived `dev` branch is close to a full audit. Read the changed files whole, not only the changed lines: a defect in an unchanged line that the change now calls is in scope. Never stash, reset, check out or otherwise move the working tree; to see a file as it was, write `git show <base>:<path>` to a scratch folder.

**Method.**

1. Map every changed file to its slice in `docs/AUDIT_PROMPT.md` by folder. A file outside every slice goes to the slice that reads it: `sync-catalogs.yml` to slice 6, the other workflows and the gate tests to slice 5, user docs to the slice whose feature they describe, `engine-java/src/api/` to slices 4 and 4b (the bridge is part of the port), the rest of `engine-java/` to `docs/AUDIT_PROMPT_ENGINE.md`.
2. Launch one review agent per touched slice, in parallel. Each gets its slice's brief from `docs/AUDIT_PROMPT.md`, the list of changed files in its slice, and the instruction to also read every caller and callee of a changed export (grep for it across `web/src` and `engine-java/src/api`). Each reports in the full audit's format (`SEV | CATEGORY | file:line | issue | why it matters | fix`, VERIFIED or REPORTED, then upkeep, then files read).
3. Independently confirm every HIGH finding and every security finding against the source, and the Java for a port, before it goes in the report.

**What a change audit checks beyond the slice briefs.**

- **Fixes.** For each finding a change claims to fix: the defect is gone at every site the finding names and at any sibling site a grep finds; the change's test takes its expected value from the kernel, the Java or desktop, not from the fix (see "Fixes" in `docs/AUDIT_PROMPT.md`); and the test fails on the code before the fix, checked as "Fixes" there describes. A fix without such a test is a finding.
- **New kernel knowledge in the app.** A default, clamp, automatic rule, unit, formula or event vocabulary the app now holds for itself is a finding unless a mechanical check holds it to the kernel: `fieldReadback.kernel.test.ts` (fields the panel edits), `geometryParity.kernel.test.ts` (geometry), `kernelDefaults.kernel.test.ts` (the defaults table) or `check:fields` (what the writers emit). A new field has to be in `FIELDS`, and a new part type has to be in `defaultNode` and in the every-part design in `orkDesktopSamples.test.ts`, or none of these reach it.
- **`KNOWN` lists.** An entry added cites a finding ID in the current `docs/AUDIT.md` or states its reason in words. An entry removed corresponds to a fix in this change. An entry widened (a new rule under an old ID) is a new finding until shown to be the same defect.
- **Writers and readers.** A change to what the `.ork` or `.rkt` writer emits, or to what an importer reads, runs `npm run audit` in `web/`; its `desktop` and `fields` steps are the only check that desktop reads the same rocket. Report a failing step as a finding with its output. Desktop does not import `.CDX1`, so a change to that writer has no desktop check: compare it with desktop's own RASAero export DTOs by reading them.
- **The bridge and the vendored engine.** A change under `engine-java/src/api/` or to the vendored engine runs `npm run audit` in `engine-java/` before anything else rebuilds the engine: its `committed` step rebuilds from source and fails if the vendored binaries differ, so a rebuild run first would hide a bridge edit that was never built. Then run the whole unit suite in `web/` (`npx vitest run`), whose kernel tests load the vendored engine.
- **Comments, tests and docs the change writes.** Present-tense constraints, no history (`web/tests/commentsStateTheConstraint.test.ts` catches only the mechanical cases); test titles that state the behavior; user docs and their Spanish twins under `website/` that match what the app now does.

**Gates.** Run, from `web/`: `npm run verify:ci`, then `npx playwright test` with no `--shard` and no `-g`. Run `npm run audit` in `web/` whenever the change touches `src/services/files/`, `src/services/design/`, `src/tree/`, `src/engine/` or `engine-java/`, and `npm run audit` in `engine-java/` whenever it touches `engine-java/` or the vendored engine. Say plainly which gates were not run and why. A gate that fails is a finding.

**Reporting.** The bar is the full audit's: defects first with severities, upkeep after them in its own section, no style nitpicks, and a run that finds nothing at MED or above says so. Add each finding to `docs/AUDIT.md` under its category with the next free ID there, update its Status counts, and mark each finding the change fixed as fixed with the test that pins it. Do not replace the report: it is the one list. Then reply with the count of new defects, the findings closed, the gates run and their results.
