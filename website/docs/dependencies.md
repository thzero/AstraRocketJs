---
title: "Dependencies"
sidebar_position: 16
---
Only `web/` has npm dependencies (`engine-java/` uses the bundled Gradle wrapper). This page records the **version policy** and, more importantly, **why a package is deliberately not on its latest version** — so the next person to run `npm outdated` doesn't re-litigate a decision, or "fix" a pin that exists for a reason.

_Last audited: **2026-09-11**._

#### Contents

- [Version policy](#version-policy)
- [Deliberate holds](#deliberate-holds)
- [Re-checking a hold](#re-checking-a-hold)

## Version policy

**1. A declared range names the version actually installed.** `web/package.json` should never claim `^4.0.0` while `node_modules` runs `4.3.3`. The range still permits newer versions — that's what `^` is for — but the floor states what the project is known to build and test against. Verify with:

```bash
cd web
node -e "const p=require('./package.json');const a={...p.dependencies,...p.devDependencies};
for(const [k,r] of Object.entries(a)){let v;try{v=require('./node_modules/'+k+'/package.json').version}catch{continue}
if(r.replace(/^[\^~]/,'')!==v)console.log(k,r,'!=',v)}"
```

**2. `@types/*` must match the runtime package it describes, not its own latest.** Type definitions ship no code — they are a claim about what the library contains. Types ahead of the runtime mean `tsc` accepts APIs that do not exist at runtime: the build passes, the browser throws. This is not hypothetical; `@types/three` sat at `0.185` against `three@0.169` until 2026-09-11.

This is why some `@types/*` entries use `~` (patch-only) rather than `^` — they are tied to a runtime version that is itself held.

**3. Peer-blocked upgrades move as a group, in one `npm install`.** Bumping a React-ecosystem package alone produces a confusing `ERESOLVE` cascade. See the hold below for the current group.

**4. `three` is `0.x` forever.** Three.js has never shipped a 1.0; it bumps the *minor* every release, and `^0.186.0` therefore means `>=0.186.0 <0.187.0` — the caret pins the release, not a major line. A Three.js upgrade is always an explicit decision.

## Deliberate holds

### React 19.2 — blocked by `@react-three/fiber`

| package | held at | latest |
| --- | --- | --- |
| `react` | `~19.2.8` | 19.3.0 |
| `react-dom` | `~19.2.8` | 19.3.0 |
| `@types/react` | `~19.2.18` | 19.3.0 |
| `@types/react-dom` | `~19.2.7` | 19.3.0 |

**Why.** `@react-three/fiber@9.7.0` — the latest stable — declares:

```json
"peerDependencies": { "react": ">=19 <19.3" }
```

React 19.3.0 falls outside that ceiling. Installing it fails with `ERESOLVE … Could not resolve dependency: peer react@">=19 <19.3" from @react-three/fiber@9.7.0`. `react-dom@19.3.0` in turn requires `peer react@^19.3.0`, so it is held by the same constraint. The two `@types/*` entries are held to match the runtime, per policy #2 — nothing blocks them technically.

Nothing newer than 9.7.0 is published except `10.0.0-canary.*` prereleases, which we do not ship.

**Unblocked when:** a stable `@react-three/fiber` widens that peer range. All four packages then move to 19.3 together, in one install.

### Not held (for the record)

These are current, and were verified rather than assumed:

- **`three` / `@types/three` at `0.186.0`** — upgraded from r169 on 2026-09-11. Nothing capped them; every consumer (`drei`, `fiber`, `three-mesh-bvh`, `@monogrid/gainmap-js`, …) declares a floor only, highest `>=0.159`. The 17-release jump required **no source changes** to `Rocket3D.tsx` or `FlightPath3D.tsx`.
- **`tailwindcss` / `@tailwindcss/vite` at `4.3.3`** — these read `^4.0.0` for a long time while resolving to the newest 4.x. That was a policy #1 violation (a stale floor), not an outdated install.
- **`typescript` at `5.9.3`** — `8.x` of `typescript-eslint` and the current `vite` have not been checked against TypeScript 7 (the native port). Not a hold so much as an upgrade nobody has costed yet.

## Re-checking a hold

```bash
cd web
npm outdated                                  # what the registry offers
npm view @react-three/fiber version           # is there a new stable?
npm view @react-three/fiber peerDependencies.react
```

If the ceiling has moved, upgrade the whole group in **one** command, then run the full gate:

```bash
npx tsc --noEmit && npx eslint . --max-warnings 0 && npm test && npm run build && npx playwright test
```

**The e2e suite does not open the 3D views.** A green `playwright test` says nothing about `three`, `fiber`, or `drei`. Any upgrade touching those must additionally be checked by hand: open the **3D** tab (rocket, CG/CP markers, floating labels) and the **3D path** tab (run a sim, press play — the trajectory should draw with boost/coast coloring and Burnout/Apogee labels), and confirm the browser console is clean. A blank WebGL canvas throws no error.

Also beware a half-updated `node_modules`: on Windows a running dev server can hold `@rolldown/binding-win32-x64-msvc`, making `npm install` fail with `EBUSY` and leaving a mixed tree that produces spurious test failures. Stop any dev server, re-run `npm install`, and confirm versions before trusting a red run.
