---
title: "Offline use & installing"
sidebar_position: 7
---
AstraRocketJs works with **no internet connection** once you've opened it, and can be **installed** so it sits alongside your other apps. Nothing is required to set this up — the first visit does it — but here's what to expect.

## Why it can work offline

The physics isn't running on a server. OpenRocket's engine is compiled to WebAssembly and runs inside your browser, so once the app and its data are on your device there's nothing left to call out to. That makes the offline case genuinely useful: you can design, edit, and run full flight simulations at a launch site with no signal.

## What gets saved for offline use

On your first visit the browser quietly stores, in the background:

- the app itself,
- the **physics engine** (~2.3 MB),
- the **motor catalog** (~1,150 motors with thrust curves) and the **component catalog** (~3,400 parts),
- the **[example rockets](./getting-started.md#example-rockets)** (~330 kB for all sixteen), so one opens on a first offline load rather than only if you were online when you went looking.

About 8 MB in total. You don't need to do anything to trigger it — just let the first load finish.

The motor catalog carries each motor's **thrust curve** with it, so simulating offline works for motors you've never opened before — 1,063 of the 1,156 motors. The remaining 93 have no published curve to bundle; the picker marks them, and they need a connection to fetch one from thrustcurve.org (cached once you do).

**Map imagery is the exception.** It is fetched as you look at it rather than downloaded up front, and the tiles you have viewed are kept — so a field you checked at home still draws at the launch with no signal. Ground you have never viewed cannot be drawn offline: the launch-site map falls back to a coordinate grid, and the ground track and 3D path to their plain plots, which carry the measurements anyway.

**Weather needs a connection.** [Weather from Open-Meteo](./running-a-simulation.md#weather) is fetched when you ask for it and is not stored offline. What you applied stays in the simulation.

**Your designs were always local.** Your library of saved rockets, custom motors and materials, and your settings live in your browser's storage on your device — that hasn't changed and never depended on a connection.

## Installing it

Your browser will offer to install the app. Where to find it:

| | |
|---|---|
| **Android (Chrome)** | Menu **⋮** → *Add to Home screen* / *Install app* |
| **iPhone / iPad (Safari)** | Share **↑** → *Add to Home Screen* |
| **Desktop (Chrome / Edge)** | The install icon in the address bar, or Menu → *Install AstraRocketJs* |
| **Desktop (Safari)** | File → *Add to Dock* |

Installing gives it its own icon and its own window, without browser tabs and address bar. It's the same app either way — installing doesn't unlock anything, and offline works whether or not you install.

> **Firefox** doesn't offer installation on the desktop. Offline still works there; you just open it as a normal tab or bookmark.

## Updates

When a new version ships, a banner appears under the header offering to **reload**. It won't reload on its own, because that could interrupt a design you're in the middle of, and it is not a dialog for the same reason: it says its piece and lets you finish what you were typing.

**Later** puts it away and brings it back in a couple of hours. The **✕** keeps the current version until you next reload, whenever suits you.

**Check for updates** in the About dialog (the version number in the header) asks right away and answers either way: that you are on the latest version, or that a new one is ready, in which case the banner comes back even if you put it away.

The app looks for a new version about every ten minutes, and again whenever you come back to the tab or your connection returns, so a tab left open all day still finds out that something shipped. A plain reload also picks up a new version directly, so you never need a hard reload; the site is served through a CDN that holds files for up to ten minutes, which is the longest a fresh deploy takes to reach you.

Motor and component catalogs refresh separately from the app itself, in the background, so new motors reach you without an app update.

While you are offline, the buttons that need a connection are greyed out and say so when you point at them: fetching weather, a place search by name, the landing estimate, flying the forecast hours and checking for updates. Everything else works as usual.

## Clearing it

Clearing your browser's site data for AstraRocketJs removes the offline copy — and, importantly, **also removes your saved designs, custom motors, and materials**, since those live in the same browser storage. Export anything you want to keep as `.ork` first — into a synced folder (iCloud Drive, OneDrive, Google Drive, Dropbox) it doubles as a backup you can reopen anywhere (see **[Files & Exports](./files-and-exports.md)**).

If you installed the app, uninstall it the way you'd remove any other app on your device.
