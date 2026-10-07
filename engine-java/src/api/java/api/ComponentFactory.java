package api;

import java.util.List;
import java.util.Map;

import info.openrocket.core.material.Material;
import info.openrocket.core.rocketcomponent.BodyTube;
import info.openrocket.core.rocketcomponent.Bulkhead;
import info.openrocket.core.rocketcomponent.CenteringRing;
import info.openrocket.core.rocketcomponent.ClusterConfiguration;
import info.openrocket.core.rocketcomponent.DeploymentConfiguration;
import info.openrocket.core.rocketcomponent.EllipticalFinSet;
import info.openrocket.core.rocketcomponent.EngineBlock;
import info.openrocket.core.rocketcomponent.ExternalComponent;
import info.openrocket.core.rocketcomponent.FinSet;
import info.openrocket.core.rocketcomponent.FreeformFinSet;
import info.openrocket.core.rocketcomponent.InnerTube;
import info.openrocket.core.rocketcomponent.LaunchLug;
import info.openrocket.core.rocketcomponent.MassComponent;
import info.openrocket.core.rocketcomponent.NoseCone;
import info.openrocket.core.rocketcomponent.Parachute;
import info.openrocket.core.rocketcomponent.RailButton;
import info.openrocket.core.rocketcomponent.RecoveryDevice;
import info.openrocket.core.rocketcomponent.RocketComponent;
import info.openrocket.core.rocketcomponent.ShockCord;
import info.openrocket.core.rocketcomponent.Streamer;
import info.openrocket.core.rocketcomponent.StructuralComponent;
import info.openrocket.core.rocketcomponent.Transition;
import info.openrocket.core.rocketcomponent.TrapezoidFinSet;
import info.openrocket.core.rocketcomponent.TubeCoupler;
import info.openrocket.core.rocketcomponent.TubeFinSet;
import info.openrocket.core.rocketcomponent.AxialStage;
import info.openrocket.core.rocketcomponent.ComponentAssembly;
import info.openrocket.core.rocketcomponent.ParallelStage;
import info.openrocket.core.rocketcomponent.PodSet;
import info.openrocket.core.rocketcomponent.LineInstanceable;
import info.openrocket.core.rocketcomponent.MassComponent;
import info.openrocket.core.rocketcomponent.RingComponent;
import info.openrocket.core.rocketcomponent.Bulkhead;
import info.openrocket.core.rocketcomponent.CenteringRing;
import info.openrocket.core.rocketcomponent.EngineBlock;
import info.openrocket.core.rocketcomponent.MassObject;
import info.openrocket.core.rocketcomponent.RecoveryDevice;
import info.openrocket.core.rocketcomponent.RingInstanceable;
import info.openrocket.core.rocketcomponent.position.AngleMethod;
import info.openrocket.core.rocketcomponent.position.AxialMethod;
import info.openrocket.core.rocketcomponent.position.RadiusMethod;
import info.openrocket.core.util.Coordinate;

import static api.JsonLite.bool;
import static api.JsonLite.obj;
import static api.JsonLite.str;

/**
 * Builds carved RocketComponents from JSON tree nodes. Node shape:
 * { "type": "bodytube", "id": "body", "name": "...", ...typed params...,
 *   "position": {"method": "top|middle|bottom|absolute", "offset": 0.0},
 *   "density": 950, "children": [ ...nodes... ] }
 * All SI, radians. Unknown types throw — callers surface the message.
 */
final class ComponentFactory {

    /**
     * Instance-count ceiling, mirroring {@code web/src/tree/nodeProps.ts}
     * MAX_INSTANCE_COUNT.
     * <p>
     * The BOUNDARY owns this rule, not the UI: {@code orkImport.ts} writes the raw
     * file value into the tree, so a cap in the property panel and the renderers
     * alone never sees it. Uncapped, {@code PodSet.getInstanceOffsets} allocates an
     * array per instance on every mass, aero and integration step, so a pod set of
     * 100000 takes 4.2 s for a SINGLE getStaticInfo - which the app calls per
     * keystroke - and {@code 1e999} reaches {@code (int) Infinity} = 2147483647 and
     * exhausts the heap.
     */
    static final int MAX_INSTANCE_COUNT = 64;

    /** Fin-count ceiling. {@code FinSet.setFinCount} clamps to 1..8 itself; this
     *  makes the boundary say so rather than relying on the kernel to absorb a
     *  nonsense value silently. */
    static final int MAX_FIN_COUNT = 8;

    /** Freeform fin outline ceiling, the browser's own (importLimits.MAX_FIN_POINTS):
     *  every point is a vertex in every mesh, drawing and kernel pass. */
    static final int MAX_FIN_POINTS = 10000;

    /** Shroud-line ceiling. A parachute with 1e9 lines built happily and
     *  reported a 300000 kg rocket with zero warnings. */
    static final int MAX_LINE_COUNT = 1024;

    /**
     * Read a count that reaches an allocation or a per-step loop.
     * <p>
     * NOT a bare {@code (int) dbl(...)}, which turns NaN into 0 and Infinity into
     * Integer.MAX_VALUE. Out-of-range is rejected rather than clamped: silently
     * building a different rocket than the file describes is the failure this
     * boundary exists to prevent.
     */
    private static int count(Map<String, Object> node, String key, int fallback, int max) {
        double v = dbl(node, key, fallback);
        if (Double.isNaN(v) || v != Math.floor(v) || v < 1 || v > max) {
            throw new IllegalArgumentException(
                    "'" + key + "' must be a whole number in 1.." + max + " (got " + v + ")");
        }
        return (int) v;
    }

    /**
     * The largest magnitude any component number may carry, in SI units. No real
     * part comes near it (a kilometer-long tube, a density forty times
     * osmium's), and it is far below where the geometry overflows: a
     * `"length":1e300` nose cone parsed, built, and came back with every static
     * figure null and no error.
     */
    static final double MAX_MAGNITUDE = 1e6;

    /**
     * Sizes, densities and masses: never negative. The kernel clamped a negative
     * one instead of refusing it, so `outerRadius:-1` built a part with mass 0.0
     * and no warning. Positions, angles, sweep, overhang and offsets stay signed.
     */
    private static final java.util.Set<String> NON_NEGATIVE = new java.util.HashSet<>(java.util.Arrays.asList(
            "length", "thickness", "outerRadius", "innerRadius", "radius", "aftRadius", "foreRadius",
            "height", "rootChord", "tipChord", "diameter", "outerDiameter", "innerDiameter",
            "shoulderLength", "shoulderRadius", "shoulderThickness",
            "foreShoulderLength", "foreShoulderRadius", "foreShoulderThickness",
            "aftShoulderLength", "aftShoulderRadius", "aftShoulderThickness",
            "lineLength", "width", "cordLength", "stripLength", "stripWidth",
            "density", "surfaceDensity", "lineDensity", "filletDensity", "mass", "overrideMass",
            "filletRadius", "finLeRadius", "tabHeight", "tabLength", "flangeHeight", "baseHeight",
            "screwHeight", "instanceSeparation", "deployDelay", "deployAltitude", "cd"));

    /**
     * A component number: {@link JsonLite#dbl}, refused past {@link #MAX_MAGNITUDE},
     * and refused below 0 for the keys in {@link #NON_NEGATIVE}.
     */
    private static double dbl(Map<String, Object> node, String key, double fallback) {
        double v = JsonLite.dbl(node, key, fallback);
        if (Math.abs(v) > MAX_MAGNITUDE) {
            throw new IllegalArgumentException(
                    "'" + key + "' is out of range (got " + v + "; the limit is " + MAX_MAGNITUDE + ")");
        }
        if (v < 0 && NON_NEGATIVE.contains(key)) {
            throw new IllegalArgumentException("'" + key + "' must not be negative (got " + v + ")");
        }
        return v;
    }

    private ComponentFactory() {}

    static RocketComponent create(Map<String, Object> node) {
        String type = str(node, "type", "");
        RocketComponent c;
        switch (type) {
            case "nosecone": {
                NoseCone nose = new NoseCone(
                        shapeOf(str(node, "shape", "ogive")),
                        dbl(node, "length", 0.07),
                        dbl(node, "aftRadius", 0.012));
                nose.setThickness(dbl(node, "thickness", 0.002));
                double shapeParam = dbl(node, "shapeParameter", Double.NaN);
                if (!Double.isNaN(shapeParam)) {
                    nose.setShapeParameter(shapeParam);
                }
                nose.setFilled(bool(node, "filled", false));
                // Nose cones use the AFT shoulder (into the tube behind them).
                double shR = dbl(node, "shoulderRadius", Double.NaN);
                if (!Double.isNaN(shR)) {
                    nose.setAftShoulderRadius(shR);
                }
                double shL = dbl(node, "shoulderLength", Double.NaN);
                if (!Double.isNaN(shL)) {
                    nose.setAftShoulderLength(shL);
                }
                double shT = dbl(node, "shoulderThickness", Double.NaN);
                if (!Double.isNaN(shT)) {
                    nose.setAftShoulderThickness(shT);
                }
                nose.setAftShoulderCapped(bool(node, "shoulderCapped", false));
                // A FLIPPED nose cone is how a tail cone is modelled: the same
                // part turned round, with the profile running the other way.
                // The desktop writes <isflipped>; ours wrote a hardcoded false
                // and the engine never read it, so an imported tail cone flew
                // nose-first.
                nose.setFlipped(bool(node, "flipped", false));
                // Automatic base diameter: follows the component behind it.
                if (bool(node, "aftRadiusAuto", false)) {
                    nose.setAftRadiusAutomatic(true);
                }
                c = nose;
                break;
            }
            case "transition": {
                Transition t = new Transition();
                t.setShapeType(shapeOf(str(node, "shape", "conical")));
                // Shape parameter — the SAME Shape enum as the nose cone
                // (ogive 0..1 secant fraction, power 0..1 exponent, parabolic
                // 0..1 segment, haack 0..1/3; conical/ellipsoid ignore it).
                // Must follow setShapeType, which resets it to the default.
                double shapeParam = dbl(node, "shapeParameter", Double.NaN);
                if (!Double.isNaN(shapeParam)) {
                    t.setShapeParameter(shapeParam);
                }
                // Clipped vs full profile (ellipsoid/power/haack only —
                // Shape.isClippable(); nose cones are never clipped). Absent
                // keeps the kernel default: setShapeType resets clipped to
                // isClippable(), i.e. clipped, matching the desktop.
                Object clippedRaw = node.get("clipped");
                if (clippedRaw instanceof Boolean) {
                    t.setClipped((Boolean) clippedRaw);
                }
                t.setLength(dbl(node, "length", 0.05));
                double fore = dbl(node, "foreRadius", Double.NaN);
                if (bool(node, "foreRadiusAuto", false) || Double.isNaN(fore)) {
                    t.setForeRadiusAutomatic(true);
                } else {
                    t.setForeRadius(fore);
                }
                double aft = dbl(node, "aftRadius", Double.NaN);
                if (bool(node, "aftRadiusAuto", false) || Double.isNaN(aft)) {
                    t.setAftRadiusAutomatic(true);
                } else {
                    t.setAftRadius(aft);
                }
                t.setThickness(dbl(node, "thickness", 0.002));
                t.setFilled(bool(node, "filled", false));
                double fShR = dbl(node, "foreShoulderRadius", Double.NaN);
                if (!Double.isNaN(fShR)) {
                    t.setForeShoulderRadius(fShR);
                }
                double fShL = dbl(node, "foreShoulderLength", Double.NaN);
                if (!Double.isNaN(fShL)) {
                    t.setForeShoulderLength(fShL);
                }
                double aShR = dbl(node, "aftShoulderRadius", Double.NaN);
                if (!Double.isNaN(aShR)) {
                    t.setAftShoulderRadius(aShR);
                }
                double aShL = dbl(node, "aftShoulderLength", Double.NaN);
                if (!Double.isNaN(aShL)) {
                    t.setAftShoulderLength(aShL);
                }
                // Shoulder WALL, per side. Set after the radius, which clamps
                // the thickness it already holds (Transition.setForeShoulderRadius).
                // These round-tripped through the .ork and were never handed to
                // the kernel, so a transition's shoulders flew as if they had no
                // wall and weighed nothing, whatever the file said. A capped
                // shoulder is made OUT of this wall, so the cap below was a
                // no-op without it.
                double fShT = dbl(node, "foreShoulderThickness", Double.NaN);
                if (!Double.isNaN(fShT)) {
                    t.setForeShoulderThickness(fShT);
                }
                double aShT = dbl(node, "aftShoulderThickness", Double.NaN);
                if (!Double.isNaN(aShT)) {
                    t.setAftShoulderThickness(aShT);
                }
                // Capped shoulder = a closed disc of the part's own material, so
                // it has mass. A transition has one per side; only the aft one
                // was read, and it was read from the NOSE CONE's key, which a
                // transition node never carries. `shoulderCapped` stays as a
                // fallback for a node written before the per-side keys existed.
                t.setForeShoulderCapped(bool(node, "foreShoulderCapped", false));
                t.setAftShoulderCapped(bool(node, "aftShoulderCapped", bool(node, "shoulderCapped", false)));
                c = t;
                break;
            }
            case "bodytube": {
                BodyTube bodyTube = new BodyTube(
                        dbl(node, "length", 0.3),
                        dbl(node, "outerRadius", 0.012),
                        dbl(node, "thickness", 0.0003));
                // Min-diameter rockets: the body tube itself is the motor mount
                // (kernel BodyTube implements MotorMount, same as the desktop).
                bodyTube.setMotorMount(bool(node, "motorMount", false));
                // Motor overhang (m): protrusion past the mount's aft end —
                // standard min-diameter practice (~6 mm); shifts the motor mass.
                bodyTube.setMotorOverhang(dbl(node, "motorOverhang", 0));
                // Solid, with no bore: the desktop's Filled checkbox, which a
                // nose cone and a transition already honored here and a body
                // tube did not. `<thickness>filled</thickness>` in the file.
                bodyTube.setFilled(bool(node, "filled", false));
                // The desktop's Automatic diameter: the tube takes the radius
                // of the part next door and follows it. Set AFTER the
                // constructor, which has already taken an explicit radius.
                if (bool(node, "outerRadiusAuto", false)) {
                    bodyTube.setOuterRadiusAutomatic(true);
                }
                c = bodyTube;
                break;
            }
            case "trapezoidfinset": {
                TrapezoidFinSet fins = new TrapezoidFinSet(
                        count(node, "finCount", 3, MAX_FIN_COUNT),
                        dbl(node, "rootChord", 0.05),
                        dbl(node, "tipChord", 0.03),
                        dbl(node, "sweep", 0.02),
                        dbl(node, "height", 0.03));
                fins.setThickness(dbl(node, "thickness", 0.003));
                fins.setCantAngle(dbl(node, "cant", 0));
                fins.setCrossSection(crossSectionOf(str(node, "crossSection", "square")));
                c = fins;
                break;
            }
            case "ellipticalfinset": {
                EllipticalFinSet fins = new EllipticalFinSet();
                fins.setFinCount(count(node, "finCount", 3, MAX_FIN_COUNT));
                fins.setLength(dbl(node, "rootChord", 0.05));
                fins.setHeight(dbl(node, "height", 0.03));
                fins.setThickness(dbl(node, "thickness", 0.003));
                fins.setCantAngle(dbl(node, "cant", 0));
                fins.setCrossSection(crossSectionOf(str(node, "crossSection", "square")));
                c = fins;
                break;
            }
            case "freeformfinset": {
                FreeformFinSet fins = new FreeformFinSet();
                fins.setFinCount(count(node, "finCount", 3, MAX_FIN_COUNT));
                fins.setThickness(dbl(node, "thickness", 0.003));
                fins.setCantAngle(dbl(node, "cant", 0));
                fins.setCrossSection(crossSectionOf(str(node, "crossSection", "square")));
                Object rawPoints = node.get("points");
                if (rawPoints instanceof List) {
                    List<?> list = (List<?>) rawPoints;
                    if (list.size() > MAX_FIN_POINTS) {
                        throw new IllegalArgumentException("freeformfinset has " + list.size()
                                + " points; the limit is " + MAX_FIN_POINTS);
                    }
                    Coordinate[] pts = new Coordinate[list.size()];
                    for (int i = 0; i < list.size(); i++) {
                        Object row = list.get(i);
                        if (!(row instanceof List) || ((List<?>) row).size() < 2
                                || !(((List<?>) row).get(0) instanceof Double)
                                || !(((List<?>) row).get(1) instanceof Double)) {
                            throw new IllegalArgumentException(
                                    "freeformfinset points must be [[x,y],...] numbers");
                        }
                        pts[i] = new Coordinate(
                                (Double) ((List<?>) row).get(0),
                                (Double) ((List<?>) row).get(1), 0);
                    }
                    if (pts.length < 3) {
                        throw new IllegalArgumentException(
                                "freeformfinset needs at least 3 points");
                    }
                    fins.setPoints(pts);
                    // A self-intersecting outline is REFUSED by the kernel, which rolls
                    // it back to the fin it held before -- here the constructor's
                    // DEFAULT fin -- and says so only to the log. Left unread that flew
                    // a fin the design does not draw: a crossing outline measured length
                    // 0.325 m / CP 0.2588 m, the default fin's numbers, where the
                    // outline as drawn gives 0.300 m / 0.2454 m. Refused by name
                    // instead; the flag is the FreeformFinSet patch (patches/LEDGER.md).
                    // A DIVERGENCE from desktop, which substitutes silently: a design
                    // that draws one fin and flies another is the worse answer.
                    if (fins.isOutlineRefused()) {
                        String finName = str(node, "name", "freeform fin set");
                        throw new IllegalArgumentException("Fin set \"" + finName
                                + "\": its outline crosses or touches itself, so it cannot"
                                + " be simulated. Redraw it in the fin editor.");
                    }
                }
                c = fins;
                break;
            }
            case "tubefinset": {
                TubeFinSet fins = new TubeFinSet();
                fins.setFinCount(count(node, "finCount", 6, MAX_FIN_COUNT));
                fins.setLength(dbl(node, "length", 0.1));
                double or = dbl(node, "outerRadius", Double.NaN);
                if (!Double.isNaN(or)) {
                    fins.setOuterRadius(or);
                }
                // TubeFinSet is not a FinSet — rotation applies here directly.
                double tubeRot = dbl(node, "rotation", 0);
                if (tubeRot != 0) {
                    fins.setBaseRotation(tubeRot);
                }
                c = fins;
                break;
            }
            case "innertube": {
                InnerTube tube = new InnerTube();
                tube.setLength(dbl(node, "length", 0.07));
                tube.setOuterRadius(dbl(node, "outerRadius", 0.0095));
                tube.setThickness(dbl(node, "thickness", 0.0005));
                tube.setMotorMount(bool(node, "motorMount", false));
                tube.setMotorOverhang(dbl(node, "motorOverhang", 0));
                // Cluster: pattern by its .ork XML name ("3-ring", "double"…).
                // One motor definition serves the whole cluster — the kernel
                // multiplies thrust by tube count and places mass/inertia at
                // the cluster geometry points. Rotation is radians (SI/rad
                // everywhere inside; degrees exist only at UI/.ork edges).
                String clusterName = str(node, "cluster", null);
                if (clusterName != null && !clusterName.isEmpty()) {
                    ClusterConfiguration cc = null;
                    for (ClusterConfiguration known : ClusterConfiguration.CONFIGURATIONS) {
                        if (known.getXMLName().equals(clusterName)) {
                            cc = known;
                            break;
                        }
                    }
                    if (cc == null) {
                        throw new IllegalArgumentException("Unknown cluster configuration: " + clusterName);
                    }
                    tube.setClusterConfiguration(cc);
                    tube.setClusterScale(dbl(node, "clusterScale", 1.0));
                    tube.setClusterRotation(dbl(node, "clusterRotation", 0.0));
                }
                // Off-axis / split-cluster offset: desktop splits a cluster into
                // single tubes, each holding its position as radialPosition (m) +
                // radialDirection (rad). Applies with OR without a cluster config
                // (a split tube's config is "single", so it has no cluster block);
                // 0/0 — the default — leaves the tube on the centreline unchanged,
                // matching prior behaviour for every non-split design.
                tube.setRadialPosition(dbl(node, "radialPosition", 0.0));
                tube.setRadialDirection(dbl(node, "radialDirection", 0.0));
                c = tube;
                break;
            }
            case "tubecoupler": {
                TubeCoupler tc = new TubeCoupler();
                tc.setLength(dbl(node, "length", 0.05));
                double or = dbl(node, "outerRadius", Double.NaN);
                if (Double.isNaN(or)) {
                    tc.setOuterRadiusAutomatic(true);
                } else {
                    tc.setOuterRadius(or);
                }
                tc.setThickness(dbl(node, "thickness", 0.0005));
                c = tc;
                break;
            }
            case "centeringring": {
                CenteringRing ring = new CenteringRing();
                ring.setLength(dbl(node, "length", 0.002));
                double or = dbl(node, "outerRadius", Double.NaN);
                if (!Double.isNaN(or)) {
                    ring.setOuterRadius(or);
                }
                double ir = dbl(node, "innerRadius", Double.NaN);
                if (!Double.isNaN(ir)) {
                    ring.setInnerRadius(ir);
                }
                c = ring;
                break;
            }
            case "bulkhead": {
                Bulkhead b = new Bulkhead();
                b.setLength(dbl(node, "length", 0.002));
                double or = dbl(node, "outerRadius", Double.NaN);
                if (!Double.isNaN(or)) {
                    b.setOuterRadius(or);
                }
                c = b;
                break;
            }
            case "engineblock": {
                EngineBlock eb = new EngineBlock();
                eb.setLength(dbl(node, "length", 0.005));
                double or = dbl(node, "outerRadius", Double.NaN);
                if (!Double.isNaN(or)) {
                    eb.setOuterRadius(or);
                }
                eb.setThickness(dbl(node, "thickness", 0.00095));
                c = eb;
                break;
            }
            case "launchlug": {
                LaunchLug lug = new LaunchLug();
                lug.setLength(dbl(node, "length", 0.05));
                lug.setOuterRadius(dbl(node, "outerRadius", 0.0022));
                lug.setThickness(dbl(node, "thickness", 0.0003));
                // Angle around the body (rad). Without it every lug flew at the
                // kernel default π (180°), ignoring the design/file value; this
                // shifts lateral balance and the wind response, not drag.
                lug.setAngleOffset(dbl(node, "angleOffset", Math.PI));
                // A lug's default separation is derived from its length
                // (LaunchLug's constructor), so it has to be set AFTER the
                // length or the kernel's derived value wins.
                c = lug;
                break;
            }
            case "railbutton": {
                RailButton rb = new RailButton();
                double od = dbl(node, "outerDiameter", Double.NaN);
                if (!Double.isNaN(od)) {
                    rb.setOuterDiameter(od);
                }
                // Same as the launch lug: the angle was dropped, so every button
                // flew at the kernel default π (180°). (Height/inner-diameter are
                // not modelled by the app, so they keep the kernel defaults.)
                rb.setAngleOffset(dbl(node, "angleOffset", Math.PI));
                // The rest of the button's geometry, which the file services
                // have carried since they stopped writing the desktop's
                // constructor constants. Every button flew at the kernel
                // default instead, so a 1010 rail button sized by hand had the
                // wrong mass and nothing said so. Total height first: the
                // kernel clamps the flange and base against it.
                double rbH = dbl(node, "height", Double.NaN);
                if (!Double.isNaN(rbH)) {
                    rb.setTotalHeight(rbH);
                }
                double rbId = dbl(node, "innerDiameter", Double.NaN);
                if (!Double.isNaN(rbId)) {
                    rb.setInnerDiameter(rbId);
                }
                double rbBase = dbl(node, "baseHeight", Double.NaN);
                if (!Double.isNaN(rbBase)) {
                    rb.setBaseHeight(rbBase);
                }
                double rbFlange = dbl(node, "flangeHeight", Double.NaN);
                if (!Double.isNaN(rbFlange)) {
                    rb.setFlangeHeight(rbFlange);
                }
                double rbScrew = dbl(node, "screwHeight", Double.NaN);
                if (!Double.isNaN(rbScrew)) {
                    rb.setScrewHeight(rbScrew);
                }
                c = rb;
                break;
            }
            case "parachute": {
                Parachute p = new Parachute();
                // Packed length (from <packedlength>). Governs where a bottom-/top-
                // referenced recovery device's mass sits; without it the default
                // 25 mm misplaces the CG (a shock cord can be tens of mm off).
                p.setLength(dbl(node, "length", 0.025));
                // Packed RADIUS (<packedradius>). The packed length was wired
                // and this was not, so a chute packed into a 54 mm tube was
                // flown at the kernel's 12.5 mm default: its mass sat on a
                // radius nobody chose, which moves the rotational inertia.
                double pR = dbl(node, "radius", Double.NaN);
                if (!Double.isNaN(pR)) {
                    p.setRadius(pR);
                }
                p.setDiameter(dbl(node, "diameter", 0.3));
                double cd = dbl(node, "cd", Double.NaN);
                if (!Double.isNaN(cd)) {
                    p.setCD(cd);
                }
                p.setLineCount(count(node, "lineCount", 6, MAX_LINE_COUNT));
                p.setLineLength(dbl(node, "lineLength", 0.3));
                double chuteSurf = dbl(node, "surfaceDensity", Double.NaN);
                if (!Double.isNaN(chuteSurf)) {
                    p.setMaterial(Material.newMaterial(Material.Type.SURFACE,
                            str(node, "surfaceMaterialName", "custom"), chuteSurf, true));
                }
                double chuteLine = dbl(node, "lineDensity", Double.NaN);
                if (!Double.isNaN(chuteLine)) {
                    p.setLineMaterial(Material.newMaterial(Material.Type.LINE,
                            str(node, "lineMaterialName", "custom"), chuteLine, true));
                }
                // Drogue or main. Nothing set this, so isDrogue() was false for every
                // device the app built, stageHasDrogue never went true, and the kernel
                // took the single-deployment branch on every flight: the dual-deployment
                // warnings (main too fast / too slow, drogue too slow, drogue with no
                // main) could not fire whatever the thresholds said. `<isdrogue>` is
                // OpenRocket's own .ork element for it.
                p.setDrogue(bool(node, "drogue", false));
                applyDeployment(p, node);
                c = p;
                break;
            }
            case "streamer": {
                Streamer s = new Streamer();
                s.setLength(dbl(node, "length", 0.025));
                double sR = dbl(node, "radius", Double.NaN);
                if (!Double.isNaN(sR)) {
                    s.setRadius(sR);
                }
                s.setStripLength(dbl(node, "stripLength", 0.5));
                s.setStripWidth(dbl(node, "stripWidth", 0.05));
                double cd = dbl(node, "cd", Double.NaN);
                if (!Double.isNaN(cd)) {
                    s.setCD(cd);
                }
                double streamerSurf = dbl(node, "surfaceDensity", Double.NaN);
                if (!Double.isNaN(streamerSurf)) {
                    s.setMaterial(Material.newMaterial(Material.Type.SURFACE,
                            str(node, "surfaceMaterialName", "custom"), streamerSurf, true));
                }
                s.setDrogue(bool(node, "drogue", false));
                applyDeployment(s, node);
                c = s;
                break;
            }
            case "shockcord": {
                ShockCord sc = new ShockCord();
                sc.setLength(dbl(node, "length", 0.025));
                double scR = dbl(node, "radius", Double.NaN);
                if (!Double.isNaN(scR)) {
                    sc.setRadius(scR);
                }
                sc.setCordLength(dbl(node, "cordLength", 0.3));
                double cordLine = dbl(node, "lineDensity", Double.NaN);
                if (!Double.isNaN(cordLine)) {
                    sc.setMaterial(Material.newMaterial(Material.Type.LINE,
                            str(node, "lineMaterialName", "custom"), cordLine, true));
                }
                c = sc;
                break;
            }
            case "masscomponent": {
                MassComponent m = new MassComponent();
                m.setComponentMass(dbl(node, "mass", 0.01));
                m.setLength(dbl(node, "length", 0.02));
                m.setRadius(dbl(node, "radius", 0.005));
                // What the lump IS (altimeter, battery, payload...). Carried in
                // the file since the writer was fixed, never handed over. It
                // changes no physics; OpenRocket uses it to name and picture
                // the part, and dropping it silently renamed everybody's
                // altimeters to "Mass component" on a round trip.
                m.setMassComponentType(massComponentTypeOf(str(node, "massComponentType", "masscomponent")));
                c = m;
                break;
            }
            case "podset": {
                // Off-axis pod (non-separating). Geometry is applied post-attach
                // (applyAssembly) — the setters NPE without a parent.
                c = new PodSet();
                break;
            }
            case "parallelstage": {
                // Strap-on booster: a ParallelStage IS an AxialStage, so it
                // separates and flies its own branch. Config applied post-attach.
                c = new ParallelStage();
                break;
            }
            // RASAERO-ORIGIN app extension, not an OpenRocket type: a camera
            // shroud, written to `.ork` as our own <fairing> element (the desktop
            // warns and skips it). Nothing in the editor can create one - no
            // ALLOWED_CHILDREN entry, no defaultNode case, no property panel - so
            // it appears only in a design loaded from a `.ork` this app wrote.
            //
            // Handled here rather than left to the `default:` below, which throws:
            // a design that round-trips through our own file format has to build.
            //
            // Modelled as a MassComponent, so mass, length and CG are right. Its
            // DRAG is NOT modelled: a fairing is an external body with frontal
            // area and MassComponent contributes none, so a design carrying one
            // flies slightly further than it should. Closing that means choosing
            // which OpenRocket primitive supplies the frontal-area drag. Scope:
            // RASAero. See engine-java/ATTRIBUTION.md.
            case "fairing": {
                MassComponent f = new MassComponent();
                f.setComponentMass(dbl(node, "mass", 0.03));
                f.setLength(dbl(node, "length", 0.08));
                // Radius from the shroud's cross-section, so the mass occupies
                // roughly the right volume rather than a point.
                double w = dbl(node, "width", 0.025);
                double hgt = dbl(node, "height", 0.02);
                f.setRadius(Math.max(w, hgt) / 2);
                c = f;
                break;
            }
            default:
                throw new IllegalArgumentException("Unknown component type: '" + type + "'");
        }

        // ---- common parameters ----
        String name = str(node, "name", null);
        if (name != null) {
            c.setName(name);
        }
        double density = dbl(node, "density", Double.NaN);
        if (!Double.isNaN(density) && density > 0) {
            Material m = Material.newMaterial(Material.Type.BULK,
                    str(node, "materialName", "custom"), density, true);
            if (c instanceof ExternalComponent) {
                ((ExternalComponent) c).setMaterial(m);
            } else if (c instanceof StructuralComponent) {
                ((StructuralComponent) c).setMaterial(m);
            }
        }
        String finish = str(node, "finish", null);
        if (finish != null && c instanceof ExternalComponent) {
            ((ExternalComponent) c).setFinish(finishOf(finish));
        }
        // RASAero feature #4: fin airfoil cross-sections + LE bluntness radius.
        // Absent keys keep the classic 3-value crossSection behavior.
        if (c instanceof FinSet) {
            FinSet fs = (FinSet) c;
            // Fin-set rotation about the body axis (radians; issue
            // 2026-08-05d: interleaving straight fins between tube fins).
            double rot = dbl(node, "rotation", 0);
            if (rot != 0) {
                fs.setBaseRotation(rot);
            }
            String section = str(node, "airfoilSection", null);
            if (section != null) {
                String s = section.toLowerCase();
                // Validate here so a bad name fails the build with a clear
                // message instead of an UnsupportedOperationException from
                // FinSetCalc mid-simulation.
                switch (s) {
                    case "hexagonal":
                    case "naca":
                    case "doublewedge":
                    case "biconvex":
                    case "hexbluntbase":
                    case "singlewedge":
                        break;
                    default:
                        throw new IllegalArgumentException(
                                "Unknown airfoilSection '" + section + "'");
                }
                fs.setAirfoilSection(s);
            }
            fs.setAirfoilLeDiamond(dbl(node, "airfoilLeDiamond", 0));
            fs.setAirfoilTeDiamond(dbl(node, "airfoilTeDiamond", 0));
            fs.setFinLeRadius(dbl(node, "finLeRadius", 0));
            // Fin fillets: the glue bead along the root where the fin meets the
            // body. The kernel has always computed their volume, mass and CM
            // (FinSet.calculateFilletVolumeCentroid, and calculateCM adds
            // filletMass to every fin unconditionally) -- but nothing here ever
            // set the radius, so it stayed at the field's initial 0 and every
            // fillet flew as if it were not there. The .ork reader, writer and
            // the rocket scaler all carried filletRadius across faithfully, so
            // the value was in the tree the whole time; only the engine never
            // saw it, and a design with 6 mm epoxy fillets simulated light
            // against desktop OpenRocket with nothing on screen to say why.
            double filletRadius = dbl(node, "filletRadius", 0);
            if (filletRadius > 0) {
                fs.setFilletRadius(filletRadius);
                // The bead is rarely the fin's own material (epoxy on plywood),
                // so it carries its own density. Absent, the kernel keeps its
                // default bulk material, which is Cardboard at 680 kg/m3 -- the
                // same material and density orkExport writes for a fillet the
                // file did not name, so the two sides agree either way.
                double filletDensity = dbl(node, "filletDensity", Double.NaN);
                if (!Double.isNaN(filletDensity) && filletDensity > 0) {
                    fs.setFilletMaterial(Material.newMaterial(Material.Type.BULK,
                            str(node, "filletMaterialName", "custom"), filletDensity, true));
                }
            }
        }
        // Repeated parts: N copies of one lug, button or ring, evenly spaced.
        // OpenRocket's own <instancecount>/<instanceseparation>, which the file
        // services carried across faithfully while the engine built ONE of
        // whatever it was, so three centering rings weighed as much as one.
        // Assemblies are handled in applyAssembly, which runs after the parent
        // is attached; everything else that can be repeated is a
        // LineInstanceable and is set here.
        if (c instanceof LineInstanceable && !(c instanceof RingInstanceable)) {
            LineInstanceable line = (LineInstanceable) c;
            line.setInstanceCount(count(node, "instanceCount", 1, MAX_INSTANCE_COUNT));
            double sep = dbl(node, "instanceSeparation", Double.NaN);
            if (!Double.isNaN(sep)) {
                line.setInstanceSeparation(sep);
            }
        }
        // Off-centerline placement for INTERNAL structure, as desktop's
        // RingComponent and MassObject setters take it. The inner tube sets
        // its own above. A mass object (mass component, parachute, streamer,
        // shock cord) flies the offset: MassObject.getComponentCG puts its
        // mass there. A ring part's getComponentCG ignores it, so a ring
        // carries the offset and still flies on the axis, as on the desktop.
        if (c instanceof RingComponent) {
            RingComponent rc = (RingComponent) c;
            rc.setRadialPosition(dbl(node, "radialPosition", 0));
            rc.setRadialDirection(dbl(node, "radialDirection", 0));
        } else if (c instanceof MassObject) {
            MassObject mo = (MassObject) c;
            mo.setRadialPosition(dbl(node, "radialPosition", 0));
            mo.setRadialDirection(dbl(node, "radialDirection", 0));
        }
        // Automatic diameters on INNER structure and tube fins: the flag says
        // the part follows what it is inside, and the number beside it is what
        // that currently resolves to. Set after the explicit radii above, which
        // would otherwise turn the flag off again.
        // `RingComponent` keeps these protected and each concrete ring
        // republishes them, so the cast has to be to the leaf type.
        boolean autoOuter = bool(node, "outerRadiusAuto", false);
        if (autoOuter) {
            if (c instanceof CenteringRing) {
                ((CenteringRing) c).setOuterRadiusAutomatic(true);
            } else if (c instanceof Bulkhead) {
                ((Bulkhead) c).setOuterRadiusAutomatic(true);
            } else if (c instanceof TubeCoupler) {
                ((TubeCoupler) c).setOuterRadiusAutomatic(true);
            } else if (c instanceof EngineBlock) {
                ((EngineBlock) c).setOuterRadiusAutomatic(true);
            } else if (c instanceof TubeFinSet) {
                ((TubeFinSet) c).setOuterRadiusAutomatic(true);
            }
        }
        if (c instanceof CenteringRing && bool(node, "innerRadiusAuto", false)) {
            ((CenteringRing) c).setInnerRadiusAutomatic(true);
        }
        // Values the kernel works out for itself when the design says so: a
        // recovery device's drag coefficient and shroud-line length, a shock
        // cord's length, and the packed radius of any mass object. Each is
        // `auto` in the file and a checkbox on the desktop.
        if (c instanceof MassObject && bool(node, "radiusAuto", false)) {
            ((MassObject) c).setRadiusAutomatic(true);
        }
        if (c instanceof RecoveryDevice && bool(node, "cdAuto", false)) {
            ((RecoveryDevice) c).setCDAutomatic(true);
        }
        if (c instanceof Parachute && bool(node, "lineLengthAuto", false)) {
            ((Parachute) c).setLineLengthAutomatic(true);
        }
        if (c instanceof ShockCord && bool(node, "cordLengthAuto", false)) {
            ((ShockCord) c).setCordLengthAutomatic(true);
        }
        // Mass / CG / CD overrides — absent key means "not overridden".
        double overrideMass = dbl(node, "overrideMass", Double.NaN);
        if (!Double.isNaN(overrideMass)) {
            c.setOverrideMass(overrideMass);
            c.setMassOverridden(true);
        }
        double overrideCGX = dbl(node, "overrideCGX", Double.NaN);
        if (!Double.isNaN(overrideCGX)) {
            c.setOverrideCGX(overrideCGX);
            c.setCGOverridden(true);
        }
        double overrideCD = dbl(node, "overrideCD", Double.NaN);
        if (!Double.isNaN(overrideCD)) {
            c.setOverrideCD(overrideCD);
            c.setCDOverridden(true);
        }
        // "Override for all subcomponents" flags (desktop .ork
        // <overridesubcomponents*> — the override replaces the whole subtree's
        // computed value, not just this component's).
        if (bool(node, "overrideSubcomponentsMass", false)) {
            c.setSubcomponentsOverriddenMass(true);
        }
        if (bool(node, "overrideSubcomponentsCG", false)) {
            c.setSubcomponentsOverriddenCG(true);
        }
        if (bool(node, "overrideSubcomponentsCD", false)) {
            c.setSubcomponentsOverriddenCD(true);
        }
        Map<String, Object> position = obj(node, "position");
        // Off-axis assemblies (PodSet/ParallelStage) have no parent here yet, and
        // their setAxialMethod NPEs without one — their position is applied
        // post-attach in applyAssembly. Every other component positions here.
        if (position != null && !(c instanceof ComponentAssembly)) {
            c.setAxialMethod(axialMethodOf(str(position, "method", "top")));
            c.setAxialOffset(dbl(position, "offset", 0));
        }
        return c;
    }

    /**
     * Deployment settings for recovery devices, applied to the DEFAULT
     * deployment configuration (inherited by every flight configuration).
     * Keys: deployEvent (launch|ejection|apogee|altitude|never),
     * deployAltitude (m AGL, for "altitude"), deployDelay (s).
     */
    private static void applyDeployment(RecoveryDevice device, Map<String, Object> node) {
        DeploymentConfiguration config = device.getDeploymentConfigurations().getDefault();
        String event = str(node, "deployEvent", null);
        if (event != null) {
            config.setDeployEvent(deployEventOf(event));
        }
        double altitude = dbl(node, "deployAltitude", Double.NaN);
        if (!Double.isNaN(altitude)) {
            config.setDeployAltitude(altitude);
        }
        double delay = dbl(node, "deployDelay", Double.NaN);
        if (!Double.isNaN(delay)) {
            config.setDeployDelay(delay);
        }
    }

    // The string-to-enum readers below take every name of the upstream enum,
    // case- and underscore-insensitive (the desktop writes them lowercased, as
    // `lower_stage_separation`), and REFUSE anything else. Defaulting an unknown
    // name silently changed the rocket: `crossSection:"diamond"` flew square fins,
    // `shape:"bogus"` an ogive nose (moving CP), `method:"nonsense"` put the part
    // at the top, and a desktop file's lower-stage-separation chute opened at
    // ejection instead. An ABSENT key still takes its default, at the call site.
    private static String enumKey(String name) {
        return name.toLowerCase().replace("_", "");
    }

    private static DeploymentConfiguration.DeployEvent deployEventOf(String name) {
        switch (enumKey(name)) {
            case "launch": return DeploymentConfiguration.DeployEvent.LAUNCH;
            case "ejection": return DeploymentConfiguration.DeployEvent.EJECTION;
            case "apogee": return DeploymentConfiguration.DeployEvent.APOGEE;
            case "altitude": return DeploymentConfiguration.DeployEvent.ALTITUDE;
            case "lowerstageseparation": return DeploymentConfiguration.DeployEvent.LOWER_STAGE_SEPARATION;
            case "never": return DeploymentConfiguration.DeployEvent.NEVER;
            default:
                throw new IllegalArgumentException("Unknown deploy event: '" + name + "' (expected one of launch, ejection, apogee, altitude, lower_stage_separation, never)");
        }
    }

    private static ExternalComponent.Finish finishOf(String name) {
        switch (enumKey(name)) {
            case "rough": return ExternalComponent.Finish.ROUGH;
            case "roughunfinished": return ExternalComponent.Finish.ROUGHUNFINISHED;
            case "unfinished": return ExternalComponent.Finish.UNFINISHED;
            case "normal":
            // The app's name for NORMAL in some files.
            case "regular": return ExternalComponent.Finish.NORMAL;
            case "smooth": return ExternalComponent.Finish.SMOOTH;
            case "polished": return ExternalComponent.Finish.POLISHED;
            case "finishpolished": return ExternalComponent.Finish.FINISHPOLISHED;
            case "optimum": return ExternalComponent.Finish.OPTIMUM;
            case "mirror": return ExternalComponent.Finish.MIRROR;
            default:
                throw new IllegalArgumentException("Unknown surface finish: '" + name + "' (expected one of rough, roughunfinished, unfinished, normal, smooth, polished, finishpolished, optimum, mirror)");
        }
    }

    /** Builds and attaches the node's children recursively. */
    static void attachChildren(RocketComponent parent, Map<String, Object> node,
            Map<String, RocketComponent> idIndex, Map<AxialStage, Double> nozzleDia) {
        List<Map<String, Object>> kids = JsonLite.objList(node, "children");
        for (Map<String, Object> kid : kids) {
            RocketComponent child = create(kid);
            parent.addChild(child);
            // Wall thickness of an AUTOMATIC-radius part (tube coupler, engine
            // block, tube fin) clamps against the outer radius, which is only
            // known post-attach — set in create() it would clamp to zero (zero
            // mass / zero wall). (Re)apply it here, now that the parent is set.
            applyWallThickness(child, kid);
            // Assemblies and fin tabs configure AFTER addChild (they read the
            // parent for reprojection / radius clamping). Guard on
            // ComponentAssembly, NOT RingInstanceable — FinSet/SymmetricComponent
            // ALSO implement RingInstanceable, and applyAssembly would clobber
            // their instance count with the pod default.
            if (child instanceof ComponentAssembly) {
                applyAssembly(child, kid, nozzleDia);
            }
            if (child instanceof FinSet) {
                applyFinTabs((FinSet) child, kid);
            }
            String id = str(kid, "id", null);
            if (id != null) {
                idIndex.put(id, child);
            }
            attachChildren(child, kid, idIndex, nozzleDia);
        }
    }

    /**
     * Fin tabs (through-the-wall mounting). Applied AFTER the fin set is
     * attached: setTabHeight() clamps against the parent body radius, which
     * is only known post-attach. Keys: tabHeight, tabLength (both > 0 to
     * enable), tabOffset, tabOffsetMethod (top|middle|bottom).
     */
    /**
     * (Re)apply the wall thickness of a part whose {@code setThickness} clamps
     * against the outer radius. For an automatic-radius part the radius is only
     * resolved after {@code addChild}, so a thickness applied in {@code create()}
     * clamped to zero. Idempotent for an explicit-radius part.
     */
    private static void applyWallThickness(RocketComponent child, Map<String, Object> node) {
        if (child instanceof TubeCoupler) {
            ((TubeCoupler) child).setThickness(dbl(node, "thickness", 0.0005));
        } else if (child instanceof EngineBlock) {
            ((EngineBlock) child).setThickness(dbl(node, "thickness", 0.00095));
        } else if (child instanceof TubeFinSet) {
            double th = dbl(node, "thickness", Double.NaN);
            if (!Double.isNaN(th)) {
                ((TubeFinSet) child).setThickness(th);
            }
        }
    }

    private static void applyFinTabs(FinSet fins, Map<String, Object> node) {
        double tabHeight = dbl(node, "tabHeight", 0);
        double tabLength = dbl(node, "tabLength", 0);
        if (tabHeight <= 0 || tabLength <= 0) {
            return;
        }
        fins.setTabOffsetMethod(axialMethodOf(str(node, "tabOffsetMethod", "middle")));
        fins.setTabLength(tabLength);
        fins.setTabOffset(dbl(node, "tabOffset", 0));
        fins.setTabHeight(tabHeight);
    }

    /**
     * PodSet / ParallelStage placement — MUST run AFTER parent.addChild(child):
     * setRadiusMethod/setAxialMethod read getParent() and NPE with no parent.
     * Radial uses OFFSET/GAP semantics (setRadiusMethod + setRadiusOffset), NEVER
     * setRadius(method,value) (which is radius-from-centerline and double-subtracts
     * the parent radius). PodSet.setAngleMethod is a no-op (pods are always
     * RELATIVE), so angleMethod is applied for parallelstage only. AFTER axial
     * method is downgraded by the kernel — the app never offers it.
     */
    private static void applyAssembly(RocketComponent child, Map<String, Object> node,
            Map<AxialStage, Double> nozzleDia) {
        RingInstanceable ring = (RingInstanceable) child;
        ring.setInstanceCount(count(node, "instanceCount", 2, MAX_INSTANCE_COUNT));
        ring.setRadiusMethod(radiusMethodOf(str(node, "radiusMethod", "relative")));
        ring.setRadiusOffset(dbl(node, "radiusOffset", 0)); // gap in metres, stored raw for RELATIVE/FREE
        ring.setAngleOffset(dbl(node, "angleOffset", 0));    // radians
        if (child instanceof ParallelStage) {
            ring.setAngleMethod(angleMethodOf(str(node, "angleMethod", "relative")));
        }
        Map<String, Object> position = obj(node, "position");
        if (position != null) {
            child.setAxialMethod(axialMethodOf(str(position, "method", "bottom")));
            child.setAxialOffset(dbl(position, "offset", 0));
        }
        if (child instanceof ParallelStage) {
            // A ParallelStage separates — reuse OpenRocketEngine's stage-separation
            // writer (same package, package-private). Passing nozzleDia so a booster
            // stage's nozzle exit diameter reaches its motor too.
            OpenRocketEngine.applySeparationConfig((AxialStage) child, node, nozzleDia);
        }
    }

    private static RadiusMethod radiusMethodOf(String name) {
        switch (enumKey(name)) {
            case "free": return RadiusMethod.FREE;
            case "surface": return RadiusMethod.SURFACE;
            case "coaxial": return RadiusMethod.COAXIAL;
            case "relative": return RadiusMethod.RELATIVE;
            default:
                throw new IllegalArgumentException("Unknown radius method: '" + name + "' (expected one of relative, free, surface, coaxial)");
        }
    }

    private static AngleMethod angleMethodOf(String name) {
        switch (enumKey(name)) {
            case "relative": return AngleMethod.RELATIVE;
            case "fixed": return AngleMethod.FIXED;
            case "mirrorxy": return AngleMethod.MIRROR_XY;
            default:
                throw new IllegalArgumentException("Unknown angle method: '" + name + "' (expected one of relative, fixed, mirror_xy)");
        }
    }

    /** Also the facade's reader for its own nose-cone builder (OpenRocketEngine). */
    static Transition.Shape shapeOf(String name) {
        switch (enumKey(name)) {
            case "conical": return Transition.Shape.CONICAL;
            case "ogive": return Transition.Shape.OGIVE;
            case "ellipsoid": return Transition.Shape.ELLIPSOID;
            case "power": return Transition.Shape.POWER;
            case "parabolic": return Transition.Shape.PARABOLIC;
            case "haack": return Transition.Shape.HAACK;
            default:
                throw new IllegalArgumentException("Unknown nose or transition shape: '" + name + "' (expected one of conical, ogive, ellipsoid, power, parabolic, haack)");
        }
    }

    /** OpenRocket's MassComponent.MassComponentType, by the .ork spelling. */
    private static MassComponent.MassComponentType massComponentTypeOf(String name) {
        switch (enumKey(name)) {
            case "masscomponent": return MassComponent.MassComponentType.MASSCOMPONENT;
            case "altimeter": return MassComponent.MassComponentType.ALTIMETER;
            case "flightcomputer": return MassComponent.MassComponentType.FLIGHTCOMPUTER;
            case "deploymentcharge": return MassComponent.MassComponentType.DEPLOYMENTCHARGE;
            case "tracker": return MassComponent.MassComponentType.TRACKER;
            case "payload": return MassComponent.MassComponentType.PAYLOAD;
            case "recoveryhardware": return MassComponent.MassComponentType.RECOVERYHARDWARE;
            case "battery": return MassComponent.MassComponentType.BATTERY;
            default:
                throw new IllegalArgumentException("Unknown mass component type: '" + name + "' (expected one of masscomponent, altimeter, flightcomputer, deploymentcharge, tracker, payload, recoveryhardware, battery)");
        }
    }

    private static FinSet.CrossSection crossSectionOf(String name) {
        switch (enumKey(name)) {
            case "square": return FinSet.CrossSection.SQUARE;
            case "rounded": return FinSet.CrossSection.ROUNDED;
            case "airfoil": return FinSet.CrossSection.AIRFOIL;
            default:
                throw new IllegalArgumentException("Unknown fin cross-section: '" + name + "' (expected one of square, rounded, airfoil)");
        }
    }

    private static AxialMethod axialMethodOf(String name) {
        switch (enumKey(name)) {
            case "top": return AxialMethod.TOP;
            case "middle": return AxialMethod.MIDDLE;
            case "bottom": return AxialMethod.BOTTOM;
            case "absolute": return AxialMethod.ABSOLUTE;
            // The app resolves `after` to `top` when it loads an .ork, but a tree
            // that still carries it means OpenRocket's AFTER, not TOP.
            case "after": return AxialMethod.AFTER;
            default:
                throw new IllegalArgumentException("Unknown position method: '" + name + "' (expected one of top, middle, bottom, absolute, after)");
        }
    }
}
