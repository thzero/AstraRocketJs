# reference — differential gate against PRISTINE upstream OpenRocket

Flies fixtures on **both** engines and compares: the engine we ship
(`web/src/engine/vendor/openrocket-engine.mjs`) against **unmodified** upstream
`core`, compiled here from the commit `extract/UPSTREAM` pins.

```
npm run reference          # from engine-java/ — every fixture; exits 1 on disagreement
npm run reference:show     # same, printing both sides' lines
node reference/run.mjs --fixture <path>      # just one
```

Needs a JDK and network on first run (Gradle resolves upstream core's real
dependencies). Nothing here is shipped or bundled.

## Why this exists when `test/parity` already passes

`test/parity` compiles **one** source tree — `src/java`, which is upstream
**plus** `patches/` — to three targets (JVM, JS, WASM) and checks they agree. That
catches a TeaVM miscompile, and only that. Two things are invisible to it,
because all three targets are wrong together:

- a file missing from `extract/manifest.txt`, so the extracted subset behaves
  differently from the whole
- a file in `patches/` that changed **behavior** rather than just placating TeaVM

`patches/info/openrocket/core/simulation/BasicEventSimulationEngine.java` is
exactly the file where that matters for staging: ~14 lines off upstream per
`patches/LEDGER.md`. This harness is the check that a patch has not moved the
physics.

## How it works

`ReferenceMain` builds the fixture's rocket through **upstream's own component
API** and flies it on upstream's `BasicEventSimulationEngine`. `run.mjs` flies the
same fixture through the shipped bridge (`buildRocket` / `setMotorById` /
`setMotorIgnitionById` / `simulateJson`) and diffs the two.

`Fixture.java` is deliberately a **second, independent reading** of the fixture —
`api.ComponentFactory` is the first. If the shipped bridge mis-seats a motor,
drops a separation config or applies a dimension to the wrong field, this side
does not make the same mistake and the flights disagree. It is **strict**: any
fixture key it does not consume is an error, because a reader that ignored an
unknown key would report agreement on a property it never tested.

Provisioning reuses the same upstream cache and the same pin as extraction
(`engine-java/.openrocket-src`, `extract/UPSTREAM`). `provision.mjs` only widens
the sparse checkout to the paths core needs to compile (resources, `core/libs`,
`core/build.gradle`); that is additive, so extraction is unaffected, and it
re-adds them on every run so a cache rebuilt by `extract --refresh` self-heals.

Upstream core's **dependency list is parsed out of upstream's own
`core/build.gradle`** rather than copied into `build.gradle`. A hand-copied list
would go stale silently on the next pin bump, and the symptom would be a
`NoClassDefFoundError` deep inside a flight, blamed on the harness.

## What is compared, and the tolerance

**Exact**: branch count, branch names, and each branch's full event sequence with
its source component. These carry the staging semantics — a separation firing one
event early is an exact-match failure.

**Tolerance**: apogee at `1e-5` relative, event times at `1e-6` s absolute.

Not zero, because **upstream core is not reproducible run to run**. Three
consecutive reference runs of the staged fixture gave sustainer apogees of

```
564.4375367648913
564.4375711325278
564.4375719594328
```

a spread of ~6e-8 relative, from the same seed and the same inputs. The shipped
engine does not drift that way, and the likely reason is in `patches/LEDGER.md`:
the TeaVM patches replace `ConcurrentHashMap` and `ConcurrentLinkedQueue` with
plain collections, pinning an iteration order upstream leaves free. So the
tolerance sits an order of magnitude above upstream's own noise.

## Fixtures must pin everything

Every aero- or mass-relevant property is explicit in the fixture. A property left
out is supplied by each side's own default, and two engines agreeing because they
share a default is not evidence, while two disagreeing over different defaults is
a false alarm.

Nose cone `shape` is the property that taught this: `ComponentFactory` defaults a
missing shape to `CONICAL`, upstream's `NoseCone` constructor does not.

Every component that can appear as an event **source** also needs a `name`, and
`run.mjs` fails with an actionable message if one does not have it. An unnamed
component falls back to its type's default name, and the two sides render that
differently **on purpose**: upstream translates it (`Inner Tube`) while the
shipped engine installs a bare `DebugTranslator` so the kernel emits stable
machine keys (`[InnerTube.InnerTube]`) for `web/src/services/warningText.ts` to
localize — see the do-not-fix note on `getTranslator` in
`src/shims/java/info/openrocket/core/startup/Application.java`. Normalizing the
two in the comparator would mean silently no longer checking event sources at
all, which is how a recovery device deploying off the wrong component would slip
through.

## Current state

Every fixture in `fixtures/` runs by default, so dropping a new one in gates it.
All three pass, with event sequences identical on every branch:

| fixture | pattern |
|---|---|
| `staged-flight.json` | high-power serial: separation at booster burnout, sustainer lit by electronics 1 s later, booster under its own chute |
| `staged-flight-auto.json` | low/mid-power gap staging: the booster's ejection charge both separates it and lights the sustainer (default `AUTOMATIC` ignition, no timer), chuteless booster tumbles down |
| `strap-on-booster.json` | two strap-on `ParallelStage` boosters on the core's body tube, separating at their own burnout; radial placement rather than stacking |

The first two mirror `ParityMain.runStagingScenario`'s `"timed"` and `"auto"`
cases and the third mirrors `podScenarios` case C. All three were already locked
across JVM/JS/WASM and none had been compared to upstream.

Each flies to the ground, so apogee, recovery deployment and ground hit are all
inside the comparison. The strap-on fixture deliberately drops the 6 s `maxTime`
cap `ParityMain` uses there: that cap exists because parity compares whole
recorded series and a chuteless tumble's tail drifts the sample count, which is
not something this comparison reads.

### The one open discrepancy

Two of the six branches disagree with upstream at the 1e-6 level while the other
four agree to 1e-9 or better:

| fixture | branch | relative | absolute |
|---|---|---|---|
| `staged-flight` | Sustainer | ~1.0e-6 | ~5.8e-4 m |
| `strap-on-booster` | Boosters | ~2.2e-6 | ~5.9e-4 m |
| `staged-flight` | Booster | ~1.8e-9 | |
| `staged-flight-auto` | Sustainer | ~1.1e-10 | |
| `staged-flight-auto` | Booster | ~4e-14 | |
| `strap-on-booster` | Core | ~2.1e-9 | |

Upstream's own run-to-run spread is ~6e-8 relative, so the top two are systematic
and not noise. **The two absolute gaps are near-identical (~5.9e-4 m) across
completely different rockets and altitudes, which points at a fixed offset in one
quantity rather than error accumulating over a flight.**

No common factor found yet. An earlier guess that it tracked the ignition override
(`setMotorIgnitionById`) is **ruled out**: the strap-on fixture sets no override
and still shows it, while `staged-flight-auto` sets none and does not.

### Not covered yet

- `.ork` round-trip: the fixture is a design tree, not a file, so upstream's real
  `.ork` loader is compiled in but unused. Loading the same `.ork` on both sides
  would extend this to `orkFile.ts`
- anything the fixture reader does not implement. It throws rather than skipping,
  so the error names what to add
