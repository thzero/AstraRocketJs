# Component and field coverage against OpenRocket

Two questions, answered against the OpenRocket source rather than against our own
copies of it:

- **(a)** For every component, do we expose every field OpenRocket has?
- **(b)** Are we missing any components?

Dated 2026-09-27, against the upstream commit `engine-java/extract/UPSTREAM` pins.

**This took two passes, and the first one's authority was too narrow.** It used
the `.ork` FILE FORMAT, which answers "what can a saved design carry" and not
"what does the desktop let you set". Anything the config dialogs offer that is
not a file field was invisible to it: the shape description panel, and the
controls for states the file stores as an ABSENCE rather than a value. Pass two
reads the dialogs themselves (`swing/.../configdialog/*Config.java`), which are
in the same upstream checkout. Both passes are recorded below.

## Method

The authority is `DocumentConfig.java`, OpenRocket's own `.ork` reader. Its
`setters` map holds 140 entries keyed `Class:tagname`, which is the complete set
of fields the file format carries, and its `constructors` map holds the list of
components a file may contain. Field lists are resolved through the class
hierarchy read from `rocketcomponent/*.java`, so a body tube is credited with
everything `SymmetricComponent`, `BodyComponent`, `ExternalComponent` and
`RocketComponent` declare, which is where most of them live.

Our side was measured by BEHAVIOR, not by reading our source:

1. Build a tree holding the component, export it with our own writer.
2. For each upstream tag, inject it into that XML, import it, and compare the
   resulting node against the baseline. Different node means the reader took it.
3. Export the imported tree again and look for the tag. Present means it
   survives a round trip.
4. Check `ComponentFactory.java` for whether the key reaches the kernel.

One trap worth recording, because the first pass fell into it. Probing one tag
at a time understates the writer: a fin tab with a height and no length is not a
tab, so nothing is written, and the tag looks lost. The numbers below come from
a second pass with every tag set at once.

## (b) Components: none missing

The `.ork` format can contain 21 distinct components. We have a type for every
one of them.

| OpenRocket | ours | | OpenRocket | ours |
| --- | --- | --- | --- | --- |
| BodyTube | bodytube | | MassComponent | masscomponent |
| Transition | transition | | ShockCord | shockcord |
| NoseCone | nosecone | | Parachute | parachute |
| TrapezoidFinSet | trapezoidfinset | | Streamer | streamer |
| EllipticalFinSet | ellipticalfinset | | AxialStage | stage |
| FreeformFinSet | freeformfinset | | ParallelStage | parallelstage |
| TubeFinSet | tubefinset | | PodSet | podset |
| LaunchLug | launchlug | | EngineBlock | engineblock |
| RailButton | railbutton | | InnerTube | innertube |
| Bulkhead | bulkhead | | TubeCoupler | tubecoupler |
| CenteringRing | centeringring | | | |

Two notes rather than gaps:

- `<boosterset>` is a legacy alias upstream maps to `ParallelStage`. Our reader
  handles it (`importReaders.ts`, `boosterset: readAssembly('parallelstage')`).
- `Sleeve` exists as a class in `rocketcomponent/` and is dead: no saver, no
  `DocumentConfig` entry, no `.ork` tag. A Sleeve cannot appear in a file, and
  OpenRocket itself cannot create one. Its only trace is a RockSim ring subtype.

Our `fairing` has no upstream counterpart. It is a RASAero-origin extension and
is documented as such in `tree/schema.ts`.

## (a) Fields: all closed

Of the 82 distinct fields across those components, every one is now editable
where OpenRocket makes it editable, reaches the kernel where it has physics,
and survives a round trip. What follows is what was wrong on 2026-09-27 and
what was done, so the next audit can check the claim rather than trust it.

### Reached the kernel, nothing could set it

Each of these now has a control in the property panel.

| field | on | control |
| --- | --- | --- |
| `crossSection` | all three fin sets | A select: square, rounded, airfoil. Upstream `FinSet.CrossSection` carries the volume factors 1.00 / 0.99 / 0.85, so it changes the fin's mass as well as its drag. |
| `instanceCount`, `instanceSeparation` | rings, launch lug, rail button | N evenly spaced copies, under Placement. |
| `radialPosition`, `radialDirection` | inner tubes, rings, couplers, engine blocks, mass objects | Off-center placement, under Placement. |
| `clusterScale`, `clusterRotation` | inner tube | Beside the cluster pattern, in the Motor section. |
| `cordLength` | shock cord | This type had no editable field at all. |
| `clipped` | transition | Clipped or full profile for the shapes where it means anything. |
| `flipped` | nose cone | A reversed cone, which is how a tail cone is modeled. |
| `massComponentType` | mass component | Altimeter, battery, payload and so on. Naming only, no physics. |
| packed `length`, `radius` | recovery devices, mass objects | The space the packed device takes up, and so where its mass sits. |
| rail button geometry | rail button | Inner diameter, height, base, flange and screw heights. |

### Round-tripped, and the kernel never saw it

Fixed in `ComponentFactory.java` and shipped in a rebuilt engine (parity
against the JVM unchanged: 342 reference values bit-identical or within ULP on
both the JS and WASM targets).

- **Rail button geometry.** Every button flew at the kernel's default, so its
  mass was wrong on any design that came from the desktop with a custom one.
- **Repeated instances.** A lug, button or ring with `instancecount` 3 was
  built once, so three rings weighed as much as one.
- **Off-center internals.** A ring, coupler or engine block flew on the axis.
  Note that upstream `RingComponent.getComponentCG` ignores the radial shift
  too, so for a ring this is a drawing and bounding-box concern; for a
  `MassObject` it moves real mass, and did not before.
- **A flipped nose cone.** Read nowhere and written as a hardcoded `false`.
- **Packed radius.** Wired now for parachute, streamer and shock cord; the mass
  component already had it.
- **`massComponentType`.** No physics, but dropping it silently renamed
  everybody's altimeters to "Mass component" on a round trip.

### Not persisted at all

- **Part color.** The one case where the app offered a control and threw the
  answer away. Written and read now as OpenRocket's own three-channel element.
- **Stage-level overrides.** The stage block writes its own name and id rather
  than going through the shared header, which is where every other component
  picks the override block up. Both halves fixed: written, and read back.
- **Packed radius under the wrong key.** The reader stored `<packedradius>` as
  `packedRadius`, a key nothing else in the app touched, while the writer,
  the engine bridge, the schematic and the 3D build all use `radius`. Every
  save therefore wrote the 12.5 mm constant. Now one key throughout.

### Deliberately still not exposed

The test is whether the DESKTOP lets a user edit it. Two items were parked here
on file-format reasoning and moved out once that test was applied properly.

- `preset`, the catalog part a component came from, IS editable upstream: it is
  the Parts Library row at the top of every config dialog, and our own picker
  is the same control. The link is carried now, both ways. The hazard first
  cited against it was unfounded: the kernel's own setters call `clearPreset()`
  the moment a dimension the preset defines is edited, so a link cannot outlive
  the geometry. `treeEdit` does the same, conservatively, using the FIELDS table
  as the list of what describes the part itself.
- `comment` is the desktop's Comment tab, and is now a field.
- `linestyle` IS editable upstream, on the Appearance tab, and is a per-part 2D
  line style. It is carried through the file without a control here, because we
  draw no line styles: a control for it would be one that does nothing.
- `id` is not user-editable anywhere; it is identity, and ours is minted per
  export.
- `innerradius` on a bulkhead, which upstream forces to 0.
- Our own RASAero extensions, `airfoilSection` and its leading-edge bluntness
  radius. They round trip in our extension tags and reach the kernel, and they
  are not OpenRocket fields, so they get no control. Not to be confused with
  `crossSection` above, which is upstream and is now exposed.

## Pass two: the config dialogs

Reading `trans.get(...)` labels and `*Model(component, "Property")` bindings out
of each `*Config.java` gives what the desktop actually puts on screen. What it
found beyond pass one:

**Fixed here**

- **The shape description.** A paragraph under the shape picker saying what an
  ogive or a clipped ellipsoid transition is. No file field, so pass one could
  not see it. Strings and translations vendored from upstream.
- **`Filled`.** A solid part with no wall. Round-tripped in the file and bridged
  for a nose cone and a transition, never bridged for a body tube, and offered
  nowhere. Now a checkbox on all three, and the wall and bore rows disappear
  while it is on, which is what the desktop greys out.

- **Automatic diameter**, on a nose cone's base, a transition's two ends and a
  body tube's outside. The part takes the diameter of the one next door and
  follows it. This one carried a correctness bug, not just a missing control:
  the file spells it as `auto`, our readers turned that into a hardcoded
  default for a nose cone and a body tube, and for a transition into an absent
  key that every view then drew at 12 mm while the kernel flew the neighbor's
  real diameter. Now an explicit flag with the resolved number beside it, in
  the shape `syncAutoShoulders` already uses: `syncAutoRadii` resolves it on
  every edit AND on import, the writer puts `auto` back, and the bridge calls
  `setXRadiusAutomatic` so the kernel keeps following too. The rule is the
  kernel's own, from `BodyTube.getAutoOuterRadius`: behind first, then ahead,
  skipping a neighbor whose facing end is itself automatic.
- **Comment.** Every component has one upstream, on its own tab. Ours was
  dropped on every save. It is a text box at the foot of the panel now, and it
  round trips.
- **Automatic diameter on a tube fin set and on the ring types.** These follow
  their PARENT, not the part beside them, so they get a resolver of their own
  (`parentDerived`): a ring, coupler, bulkhead or engine block fills the bore of
  the tube it sits in, a centering ring's own bore is the motor mount through it,
  and a tube fin set is sized from the body radius and the fin count. The writer
  puts `auto` back rather than the resolved number, because writing the number
  would turn a design that follows its tube into one pinned to whatever that tube
  happened to be.
- **The four Automatic value buttons**: a streamer or parachute's drag
  coefficient, a parachute's shroud-line length, a shock cord's length, and a
  packed radius. The first three are computed by the kernel and now carry the
  `auto` marker through the file and the `setXAutomatic` call through the bridge.
  The packed radius resolves here too, from `MassObject.getMaxParentRadius`, and
  is written in `MassObjectSaver`'s own `auto <value>` form so a reader that does
  not understand the marker still gets a usable size.

- **The second doors.** Four rows that are another way of typing a number the
  part already stores, which is how people actually have the figure: a trapezoid
  fin's sweep as an ANGLE off its own span, a streamer's strip AREA and ASPECT
  RATIO, a mass component's approximate DENSITY instead of its mass, and a motor
  cluster's tube separation as a DISTANCE rather than a multiple of the tube
  diameter. None of them is stored; each reads the keys that are and writes them
  back, the way the bore row writes a wall, in `services/derivedFields.ts` with
  the kernel's own clamps and degenerate cases. This also added an `area` unit
  group, which the app did not have.

  Three of the four the desktop shows alongside the number they derive from, so
  we do too. The cluster separation it puts behind a Relative/Absolute radio pair
  over one spinner, remembered as a preference; a one-column panel shows both
  rows live instead, with nothing to remember. The same pass hid all three
  cluster rows on a SINGLE tube, where `clusterCount` is 1 and every consumer
  ignores them.
- **The stage Recovery tab.** Single or dual deployment, and which of the stage's
  devices is the drogue. The flag is stored per device and we had it as a
  checkbox on each chute, which is not a control OpenRocket has anywhere: it
  could mark TWO drogues in one stage, a design the desktop cannot produce and
  whose warnings then depend on which device the kernel reaches first. It is a
  section on the stage now, with the per-device checkbox gone, and
  `setStageDrogue` clears the stage before it marks one.

- **The actions.** The config-dialog buttons that change the TREE rather than a
  field, all of them now in `services/componentActions.ts` as pure transforms
  with a `can*` predicate each, in one row at the foot of the panel:

  - **Convert to freeform**, from `FreeformFinSet.convertFinSet`. The outline
    comes from `finPlanformPoints`, which was already the tested port of
    `getFinPoints`; the four planform dimensions are dropped and everything else
    survives.
  - **Split fins / Split pods / Split boosters**, from `RocketComponent.splitInstances`:
    N copies at even angles from wherever the set was rotated to, each a single
    instance, with an override mass divided between them.
  - **Split cluster**, from `InnerTube.makeIndividualClusterComponent`: one tube
    per cluster position, pinned by `radialPosition`/`radialDirection` at the
    offset the cluster drew it at, with whatever was attached duplicated.
  - **Reset settings**, the cluster's spacing and roll back to the default.
  - **Calculate automatically** for a through-the-wall fin tab, from
    `FinSetConfig.calculateAutoTab` and `computeFinTabLength`, ring-merging rule
    and all six cases. It needed one new shared helper, `stationRadius`, for a
    symmetric body's radius at a station, so a tab on a boat tail is cut to the
    narrow end rather than through the skin.
  - **Scale fin**, which is `scaleNode` applied to one component, so a scaled fin
    takes its wall, tab and fillet with it.
  - **Import from image** and **Export CSV**, from `CustomFinImporter` and
    `FreeformFinSetConfig.writeCSVFile`. The tracer, the luma threshold, the
    one-pixel-is-one-millimeter scale and the 0.8 mm flatness tolerance are all
    upstream's; the CSV keeps upstream's CRLF and its trailing separator per line
    so an existing script still reads it.

**Open**

- Nothing. Every field and every action OpenRocket's component dialogs offer is
  now reachable. What is left is the one group below, and it is a decision
  rather than a gap.

## Out of scope

Deliberately not built, and not counted as coverage gaps. Both are about how a
rocket LOOKS in a picture, not about what it is or how it flies, so neither
changes a dimension, a mass, a stability number or a `.ork` the desktop would
read differently.

- **The Appearance tab's textures and decals.** A per-part image wrapped onto the
  3D model, with its own scale, offset, rotation, repeat mode, shine and an
  optional emissive pass. We carry the part COLOR, which is what the 2D
  schematic, the cut sheets and the printed templates use. A decal would need
  image assets carried inside the design file, UV mapping on every generated
  mesh, and a texture editor beside each part; the whole of it serves the
  rendering and nothing downstream of it.
- **Photo Studio.** OpenRocket's rendered-photograph window: sky and ground
  backdrops, sun position and flame, depth of field, motion blur, and an image
  export. It is a presentation tool sitting on top of the appearance data above,
  so it cannot be meaningfully built before that is, and it answers no question
  about the design.

Out of scope does NOT mean dropped. An `.ork` written by the desktop with
appearances or a Photo Studio setup still opens here, and what this app has no
model for is carried through a round trip verbatim
(`services/ork/passthrough.ts`): it is kept as raw XML and written back where it
was, so a design that came here for one dimension goes back with its paint and
its camera angle. Nothing is parsed, nothing reaches the engine, and nothing can
appear in the property panel, because the keys are not in the `FIELDS` table.

It works by EXCLUSION at three levels, because the things a `.ork` carries are
not all components:

| Level | Known set | Carried today |
| --- | --- | --- |
| a component's children | `KNOWN_COMPONENT_TAGS` (101 tags) | `appearance`, `insideappearance` |
| `<rocket>`'s children | `KNOWN_ROCKET_TAGS` | `kitname` |
| `<openrocket>`'s children | `KNOWN_DOCUMENT_TAGS` | `photostudio`, `docprefs`, `datatypes` |

The "carried today" column comes from diffing the element names all 34 upstream
savers emit against those three sets; it is not a guess, and by exclusion the
next tag a newer OpenRocket adds is covered without a change here. The document
level is the one that matters for the two features above: `<photostudio>` is a
SIBLING of `<rocket>`, so a component-level pass can never see it, which is
exactly how the first version of this shipped claiming more than it did.

The rule all three sets obey is that a tag we handle ourselves must never also be
carried, or the file would contain it twice. Tests assert each set covers every
tag our own writer puts at that level.

One fix fell out of the middle level. `referencetype` and `customreference` -
what the stability calibers are measured against - are in the KNOWN set rather
than carried, because the writer emits a `referencetype` of its own. It used to
emit a hardcoded `maximum`, so a design whose calibers were set against a fixed
length came back measured against its widest body tube: a different stability
number for the same rocket. The file's own value is read and written now, with
`maximum` still the default and still what this app itself measures against.

The one thing that genuinely cannot survive is a **decal**, because its image is
a separate member of the `.ork` zip and we keep no members but the XML and the
thrust curves. Preserving `<decal name="flames.png">` would name a file that is
not in the file we write, so the reference is removed and the rest of the
appearance is kept. The import says so, rather than dropping it in silence.

If either feature is ever wanted, the appearance data has to come first, and the
place to start is `AppearancePanel.java` and `DecalImage`.

Not a gap: the parachute's spill hole is commented out upstream, with a
"TODO COMPLETE Spill hole development" beside it.

## The rest of the archive

A `.ork` is a zip of up to four kinds of member, and this app read exactly one of
them until 2026-09-27:

| Member | Now |
| --- | --- |
| `rocket.ork` | read, as always |
| `thrustcurves/<digest>.rse` | read, and used when the catalog cannot resolve a motor |
| decal images | not kept; the decal reference is removed and the import says so |
| `preview.png` | not kept; whatever opens the file next regenerates it |

The thrust curves were the one real loss, and it was not cosmetic. OpenRocket
embeds the curve of every motor a design uses precisely so the file opens on an
install that does not have them. Dropping them meant a design built on anything
outside our catalog opened with an empty mount and a blocked run - correctly, in
that `loadOrk` refuses to seat a motor it cannot resolve rather than flying a
default, but with the answer sitting unread in the file.

They are now a FALLBACK, in both places that used to end at the unresolved
placeholder: a designation the catalog does not know, and one it does know whose
curve will not download. Catalog first, so nothing changes for a design that
already opens; the file's own curve second. The match is by designation with the
delay stripped, because a `.ork` names `J350-6` while the curve it embeds is the
motor `J350` - the delay is the mount's choice, not the motor's. Nothing is
written to the user's own custom-motor list on that path: the curve belongs to
the design that carried it.

## Reproducing this

The probe is not in the suite. It needs `engine-java/.openrocket-src`, which is
an extraction artifact rather than a committed dependency, and it takes a few
seconds per component. Rebuild it from the method above, or turn it into a test
that asserts the known-gap list so a NEW gap fails loudly. The second is the
better answer if these numbers are going to be relied on twice.
