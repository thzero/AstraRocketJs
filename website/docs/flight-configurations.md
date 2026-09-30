---
title: "Flight Configurations"
sidebar_position: 10
---
A **flight configuration** is one way the rocket is set up to fly: a motor in every mount, when each recovery device opens, when each booster lets go, and which stages are in the air at all. Every simulation flies one, and several simulations can share the same one.

This is OpenRocket's own model, and it is what makes "the same rocket on a C6 and on a D12" two setups rather than two designs. The **Configurations** tab is where they are made; the **Simulations** tab is where a run picks one.

## The table

One row per configuration, one column per part it configures. Reading across a row tells you what that setup does everywhere; reading down a column tells you what the same mount or chute does under each setup, which is the comparison a staged or clustered rocket is designed around.

- **New** adds a configuration with the default motors, even when an identical setup is already there: two configurations that seat the same motors are a choice, not an accident.
- **Copy** duplicates the selected one, motors and all, and puts the copy next to it. A named configuration's copy says so; an unnamed one stays unnamed, because its label is its motor list.
- **Delete** removes it. Simulations flying it move to the first one left, so the app asks first when any do. The last configuration cannot be deleted: every simulation names the one it flies.
- **Flights** counts the simulations flying each configuration.

A configuration you have not named is labeled by its motors, the way the desktop labels it. Give it a name in the editor beside the table when the motors are not the point, for example *Contest* or *Sustainer only*.

Below the desktop breakpoint the part columns drop away and the editor moves under the table, so a phone still reaches everything through one pane.

## Motors

One card per motor mount, aft to nose. **Change…** opens the [motor picker](./motors.md), 📈 shows the seated motor's thrust curve, and **Ignition** sets when that motor lights:

- **Automatic** is the low and mid-power pattern: the launch stage lights at launch, an upper stage on the ejection charge of the stage below.
- **Launch**, **Upper-stage ejection**, **Upper-stage burnout** and **Never**, each with a delay in seconds, are what an electronically-timed sustainer or an air-start needs. The sustainer triggers only appear on a mount that has a stage below it, since nothing else can fire them.

Editing a motor here changes it for **every** simulation flying this configuration. That is what sharing a setup means, and it is why motors are edited here and nowhere else: two surfaces writing the same loadout under different rules is how they come to disagree.

## Recovery

When each recovery device opens **on this flight**. Every field falls through to the design: leave it empty and the part's own value applies, which is shown as the placeholder so the control reads as the number the flight will actually use.

The override is per field, so a configuration can move the altitude and leave the trigger where the design put it: "deploy the main at 150 m on this flight" is one field, not a second copy of the chute.

A part that some configuration opens differently says so in the design [property panel](./designing-a-rocket.md), naming those configurations, so the altitude on screen is never a number the flight quietly ignored.

## Staging

One card per stage, whether or not it separates.

- **Flies on this configuration** decides whether the stage is in the flight at all. A grounded stage contributes no mass, no drag and no motor: the rest of the rocket flies without it, which is how a two-stage design is flown as its own sustainer without deleting the booster. Something has to fly, so the last stage still in the air cannot be grounded.
- **Stage separation**, **Separation delay** and **Separation altitude** say when a booster lets go, with the same fall-through to the design the recovery fields have. The top stage has nothing above it to let go of, so it shows the flies checkbox alone.

## Choosing one for a simulation

Each row of the [Simulations](./running-a-simulation.md) table has a **Configuration** picker, and the simulation editor has the same one with the loadout spelled out under it and a button into this tab. Pointing a row at another configuration ages its numbers, the way any other change to what it flies does.

## In the file

A `.ork` carries its configurations, and so does this app: every one the file declares comes in with its motors, its recovery, its staging and its grounded stages, and each arrives as a simulation of its own so there is a run to put numbers against. Each keeps the file's own configuration id, so a design opened here and saved back is the same set of configurations rather than a rewrite of them. See [Files & Exports](./files-and-exports.md).
