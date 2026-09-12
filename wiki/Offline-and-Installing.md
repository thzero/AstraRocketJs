# Offline use & installing

AstraRocketJs works with **no internet connection** once you've opened it, and can be **installed** so it sits alongside your other apps. Nothing is required to set this up — the first visit does it — but here's what to expect.

## Why it can work offline

The physics isn't running on a server. OpenRocket's engine is compiled to WebAssembly and runs inside your browser, so once the app and its data are on your device there's nothing left to call out to. That makes the offline case genuinely useful: you can design, edit, and run full flight simulations at a launch site with no signal.

## What gets saved for offline use

On your first visit the browser quietly stores, in the background:

- the app itself,
- the **physics engine** (~2.3 MB),
- the **motor catalog** (~800 motors with thrust curves) and the **component catalog** (~2,900 parts).

About 8 MB in total. You don't need to do anything to trigger it — just let the first load finish.

The motor catalog carries each motor's **thrust curve** with it, so simulating offline works for motors you've never opened before — 781 of the 815 motors. The remaining 34 have no published curve to bundle; the picker marks them, and they need a connection to fetch one from thrustcurve.org (cached once you do).

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

When a new version ships, a small message appears offering to **reload**. It won't reload on its own — that could interrupt a design you're in the middle of. Dismiss it and you'll keep using the current version until you next reload, whenever suits you.

Motor and component catalogs refresh separately from the app itself, in the background, so new motors reach you without an app update.

## Clearing it

Clearing your browser's site data for AstraRocketJs removes the offline copy — and, importantly, **also removes your saved designs, custom motors, and materials**, since those live in the same browser storage. Export anything you want to keep as `.ork` first — into a synced folder (iCloud Drive, OneDrive, Google Drive, Dropbox) it doubles as a backup you can reopen anywhere (see **[Files & Exports](Files-and-Exports)**).

If you installed the app, uninstall it the way you'd remove any other app on your device.
