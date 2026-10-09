# AstraRocketJs - Dependencies

> The npm version policy, and why a package is deliberately held back from its latest.
> Read this before "fixing" anything `npm outdated` flags.

Only `web/` has npm dependencies (`engine-java/` uses the bundled Gradle wrapper). This page records the **version policy** and, more importantly, **why a package is deliberately not on its latest version** - so the next person to run `npm outdated` doesn't re-litigate a decision, or "fix" a pin that exists for a reason.

_Last audited: **2026-10-09**._

#### Contents

- [Version policy](#version-policy)
- [Deliberate holds](#deliberate-holds)
- [Re-checking a hold](#re-checking-a-hold)

## Version policy

**1. A declared range names the version actually installed.** `web/package.json` should never claim `^4.0.0` while `node_modules` runs `4.3.3`. The range still permits newer versions - that's what `^` is for - but the floor states what the project is known to build and test against. Verify with:

```bash
cd web
node -e "const p=require('./package.json');const a={...p.dependencies,...p.devDependencies};
for(const [k,r] of Object.entries(a)){let v;try{v=require('./node_modules/'+k+'/package.json').version}catch{continue}
if(r.replace(/^[\^~]/,'')!==v)console.log(k,r,'!=',v)}"
```

**2. `@types/*` must match the runtime package it describes, not its own latest.** Type definitions ship no code; they are a claim about what the library contains. Types ahead of the runtime mean `tsc` accepts APIs that do not exist at runtime: the build passes, the browser throws.

This is why some `@types/*` entries use `~` (patch-only) rather than `^` - they are tied to a runtime version that is itself held.

**3. Peer-blocked upgrades move as a group, in one `npm install`.** Bumping a React-ecosystem package alone produces a confusing `ERESOLVE` cascade. See the hold below for the current group.

**4. `three` is `0.x` forever.** Three.js has never shipped a 1.0; it bumps the *minor* every release, and `^0.186.0` therefore means `>=0.186.0 <0.187.0` - the caret pins the release, not a major line. A Three.js upgrade is always an explicit decision.

**5. `prettier` and `cspell` are pinned to an exact version.** They are the only exact pins, because each one is a gate whose verdict depends on its own version. Prettier can change its output in a patch release, so a newer copy fails `format:check` on files nobody edited, or rewrites them across the repo; Prettier's own documentation says to pin it exactly for this reason. A newer cspell ships updated dictionaries, so it can flag words the spell gate passed before. Upgrading either is its own change: bump the version, then run `npm run format` or `npm run spell` and settle the result (reformatted files, or new entries in `.cspell/project-words.txt`) together.

## Deliberate holds

### React 19.3: capped by `@react-three/fiber`

| package | range |
| --- | --- |
| `react` | `~19.3.0` |
| `react-dom` | `~19.3.0` |
| `@types/react` | `~19.3.0` |
| `@types/react-dom` | `~19.3.0` |

**Why.** `@react-three/fiber@9.8` declares:

```json
"peerDependencies": { "react": ">=19 <19.4", "react-dom": ">=19 <19.4" }
```

React 19.4 falls outside that ceiling, so `react` and `react-dom` take patch releases only (`~`). `react-dom@19.3` requires `peer react@^19.3.0`, so the two move together. The two `@types/*` entries use `~` to match the runtime, per policy #2.

**Unblocked when:** a stable `@react-three/fiber` widens that peer range. All four packages then move together, in one install.

### `@types/node` on `^22`

CI and the documented minimum run Node 22, so `@types/node` stays on the 22 line, per policy #2.

## Re-checking a hold

```bash
cd web
npm outdated                                  # what the registry offers
npm view @react-three/fiber version           # is there a new stable?
npm view @react-three/fiber peerDependencies.react
```

If the ceiling has moved, upgrade the whole group in **one** command, then run the full gate:

```bash
npm run verify && npm run e2e
```

The e2e suite opens the 3D views: `rocket-cutaway`, `sketch-rotation`, `overlay-layering` and `flight-ground-map` drive the 3D tab and the 3D path, and `image-export` checks that the 3D snapshot is not a blank frame. It does not check the 3D tab's CG/CP markers or the 3D path's boost/coast coloring, and a console error does not fail a spec. After an upgrade touching `three`, `fiber` or `drei`, open the **3D** tab and the **3D path** tab (run a sim, press play), check the markers and the trajectory coloring, and confirm the browser console is clean.

Also beware a half-updated `node_modules`: on Windows a running dev server can hold `@rolldown/binding-win32-x64-msvc`, making `npm install` fail with `EBUSY` and leaving a mixed tree that produces spurious test failures. Stop any dev server, re-run `npm install`, and confirm versions before trusting a red run.
