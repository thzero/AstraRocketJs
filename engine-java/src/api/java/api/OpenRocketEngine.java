package api;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.teavm.jso.JSExport;

import info.openrocket.core.aerodynamics.AerodynamicForces;
import info.openrocket.core.aerodynamics.BarrowmanCalculator;
import info.openrocket.core.aerodynamics.RASAeroStabilityCalculator;
import info.openrocket.core.aerodynamics.RASAeroDragCalculator;
import info.openrocket.core.aerodynamics.FlightConditions;
import info.openrocket.core.unit.CaliberUnit;
import info.openrocket.core.unit.PercentageOfLengthUnit;
import info.openrocket.core.document.Simulation;
import info.openrocket.core.logging.WarningSet;
import info.openrocket.core.masscalc.MassCalculator;
import info.openrocket.core.masscalc.RigidBody;
import info.openrocket.core.models.atmosphere.ExtendedISAModel;
import info.openrocket.core.models.gravity.ConstantGravityModel;
import info.openrocket.core.models.gravity.WGSGravityModel;
import info.openrocket.core.models.wind.PinkNoiseWindModel;
import info.openrocket.core.models.wind.MultiLevelPinkNoiseWindModel;
import info.openrocket.core.models.wind.WindModel;
import info.openrocket.core.motor.IgnitionEvent;
import info.openrocket.core.motor.Manufacturer;
import info.openrocket.core.motor.Motor;
import info.openrocket.core.motor.MotorConfiguration;
import info.openrocket.core.motor.ThrustCurveMotor;
import info.openrocket.core.rocketcomponent.AxialStage;
import info.openrocket.core.rocketcomponent.BodyTube;
import info.openrocket.core.rocketcomponent.ComponentAssembly;
import info.openrocket.core.rocketcomponent.FlightConfiguration;
import info.openrocket.core.rocketcomponent.FlightConfigurationId;
import info.openrocket.core.rocketcomponent.InnerTube;
import info.openrocket.core.rocketcomponent.MotorMount;
import info.openrocket.core.rocketcomponent.NoseCone;
import info.openrocket.core.rocketcomponent.Parachute;
import info.openrocket.core.rocketcomponent.Rocket;
import info.openrocket.core.rocketcomponent.RocketComponent;
import info.openrocket.core.rocketcomponent.StageSeparationConfiguration;
import info.openrocket.core.rocketcomponent.Transition;
import info.openrocket.core.rocketcomponent.TrapezoidFinSet;
import info.openrocket.core.simulation.BasicEventSimulationEngine;
import info.openrocket.core.simulation.FlightData;
import info.openrocket.core.simulation.FlightDataBranch;
import info.openrocket.core.simulation.FlightDataType;
import info.openrocket.core.simulation.FlightEvent;
import info.openrocket.core.simulation.SimulationConditions;
import info.openrocket.core.simulation.exception.SimulationException;
import info.openrocket.core.material.Material;
import info.openrocket.core.util.Coordinate;
import info.openrocket.core.utils.MotorCorrelation;
import info.openrocket.core.util.CoordinateIF;
import info.openrocket.core.util.GeodeticComputationStrategy;
import info.openrocket.core.util.WorldCoordinate;

/**
 * JS-facing engine facade (@JSExport). Handle-based API: components live in
 * a registry and are addressed by integer handles; parameters are primitives
 * or arrays; results are JSON strings (built by hand, since the kernel has no
 * JSON library). All values SI (meters, kilograms, seconds, newtons), angles
 * in radians; conversions belong to the caller. Documented exceptions:
 * launchLatitude/launchLongitude are degrees (WorldCoordinate's own unit)
 * and getAeroSweep's aoaDeg is degrees (converted here).
 */
public final class OpenRocketEngine {

    /** A sweep beyond this many Mach points is a caller error, not a request. */
    private static final int MAX_SWEEP_POINTS = 20000;

    private static final Map<Integer, Object> HANDLES = new HashMap<>();
    private static int nextHandle = 1;

    private OpenRocketEngine() {}

    /**
     * TeaVM entry point for the production build. Intentionally empty: OpenRocketEngine only
     * needs to be the configured mainClass so it stays reachable and its @JSExport statics
     * survive dead-code elimination. The JVM↔JS parity harness ({@code parity.ParityMain}) is
     * reached through {@link #runParity()} rather than as a mainClass of its own.
     */
    public static void main(String[] args) {
    }

    /**
     * Runs the parity scenarios, printing each result line to standard output.
     * <p>
     * In the shipped engine so that test/parity/parity.mjs can run the vendored
     * .mjs and .wasm themselves against the JVM reference, rather than a separate
     * harness build with its own entry point and link set. The app never calls
     * it, and in the browser its output goes to the kernel log sink, which drops it.
     */
    @JSExport
    public static void runParity() {
        parity.ParityMain.main(new String[0]);
    }

    private static int register(Object o) {
        // Never wraps: a wrapped counter would hand out an id still in use.
        if (nextHandle == Integer.MAX_VALUE) {
            throw new IllegalStateException("handle ids exhausted; reload the engine");
        }
        int h = nextHandle++;
        HANDLES.put(h, o);
        return h;
    }

    /**
     * Releases one handle. reset() releases them all; this is for a caller that
     * builds more than one design without resetting, which would otherwise keep
     * every Rocket alive for the life of the module. A freed id stays unknown, as after
     * reset(). Component handles from the add* builders are released the same way.
     */
    @JSExport
    public static void free(int handle) {
        if (HANDLES.remove(handle) == null) {
            throw new IllegalArgumentException("Unknown handle " + handle);
        }
    }

    /** Double.isFinite, spelled out - TeaVM's classlib coverage of it varies. */
    private static boolean isFinite(double v) {
        return !Double.isNaN(v) && !Double.isInfinite(v);
    }

    // Guards for the addX builders, which take their numbers straight from the
    // caller: unchecked, a NaN length surfaces as `Error: null`, a negative radius
    // builds a massless part with no error, and 1e9 fins become 8. Bounded like file input
    // (ComponentFactory.MAX_MAGNITUDE), and each names the argument it rejects.
    private static double finiteArg(String what, double v) {
        if (!isFinite(v) || Math.abs(v) > ComponentFactory.MAX_MAGNITUDE) {
            throw new IllegalArgumentException(what + " must be a finite number within +/-"
                    + ComponentFactory.MAX_MAGNITUDE + " (got " + v + ")");
        }
        return v;
    }

    private static double positiveArg(String what, double v) {
        if (!(finiteArg(what, v) > 0)) {
            throw new IllegalArgumentException(what + " must be greater than 0 (got " + v + ")");
        }
        return v;
    }

    private static double nonNegativeArg(String what, double v) {
        if (finiteArg(what, v) < 0) {
            throw new IllegalArgumentException(what + " must not be negative (got " + v + ")");
        }
        return v;
    }

    /**
     * The `{"error": ...}` envelope the JS side looks for.
     *
     * Every entry point that returns a JSON string has to produce one.
     * parseEnvelope in web/src/engine/openRocketEngine.ts checks `error` after
     * getStaticInfo, getComponentInfo, getAeroSweep, getComponentMasses and
     * simulateJson, so a method that throws out of TeaVM instead surfaces in JS
     * as an opaque throw from inside the bundle and JSON.parse never runs.
     *
     * Before adding an entry point, note that
     * `catch (RuntimeException e) { return errorJson(e); }` is not a safety net on
     * the target that ships.
     *
     * The engine compiles twice. TeaVM's JS backend converts a native JavaScript
     * error caught inside a Java `try` into a `java.lang.RuntimeException`, so a
     * stack overflow there is caught and does come back as an envelope. WASM-GC has
     * no equivalent: a wasm trap is not a `WebAssembly.Exception` carrying the
     * `teavm.javaException` tag, so no Java catch clause sees it and it unwinds
     * straight out of the module. The app loads WASM-GC by default and falls back to
     * JS, so the backend without the net is the one users run.
     *
     * With a 6000-deep options blob, JS returns
     * `{"error":"(JavaScript) RangeError: Maximum call stack size exceeded"}`;
     * WASM-GC throws a bare RangeError out of the module.
     *
     * A trap cannot be caught, so anything that can recurse, loop or allocate on
     * caller-supplied input must be bounded at the boundary. That is what
     * `JsonLite.MAX_DEPTH` and `MAX_INPUT_CHARS`, the `MAX_SWEEP_POINTS` integer
     * point count, and `ComponentFactory.count()` exist for. The envelope is for
     * reporting ordinary bad input, not for surviving exhaustion.
     *
     * `web/tests/engine/engineBoundary.wasm.test.ts` runs those bounds against the
     * WASM build so this stays checked rather than remembered.
     */
    private static String errorJson(Throwable e) {
        String msg = e.getMessage();
        if (msg == null || msg.isEmpty()) {
            msg = e.getClass().getSimpleName();
        }
        return "{\"error\":\"" + escape(msg) + "\"}";
    }

    private static Object get(int handle) {
        Object o = HANDLES.get(handle);
        if (o == null) {
            throw new IllegalArgumentException("Unknown handle: " + handle);
        }
        return o;
    }

    /**
     * A handle of a known kind.
     * <p>
     * Checked here rather than blind-cast at the call site: the wrapper's
     * generation counter catches a handle from a reset engine but never one of the
     * wrong type, and the engine compiles at {@code optimization = NONE}, where
     * TeaVM elides the checkcast. So passing a rocket handle to
     * {@code addTrapezoidFins} throws no ClassCastException at all; it uses the
     * wrong object and fails further in with
     * {@code $this.$checkState is not a function} on the JS target and a
     * null-message JavaError on WASM-GC.
     */
    private static <T> T get(int handle, Class<T> kind, String what) {
        Object o = get(handle);
        if (!kind.isInstance(o)) {
            throw new IllegalArgumentException("Handle " + handle + " is not " + what
                    + " (it is a " + o.getClass().getSimpleName() + ")");
        }
        return kind.cast(o);
    }

    /** Testing hook: the underlying Rocket for a rocket handle (harness use). */
    public static Rocket getRocketForTesting(int rocketHandle) {
        return get(rocketHandle, RocketCtx.class, "a rocket").rocket;
    }

    /** Frees every handle (rockets, components, motors). */
    @JSExport
    public static void reset() {
        // Clear, but do not rewind the counter. web/src/engine/api.ts resets
        // before every rebuild, and buildRocket registers exactly one object, so
        // a rewound counter would give the new design the same handle an
        // OpenRocketDesign from before the rebuild still carries. That stale
        // object would then return results for the new rocket with no error,
        // and get()'s unknown-handle check could never fire. A freed handle
        // stays permanently unknown.
        HANDLES.clear();
    }

    // ---------- Rocket construction ----------

    /** Creates a rocket with one stage and a dedicated flight configuration. Returns rocket handle. */
    @JSExport
    public static int newRocket() {
        Rocket rocket = new Rocket();
        AxialStage stage = new AxialStage();
        rocket.addChild(stage);
        FlightConfigurationId fcid = new FlightConfigurationId();
        rocket.createFlightConfiguration(fcid);
        rocket.setSelectedConfiguration(fcid);
        rocket.enableEvents();
        return register(new RocketCtx(rocket, stage, fcid));
    }

    /**
     * Builds a complete rocket from a JSON component tree:
     * { "name": "...", "components": [ {"type": "nosecone", "id": "n1", ...,
     *   "children": [...]}, ... ] }
     *
     * Multi-stage: the top level may instead be stage nodes:
     * { "components": [ {"type":"stage", "name":"Sustainer", "children":[...]},
     *   {"type":"stage", "name":"Booster", "separationEvent":"ejection",
     *    "separationDelay":0, "children":[...]} ] }
     * Stage 0 is the top (sustainer); order matches the desktop. A top level
     * without stage nodes means the children of one implicit stage. Mixing
     * stage and component nodes at the top level is an error.
     * separationEvent: launch|ignition|burnout|ejection|upperignition|
     * altitudeascending|apogee|altitudedescending|never (desktop default:
     * ejection).
     *
     * Components with an "id" can be addressed later (setMotorById).
     * Returns rocket handle; throws with a descriptive message on bad input.
     */
    @JSExport
    public static int buildRocket(String treeJson) {
        Map<String, Object> tree = JsonLite.parseObject(treeJson);
        Rocket rocket = new Rocket();
        String name = JsonLite.str(tree, "name", null);
        if (name != null) {
            rocket.setName(name);
        }

        Object comps = tree.get("components");
        // Present but not a list is an error, not an empty list: coerced,
        // buildRocket('{"components":"nope"}') would return a handle and report
        // a healthy all-zero rocket. Absent means an empty tree.
        if (comps != null && !(comps instanceof List)) {
            throw new IllegalArgumentException("'components' must be a list, got "
                    + comps.getClass().getSimpleName());
        }
        List<?> topLevel = comps instanceof List ? (List<?>) comps : java.util.Collections.emptyList();
        boolean staged = false;
        for (Object o : topLevel) {
            if (o instanceof Map && "stage".equals(((Map<?, ?>) o).get("type"))) {
                staged = true;
                break;
            }
        }

        Map<String, RocketComponent> ids = new HashMap<>();
        Map<AxialStage, Double> nozzleDia = new HashMap<>();
        AxialStage firstStage = null;
        if (staged) {
            for (Object o : topLevel) {
                if (!(o instanceof Map) || !"stage".equals(((Map<?, ?>) o).get("type"))) {
                    throw new IllegalArgumentException(
                            "Top level mixes stage and component nodes — with stages, EVERY top-level node must be a stage");
                }
                @SuppressWarnings("unchecked")
                Map<String, Object> stageNode = (Map<String, Object>) o;
                AxialStage stage = new AxialStage();
                String stageName = JsonLite.str(stageNode, "name", null);
                if (stageName != null) {
                    stage.setName(stageName);
                }
                rocket.addChild(stage);
                if (firstStage == null) {
                    firstStage = stage;
                }
                String stageId = JsonLite.str(stageNode, "id", null);
                if (stageId != null) {
                    ids.put(stageId, stage);
                }
                applySeparationConfig(stage, stageNode, nozzleDia);
                ComponentFactory.attachChildren(stage, stageNode, ids, nozzleDia);
            }
            if (firstStage == null) {
                throw new IllegalArgumentException("Staged rocket has no stages");
            }
        } else {
            firstStage = new AxialStage();
            rocket.addChild(firstStage);
        }

        FlightConfigurationId fcid = new FlightConfigurationId();
        rocket.createFlightConfiguration(fcid);
        rocket.setSelectedConfiguration(fcid);

        RocketCtx ctx = new RocketCtx(rocket, firstStage, fcid);
        ctx.ids.putAll(ids);
        ctx.nozzleDia.putAll(nozzleDia);
        if (!staged) {
            // The root node's "components" behave like children of the stage.
            Map<String, Object> stageNode = new java.util.LinkedHashMap<>();
            stageNode.put("children", tree.get("components"));
            ComponentFactory.attachChildren(firstStage, stageNode, ctx.ids, ctx.nozzleDia);
        }

        rocket.enableEvents();
        return register(ctx);
    }

    /**
     * Per-stage separation trigger/delay (defaults preserved when absent).
     * Package-private so ComponentFactory can reuse it for a parallelstage
     * (a ParallelStage is an AxialStage).
     */
    static void applySeparationConfig(AxialStage stage, Map<String, Object> stageNode,
            Map<AxialStage, Double> nozzleDia) {
        // Power-on base drag: per-stage nozzle exit diameter (meters). Upstream
        // models it per motor (MotorConfiguration.nozzleExitDiameter), so the
        // per-stage input is captured here and handed to the stage's motor in
        // applyMotor. Applies to every stage (incl. the sustainer). Absent/0 => power-off.
        double nozzleExitDiameter = JsonLite.dbl(stageNode, "nozzleExitDiameter", Double.NaN);
        if (!Double.isNaN(nozzleExitDiameter) && nozzleExitDiameter > 0) {
            nozzleDia.put(stage, nozzleExitDiameter);
        }

        String event = JsonLite.str(stageNode, "separationEvent", null);
        double delay = JsonLite.dbl(stageNode, "separationDelay", Double.NaN);
        double altitude = JsonLite.dbl(stageNode, "separationAltitude", Double.NaN);
        if (event == null && Double.isNaN(delay) && Double.isNaN(altitude)) {
            return;
        }
        // NaN is the "absent" sentinel above; an infinity is a real value that
        // would land in the event time. JsonLite already refuses a non-finite
        // literal, so this guards the callers that bypass it.
        if (!Double.isNaN(delay) && !isFinite(delay)) {
            throw new IllegalArgumentException("separationDelay must be finite (got " + delay + ")");
        }
        StageSeparationConfiguration sep = new StageSeparationConfiguration();
        if (event != null) {
            sep.setSeparationEvent(separationEventOf(event));
        }
        if (!Double.isNaN(delay)) {
            sep.setSeparationDelay(delay);
        }
        if (!Double.isNaN(altitude)) {
            sep.setSeparationAltitude(altitude);
        }
        // Default (not per-fcid): applies to the flight configuration created
        // right after the stages, and to any future one.
        stage.getSeparationConfigurations().setDefault(sep);
    }

    private static StageSeparationConfiguration.SeparationEvent separationEventOf(String name) {
        switch (name.toLowerCase().replace("_", "")) {
            case "launch": return StageSeparationConfiguration.SeparationEvent.LAUNCH;
            case "ignition": return StageSeparationConfiguration.SeparationEvent.IGNITION;
            case "burnout": return StageSeparationConfiguration.SeparationEvent.BURNOUT;
            case "ejection": return StageSeparationConfiguration.SeparationEvent.EJECTION;
            case "upperignition": return StageSeparationConfiguration.SeparationEvent.UPPER_IGNITION;
            case "altitudeascending": return StageSeparationConfiguration.SeparationEvent.ALTITUDE_ASCENDING;
            case "apogee": return StageSeparationConfiguration.SeparationEvent.APOGEE;
            case "altitudedescending": return StageSeparationConfiguration.SeparationEvent.ALTITUDE_DESCENDING;
            case "never": return StageSeparationConfiguration.SeparationEvent.NEVER;
            default:
                throw new IllegalArgumentException("Unknown separation event: " + name);
        }
    }

    /** Attaches a motor to the identified mount component (see buildRocket ids). */
    @JSExport
    public static void setMotorById(int rocketHandle, String componentId, String designation,
            double diameter, double length, double[] times, double[] thrusts,
            double[] masses, double cgX, double ejectionDelay) {
        RocketCtx ctx = get(rocketHandle, RocketCtx.class, "a rocket");
        RocketComponent comp = ctx.ids.get(componentId);
        // Inner tube or a body tube flagged as a mount (min-diameter rockets):
        // the kernel treats both through the MotorMount interface.
        if (!(comp instanceof MotorMount)) {
            throw new IllegalArgumentException(
                    "Component id '" + componentId + "' is not a motor mount");
        }
        applyMotor(ctx, (MotorMount) comp, designation, diameter, length,
                times, thrusts, masses, cgX, ejectionDelay);
    }

    /** shape: "ogive" | "conical" | "ellipsoid" | "power" | "parabolic" | "haack". Returns component handle. */
    @JSExport
    public static int addNoseCone(int rocketHandle, double length, double aftRadius,
            double thickness, String shape, double materialDensity) {
        RocketCtx ctx = get(rocketHandle, RocketCtx.class, "a rocket");
        if (shape == null) throw new IllegalArgumentException("addNoseCone: shape is required");
        positiveArg("addNoseCone length", length);
        positiveArg("addNoseCone aftRadius", aftRadius);
        nonNegativeArg("addNoseCone thickness", thickness);
        finiteArg("addNoseCone materialDensity", materialDensity);
        NoseCone nose = new NoseCone(ComponentFactory.shapeOf(shape), length, aftRadius);
        nose.setThickness(thickness);
        setBulkMaterial(nose, materialDensity);
        ctx.stage.addChild(nose);
        return register(nose);
    }

    /** Returns component handle (children like fins/mounts attach to it). */
    @JSExport
    public static int addBodyTube(int rocketHandle, double length, double outerRadius,
            double thickness, double materialDensity) {
        RocketCtx ctx = get(rocketHandle, RocketCtx.class, "a rocket");
        positiveArg("addBodyTube length", length);
        positiveArg("addBodyTube outerRadius", outerRadius);
        nonNegativeArg("addBodyTube thickness", thickness);
        finiteArg("addBodyTube materialDensity", materialDensity);
        BodyTube tube = new BodyTube(length, outerRadius, thickness);
        setBulkMaterial(tube, materialDensity);
        ctx.stage.addChild(tube);
        return register(tube);
    }

    @JSExport
    public static int addTrapezoidFins(int parentHandle, int finCount, double rootChord,
            double tipChord, double sweep, double height, double thickness, double materialDensity) {
        RocketComponent parent = get(parentHandle, RocketComponent.class, "a component");
        if (finCount < 1 || finCount > ComponentFactory.MAX_FIN_COUNT) {
            throw new IllegalArgumentException("addTrapezoidFins finCount must be a whole number in 1.."
                    + ComponentFactory.MAX_FIN_COUNT + " (got " + finCount + ")");
        }
        positiveArg("addTrapezoidFins rootChord", rootChord);
        nonNegativeArg("addTrapezoidFins tipChord", tipChord);
        finiteArg("addTrapezoidFins sweep", sweep);
        positiveArg("addTrapezoidFins height", height);
        nonNegativeArg("addTrapezoidFins thickness", thickness);
        finiteArg("addTrapezoidFins materialDensity", materialDensity);
        TrapezoidFinSet fins = new TrapezoidFinSet(finCount, rootChord, tipChord, sweep, height);
        fins.setThickness(thickness);
        setBulkMaterial(fins, materialDensity);
        parent.addChild(fins);
        return register(fins);
    }

    /** Motor mount tube. Returns mount handle for setMotor(). */
    @JSExport
    public static int addInnerTube(int parentHandle, double length, double outerRadius,
            double thickness, double materialDensity) {
        RocketComponent parent = get(parentHandle, RocketComponent.class, "a component");
        positiveArg("addInnerTube length", length);
        positiveArg("addInnerTube outerRadius", outerRadius);
        nonNegativeArg("addInnerTube thickness", thickness);
        finiteArg("addInnerTube materialDensity", materialDensity);
        InnerTube tube = new InnerTube();
        tube.setLength(length);
        tube.setOuterRadius(outerRadius);
        tube.setThickness(thickness);
        setBulkMaterial(tube, materialDensity);
        parent.addChild(tube);
        tube.setMotorMount(true);
        return register(tube);
    }

    @JSExport
    public static int addParachute(int parentHandle, double diameter, double dragCoefficient) {
        RocketComponent parent = get(parentHandle, RocketComponent.class, "a component");
        positiveArg("addParachute diameter", diameter);
        finiteArg("addParachute dragCoefficient", dragCoefficient);
        Parachute chute = new Parachute();
        chute.setDiameter(diameter);
        if (dragCoefficient > 0) {
            chute.setCD(dragCoefficient);
        }
        parent.addChild(chute);
        return register(chute);
    }

    // ---------- Motor ----------

    /**
     * Defines a motor from raw thrust-curve data and attaches it to a mount.
     * masses[] pairs with times[] (motor mass at each time point); cgX is the
     * (constant) CG position from the motor's nose.
     */
    @JSExport
    public static void setMotor(int rocketHandle, int mountHandle, String designation,
            double diameter, double length, double[] times, double[] thrusts,
            double[] masses, double cgX, double ejectionDelay) {
        RocketCtx ctx = get(rocketHandle, RocketCtx.class, "a rocket");
        MotorMount mount = get(mountHandle, MotorMount.class, "a motor mount");
        applyMotor(ctx, mount, designation, diameter, length,
                times, thrusts, masses, cgX, ejectionDelay);
    }

    private static void applyMotor(RocketCtx ctx, MotorMount mount, String designation,
            double diameter, double length, double[] times, double[] thrusts,
            double[] masses, double cgX, double ejectionDelay) {
        // At the boundary, not only in the JS wrapper. cgPoints is sized from
        // times.length and indexes masses[i], so a short masses array would
        // otherwise throw ArrayIndexOutOfBounds out of TeaVM with no envelope.
        if (times == null || thrusts == null || masses == null) {
            throw new IllegalArgumentException("motor " + designation + ": times/thrusts/masses are required");
        }
        if (times.length < 2 || thrusts.length != times.length || masses.length != times.length) {
            throw new IllegalArgumentException("motor " + designation + ": times/thrusts/masses must be the same"
                    + " length and at least 2 (got " + times.length + "/" + thrusts.length + "/" + masses.length + ")");
        }
        if (!(diameter > 0) || !(length > 0) || !isFinite(cgX)) {
            throw new IllegalArgumentException("motor " + designation + ": diameter/length must be > 0 and cgX finite");
        }
        for (int i = 0; i < times.length; i++) {
            if (!isFinite(times[i]) || !isFinite(thrusts[i]) || !isFinite(masses[i]) || masses[i] < 0) {
                throw new IllegalArgumentException("motor " + designation + ": non-finite or negative sample at " + i);
            }
            if (i > 0 && times[i] < times[i - 1]) {
                throw new IllegalArgumentException("motor " + designation + ": times must be non-decreasing at " + i);
            }
        }
        Coordinate[] cgPoints = new Coordinate[times.length];
        for (int i = 0; i < times.length; i++) {
            cgPoints[i] = new Coordinate(cgX, 0, 0, masses[i]);
        }
        ThrustCurveMotor motor = new ThrustCurveMotor.Builder()
                .setManufacturer(Manufacturer.getManufacturer("custom"))
                .setDesignation(designation)
                .setCommonName(designation)
                .setMotorType(Motor.Type.SINGLE)
                .setStandardDelays(new double[] { ejectionDelay })
                .setDiameter(diameter)
                .setLength(length)
                .setTimePoints(times)
                .setThrustPoints(thrusts)
                .setCGPoints(cgPoints)
                .setDigest("api-" + designation)
                .build();

        MotorConfiguration mc = new MotorConfiguration(mount, ctx.fcid);
        mc.setMotor(motor);
        mc.setEjectionDelay(ejectionDelay);
        // Power-on base drag: apply this stage's captured nozzle exit diameter
        // to the motor (upstream's native per-motor model). Upstream
        // rejects a nozzle wider than the motor, so clamp to the motor diameter
        // rather than throw and break the sim.
        Double nozzle = ctx.nozzleDia.get(((RocketComponent) mount).getStage());
        if (nozzle != null && nozzle > 0) {
            mc.setNozzleExitDiameter(Math.min(nozzle, diameter));
        }
        mount.setMotorConfig(mc, ctx.fcid);
        // Refresh the configuration's active-motor list so mass-based static analysis
        // (MassCalculator.calculateLaunch → getStaticInfo's loaded CG/stability) counts
        // this motor. setMotorConfig alone leaves the config's motors map stale (this
        // build path never fires the change event that would trigger updateMotors()), so
        // without this the on-pad CG/CP/stability reflect the unloaded rocket.
        ctx.rocket.getSelectedConfiguration().update();
    }

    /**
     * Overrides when the identified mount's motor ignites (call after
     * setMotorById). Default is "automatic": launch-stage motors light at
     * launch, upper-stage motors on the ejection charge of the stage below,
     * the low/mid-power pattern. High-power sustainers use electronics:
     * "burnout" or "launch" plus a timer delay.
     * ignitionEvent: automatic|launch|ejectioncharge|burnout|never.
     */
    @JSExport
    public static void setMotorIgnitionById(int rocketHandle, String componentId,
            String ignitionEvent, double ignitionDelay) {
        RocketCtx ctx = get(rocketHandle, RocketCtx.class, "a rocket");
        RocketComponent comp = ctx.ids.get(componentId);
        if (!(comp instanceof MotorMount)) {
            throw new IllegalArgumentException(
                    "Component id '" + componentId + "' is not a motor mount");
        }
        MotorConfiguration mc = ((MotorMount) comp).getMotorConfig(ctx.fcid);
        if (mc == null || mc.getMotor() == null) {
            throw new IllegalArgumentException(
                    "No motor loaded on mount '" + componentId + "' — call setMotorById first");
        }
        // At the boundary, like the motor curve in applyMotor. This method is
        // void, so a bad delay cannot come back as an envelope; unchecked, it
        // would go straight into the ignition time and every event after it.
        if (!isFinite(ignitionDelay)) {
            throw new IllegalArgumentException("ignitionDelay must be finite (got " + ignitionDelay + ")");
        }
        mc.setIgnitionEvent(ignitionEventOf(ignitionEvent));
        mc.setIgnitionDelay(ignitionDelay);
    }

    private static IgnitionEvent ignitionEventOf(String name) {
        switch (name.toLowerCase().replace("_", "")) {
            case "automatic": return IgnitionEvent.AUTOMATIC;
            case "launch": return IgnitionEvent.LAUNCH;
            case "ejectioncharge": return IgnitionEvent.EJECTION_CHARGE;
            case "burnout": return IgnitionEvent.BURNOUT;
            case "never": return IgnitionEvent.NEVER;
            default:
                throw new IllegalArgumentException("Unknown ignition event: " + name);
        }
    }

    /**
     * Leaves one stage on the ground for this flight configuration, or puts it
     * back in the flight.
     *
     * OpenRocket's stage activeness: an inactive stage contributes no mass, no
     * aerodynamics and no motor, which is how a two-stage design is flown as the
     * sustainer alone without deleting the booster. The flight configuration
     * owns the flag, so two configurations over one design can fly the whole
     * stack and the upper stage by itself.
     *
     * Addressed by component id like every other per-part call here, rather than
     * by the kernel's stage number: numbers are handed out in the order stages
     * are added, so a parallel booster nested in an early stage shifts the ones
     * after it, and the caller would have to reproduce that rule to be right.
     */
    @JSExport
    public static void setStageActiveById(int rocketHandle, String componentId, boolean active) {
        RocketCtx ctx = get(rocketHandle, RocketCtx.class, "a rocket");
        RocketComponent comp = ctx.ids.get(componentId);
        if (!(comp instanceof AxialStage)) {
            throw new IllegalArgumentException(
                    "Component id '" + componentId + "' is not a stage");
        }
        FlightConfiguration config = ctx.rocket.getSelectedConfiguration();
        config._setStageActive(((AxialStage) comp).getStageNumber(), active);
        // Same refresh applyMotor does: the configuration caches which motors and
        // component instances are active, and grounding a stage changes both.
        config.update();
    }

    // ---------- Analysis ----------

    /**
     * Opt-in "Rogers Modified Barrowman" body-in-presence-of-fins interference
     * (Kbf). When enabled, the displayed CP/stability and the flight
     * sim both include the body carryover load classic Barrowman drops, which
     * moves CP slightly aft and so raises the static margin shown. Aft is not
     * "conservative" - see the note in the FinSetCalc patch. Off by default; a
     * per-design setting.
     */
    @JSExport
    public static void setRogersModifiedBarrowman(int rocketHandle, boolean enabled) {
        get(rocketHandle, RocketCtx.class, "a rocket").rogersKbf = enabled;
    }

    /**
     * Opt-in stubby nose-cone drag correction: a subsonic pressure-drag floor
     * for short stored-table nose shapes (ellipsoid, power, parabolic, Haack),
     * which the classic model leaves with ~zero subsonic pressure drag. A
     * standalone correction (independent of the supersonic / Rogers models).
     * Off by default; off ⇒ bit-identical.
     * Applies to staticInfo, simulate and getAeroSweep.
     */
    @JSExport
    public static void setStubbyNoseDrag(int rocketHandle, boolean enabled) {
        get(rocketHandle, RocketCtx.class, "a rocket").stubbyNoseFloor = enabled;
    }

    /**
     * Opt-in RASAero supersonic aerodynamics: corrected
     * supersonic fin normal force, NACA-1307 body-fin interference, and
     * Mach-dependent nose CNa. Applies to staticInfo, simulate and getAeroSweep.
     */
    @JSExport
    public static void setSupersonicAero(int rocketHandle, boolean enabled) {
        get(rocketHandle, RocketCtx.class, "a rocket").supersonicAero = enabled;
    }

    /**
     * Build a BarrowmanCalculator wired with the design's opt-in RASAero
     * extensions (supersonicAero, rogersKbf) and the stubby-nose drag floor. With
     * all flags off this is bit-identical to a stock {@code new BarrowmanCalculator()},
     * so getStaticInfo / getAeroSweep / simulateJson all agree.
     */
    private static BarrowmanCalculator rasAeroCalculator(RocketCtx ctx) {
        RASAeroStabilityCalculator stab = new RASAeroStabilityCalculator();
        stab.setSupersonicAero(ctx.supersonicAero);
        stab.setRogersKbf(ctx.rogersKbf);
        RASAeroDragCalculator drag = new RASAeroDragCalculator();
        drag.setSupersonicAero(ctx.supersonicAero);
        drag.setRogersKbf(ctx.rogersKbf);
        drag.setStubbyNoseFloor(ctx.stubbyNoseFloor);
        return new BarrowmanCalculator(stab, drag);
    }

    /**
     * Static design info: length, mass, CG, CP (at Mach 0.3, AoA 0), stability
     * margin in calibers. "mass"/"cg" are launch values (motors loaded when
     * set); "massEmpty"/"cgEmpty" are the dry structure.
     */
    @JSExport
    public static String getStaticInfo(int rocketHandle) {
        try {
            return getStaticInfoImpl(rocketHandle);
        } catch (RuntimeException e) {
            return errorJson(e);
        }
    }

    private static String getStaticInfoImpl(int rocketHandle) {
        RocketCtx ctx = get(rocketHandle, RocketCtx.class, "a rocket");
        RigidBody structure = MassCalculator.calculateLaunch(ctx.rocket.getSelectedConfiguration());
        RigidBody empty = MassCalculator.calculateStructure(ctx.rocket.getSelectedConfiguration());

        BarrowmanCalculator calc = rasAeroCalculator(ctx);
        FlightConditions conditions = new FlightConditions(ctx.rocket.getSelectedConfiguration());
        conditions.setMach(0.3);
        conditions.setAOA(0);
        WarningSet warnings = new WarningSet();
        CoordinateIF cp = calc.getCP(ctx.rocket.getSelectedConfiguration(), conditions, warnings);
        // The geometry warnings (diameter discontinuity, open airframe forward,
        // zero-volume body, podset overlap) are raised by checkGeometry, which
        // getCP does not call. Without this the warning set comes back empty for
        // every design, however wrong: a nose cone four times the diameter of the
        // tube behind it reports nothing. Upstream's own UI calls both.
        calc.checkGeometry(ctx.rocket.getSelectedConfiguration(), ctx.rocket, warnings);

        double refDiameter = conditions.getRefLength(); // refLength is the reference diameter
        double cg = structure.getCM().getX();

        // The stability margin is a length (cp - cg); calibers and percent are two
        // ways of displaying it. Both conversions are OpenRocket's own unit
        // classes bound to the selected configuration, not arithmetic of ours,
        // because the two denominators are not what they look like:
        //
        //   CaliberUnit           -> the largest body diameter over the active
        //                            components (CaliberUnit.calculateCaliber).
        //   PercentageOfLengthUnit-> getLengthAerodynamic(), the span of the
        //                            aerodynamic components only, not
        //                            getLength(), which bounds every component.
        //
        // Dividing by the app's own `length` (all components) for the percentage
        // disagrees with the desktop on any design with a non-aerodynamic part
        // outside the aerodynamic envelope.
        FlightConfiguration config = ctx.rocket.getSelectedConfiguration();
        // A design whose length or mass is not a number is not a design the
        // figures below describe. Written out, each would serialize as null beside
        // `"warnings":0`, which the app paints as an empty, healthy rocket; an
        // error names it instead.
        requireFinite("length", ctx.rocket.getLength());
        requireFinite("mass", structure.getMass());
        double margin = cp.getX() - cg;
        double stabilityCal = new CaliberUnit(config).toUnit(margin);
        double stabilityPct = new PercentageOfLengthUnit(config).toUnit(margin);

        StringBuilder sb = new StringBuilder("{");
        num(sb, "length", ctx.rocket.getLength()).append(',');
        // The aerodynamic span, which is what the percentage is measured against.
        // Exported so a consumer can see the denominator rather than infer it.
        num(sb, "lengthAerodynamic", config.getLengthAerodynamic()).append(',');
        num(sb, "stabilityPercent", stabilityPct).append(',');
        num(sb, "mass", structure.getMass()).append(',');
        num(sb, "massEmpty", empty.getMass()).append(',');
        num(sb, "cgEmpty", empty.getCM().getX()).append(',');
        num(sb, "cg", cg).append(',');
        num(sb, "cp", cp.getX()).append(',');
        num(sb, "cna", cp.getWeight()).append(',');
        num(sb, "stabilityCalibers", stabilityCal).append(',');
        num(sb, "refDiameter", refDiameter).append(',');
        num(sb, "rollInertia", structure.getRotationalInertia()).append(',');
        num(sb, "pitchInertia", structure.getLongitudinalInertia()).append(',');
        num(sb, "warnings", warnings.size()).append(',');
        sb.append("\"warningTexts\":[");
        boolean first = true;
        for (info.openrocket.core.logging.Warning w : warnings) {
            if (!first) sb.append(',');
            first = false;
            sb.append('"').append(escape(String.valueOf(w))).append('"');
        }
        sb.append(']');
        return sb.append('}').toString();
    }

    /**
     * Per-component info for a buildRocket() id: length, own mass (override-
     * aware; a fin set's mass covers all its fins), subtree mass including
     * children, CG from the component's own front, and the component's
     * absolute position from the rocket nose (first instance).
     */
    @JSExport
    public static String getComponentInfo(int rocketHandle, String componentId) {
        try {
            return getComponentInfoImpl(rocketHandle, componentId);
        } catch (RuntimeException e) {
            return errorJson(e);
        }
    }

    private static String getComponentInfoImpl(int rocketHandle, String componentId) {
        RocketCtx ctx = get(rocketHandle, RocketCtx.class, "a rocket");
        RocketComponent c = ctx.ids.get(componentId);
        if (c == null) {
            throw new IllegalArgumentException("Unknown component id: '" + componentId + "'");
        }
        CoordinateIF[] locations = c.getComponentLocations();
        double absX = locations.length > 0 ? locations[0].getX() : Double.NaN;
        StringBuilder sb = new StringBuilder("{");
        num(sb, "length", c.getLength()).append(',');
        num(sb, "mass", c.getMass()).append(',');
        num(sb, "sectionMass", c.getSectionMass()).append(',');
        num(sb, "cgX", c.getCG().getX()).append(',');
        num(sb, "positionX", absX);
        return sb.append('}').toString();
    }

    /** Stations along a symmetric component at which its profile is sampled. */
    private static final int PROFILE_SAMPLES = 11;

    /**
     * The kernel's resolved geometry for a buildRocket() id: every radius after
     * the automatic rules have run, and a symmetric component's outer and inner
     * profile sampled at evenly spaced stations from its front.
     *
     * The app resolves the same radii itself to draw, mesh and export before a
     * run, so this is what those copies are tested against. Keys a component
     * does not have are left out.
     */
    @JSExport
    public static String getComponentGeometry(int rocketHandle, String componentId) {
        try {
            return getComponentGeometryImpl(rocketHandle, componentId);
        } catch (RuntimeException e) {
            return errorJson(e);
        }
    }

    private static String getComponentGeometryImpl(int rocketHandle, String componentId) {
        RocketCtx ctx = get(rocketHandle, RocketCtx.class, "a rocket");
        RocketComponent c = ctx.ids.get(componentId);
        if (c == null) {
            throw new IllegalArgumentException("Unknown component id: '" + componentId + "'");
        }
        StringBuilder sb = new StringBuilder("{");
        num(sb, "length", c.getLength());
        if (c instanceof info.openrocket.core.rocketcomponent.SymmetricComponent) {
            info.openrocket.core.rocketcomponent.SymmetricComponent s =
                    (info.openrocket.core.rocketcomponent.SymmetricComponent) c;
            sb.append(',');
            num(sb, "foreRadius", s.getForeRadius()).append(',');
            num(sb, "aftRadius", s.getAftRadius()).append(',');
            double[] outer = new double[PROFILE_SAMPLES];
            double[] inner = new double[PROFILE_SAMPLES];
            for (int i = 0; i < PROFILE_SAMPLES; i++) {
                double x = s.getLength() * i / (PROFILE_SAMPLES - 1);
                outer[i] = s.getRadius(x);
                inner[i] = s.getInnerRadius(x);
            }
            sb.append("\"profile\":");
            nums(sb, outer).append(",\"innerProfile\":");
            nums(sb, inner);
        }
        if (c instanceof BodyTube) {
            sb.append(',');
            num(sb, "outerRadius", ((BodyTube) c).getOuterRadius()).append(',');
            num(sb, "innerRadius", ((BodyTube) c).getInnerRadius());
        }
        if (c instanceof info.openrocket.core.rocketcomponent.RingComponent) {
            info.openrocket.core.rocketcomponent.RingComponent r =
                    (info.openrocket.core.rocketcomponent.RingComponent) c;
            sb.append(',');
            num(sb, "outerRadius", r.getOuterRadius()).append(',');
            num(sb, "innerRadius", r.getInnerRadius());
        }
        if (c instanceof info.openrocket.core.rocketcomponent.TubeFinSet) {
            info.openrocket.core.rocketcomponent.TubeFinSet t = (info.openrocket.core.rocketcomponent.TubeFinSet) c;
            sb.append(',');
            num(sb, "outerRadius", t.getOuterRadius()).append(',');
            num(sb, "innerRadius", t.getInnerRadius());
        }
        if (c instanceof info.openrocket.core.rocketcomponent.FinSet) {
            sb.append(',');
            num(sb, "maxTabHeight", ((info.openrocket.core.rocketcomponent.FinSet) c).getMaxTabHeight());
        }
        if (c instanceof info.openrocket.core.rocketcomponent.MassObject) {
            sb.append(',');
            num(sb, "radius", ((info.openrocket.core.rocketcomponent.MassObject) c).getRadius());
        }
        return sb.append('}').toString();
    }

    /**
     * Per-component mass breakdown: each instance's mass, the aggregate mass of
     * all instances, and the aggregate CG.
     *
     * Its own call rather than a field on {@link #getStaticInfo}, which runs on
     * every keystroke, and not part of the drag sweep, which is swept over Mach
     * while mass does not vary with speed. Mirrors the desktop's Component
     * Analysis "Stability" tab, which reads the same
     * {@code MassCalculator.getCMAnalysis}.
     */
    @JSExport
    public static String getComponentMasses(int rocketHandle) {
        try {
            return getComponentMassesImpl(rocketHandle);
        } catch (RuntimeException e) {
            return errorJson(e);
        }
    }

    private static String getComponentMassesImpl(int rocketHandle) {
        RocketCtx ctx = get(rocketHandle, RocketCtx.class, "a rocket");
        java.util.Map<Integer, info.openrocket.core.masscalc.CMAnalysisEntry> analysis =
                info.openrocket.core.masscalc.MassCalculator.getCMAnalysis(
                        ctx.rocket.getSelectedConfiguration());

        // Row order must not depend on HashMap iteration. getCMAnalysis returns a
        // Map keyed by component.hashCode(), and RocketComponent.hashCode() hashes
        // a per-run random UUID, so map order differs on every run, and again
        // between JVM and TeaVM. Emit in tree order,
        // the order the component tree beside it already shows, and put the
        // entries with no component behind them (the motor rows) last, by name.
        java.util.Map<String, info.openrocket.core.masscalc.CMAnalysisEntry> byKey =
                new java.util.LinkedHashMap<>();
        java.util.List<info.openrocket.core.masscalc.CMAnalysisEntry> motorRows = new java.util.ArrayList<>();
        for (info.openrocket.core.masscalc.CMAnalysisEntry e : analysis.values()) {
            if (e.name == null) {
                continue;
            }
            if (e.source instanceof RocketComponent) {
                byKey.put(((RocketComponent) e.source).getID().toString(), e);
            } else {
                motorRows.add(e);
            }
        }
        java.util.List<info.openrocket.core.masscalc.CMAnalysisEntry> ordered = new java.util.ArrayList<>();
        java.util.Iterator<RocketComponent> walk = ctx.rocket.iterator(true);
        while (walk.hasNext()) {
            info.openrocket.core.masscalc.CMAnalysisEntry e = byKey.remove(walk.next().getID().toString());
            if (e != null) {
                ordered.add(e);
            }
        }
        ordered.addAll(byKey.values()); // any component entry the walk did not reach
        motorRows.sort(java.util.Comparator.comparing(x -> x.name));
        ordered.addAll(motorRows);

        StringBuilder sb = new StringBuilder("[");
        boolean first = true;
        for (info.openrocket.core.masscalc.CMAnalysisEntry e : ordered) {
            CoordinateIF cm = e.totalCM;
            double mass = (cm == null || cm.isNaN()) ? 0 : cm.getWeight();
            double cg = (cm == null || cm.isNaN()) ? 0 : cm.getX();
            if (!first) sb.append(',');
            first = false;
            // Same stable key the aero sweep emits, so the mass columns join to
            // the right row even when two parts share a name. `source` is the
            // RocketComponent for a component entry (it is a MotorConfiguration
            // for the motor rows, which have no aero row to join to).
            String key = (e.source instanceof RocketComponent) ? ((RocketComponent) e.source).getID().toString() : "";
            sb.append("{\"key\":\"").append(escape(key)).append('"');
            sb.append(",\"name\":\"").append(escape(e.name)).append('"');
            sb.append(",\"eachMass\":").append(num(zeroIfNaN(e.eachMass)));
            sb.append(",\"mass\":").append(num(zeroIfNaN(mass)));
            sb.append(",\"cg\":").append(num(zeroIfNaN(cg)));
            sb.append('}');
        }
        return sb.append(']').toString();
    }

    /** One JSON number, with non-finite values written as 0 rather than NaN. */
    private static String num(double v) {
        return (Double.isNaN(v) || Double.isInfinite(v)) ? "0" : Double.toString(v);
    }

    /**
     * The wind direction that puts the CP furthest forward: the desktop's
     * "Worst" button.
     *
     * A rocket is least stable at some angle about its roll axis, and for a
     * three-fin design that angle is not zero. `getWorstCP` sweeps theta itself
     * and mutates the conditions it was handed, so this hands it a throwaway and
     * reads the answer back out. Returns degrees, to match `thetaDeg` in the
     * sweep options.
     *
     * @param machValue Mach to evaluate at
     * @param aoaDeg    angle of attack, degrees
     */
    @JSExport
    public static double getWorstThetaDeg(int rocketHandle, double machValue, double aoaDeg) {
        RocketCtx ctx = get(rocketHandle, RocketCtx.class, "a rocket");
        // A NaN Mach would return 0 degrees, a plausible-looking answer to a broken question.
        nonNegativeArg("getWorstThetaDeg mach", machValue);
        finiteArg("getWorstThetaDeg aoaDeg", aoaDeg);
        FlightConfiguration config = ctx.rocket.getSelectedConfiguration();
        FlightConditions conditions = new FlightConditions(config);
        conditions.setMach(machValue);
        conditions.setAOA(Math.toRadians(aoaDeg));
        rasAeroCalculator(ctx).getWorstCP(config, conditions, new WarningSet());
        return Math.toDegrees(conditions.getTheta());
    }

    /**
     * The length unit the user works in ("mm", "cm", "m", "in" or "ft").
     *
     * The kernel decides an airframe diameter step, gap or overlap by comparing
     * the two values as display strings in this unit
     * (BarrowmanStabilityCalculator's DIAMETER_DISCONTINUITY, AIRFRAME_GAP and
     * AIRFRAME_OVERLAP checks), as desktop does in the unit its user has chosen.
     * Left at the kernel's default, centimeters, an inch user is warned only at a
     * step several times larger than desktop in inches warns at
     * (openrocket/openrocket#3285). Only string formatting reads this; no number
     * the kernel computes depends on it. An unknown symbol keeps the unit.
     */
    @JSExport
    public static void setLengthUnit(String symbol) {
        try {
            info.openrocket.core.unit.UnitGroup.UNITS_LENGTH.setDefaultUnit(symbol);
        } catch (IllegalArgumentException e) {
            // Keep the current unit.
        }
    }

    /**
     * The pressure of OpenRocket's standard atmosphere at an altitude, in Pa.
     *
     * For the launch panel's check on a typed pressure: weather sources quote
     * pressure reduced to sea level, while the launch pressure is the pressure at
     * the site, so a sea-level figure typed at a high site reads far above this.
     * Taken from the kernel's own model so the app holds no second atmosphere.
     *
     * @param altitude meters above sea level
     */
    @JSExport
    public static double getStandardPressure(double altitude) {
        finiteArg("getStandardPressure altitude", altitude);
        return new ExtendedISAModel().getConditions(altitude).getPressure();
    }

    /**
     * How alike two thrust curves are, 0 to 1: the kernel's
     * `MotorCorrelation.similarity`, which desktop's motor chooser uses to
     * hide a motor's near-duplicate curves ("Hide very similar thrust curves",
     * at 0.95). It reads thrust only, so the motors are built with a nominal
     * size and mass that do not enter the result.
     */
    @JSExport
    public static double getMotorSimilarity(double[] times1, double[] thrusts1, double[] times2, double[] thrusts2) {
        return MotorCorrelation.similarity(curveMotor("a", times1, thrusts1), curveMotor("b", times2, thrusts2));
    }

    /** A thrust-curve motor carrying only the curve, for comparing curves. */
    private static ThrustCurveMotor curveMotor(String name, double[] times, double[] thrusts) {
        if (times == null || thrusts == null || times.length < 2 || thrusts.length != times.length) {
            throw new IllegalArgumentException("motor similarity " + name + ": times/thrusts must be the same length and at least 2");
        }
        Coordinate[] cg = new Coordinate[times.length];
        for (int i = 0; i < times.length; i++) {
            if (!isFinite(times[i]) || !isFinite(thrusts[i]) || thrusts[i] < 0) {
                throw new IllegalArgumentException("motor similarity " + name + ": non-finite or negative sample at " + i);
            }
            if (i > 0 && times[i] < times[i - 1]) {
                throw new IllegalArgumentException("motor similarity " + name + ": times must be non-decreasing at " + i);
            }
            cg[i] = new Coordinate(0.05, 0, 0, 0.1);
        }
        return new ThrustCurveMotor.Builder()
                .setManufacturer(Manufacturer.getManufacturer("custom"))
                .setDesignation(name)
                .setCommonName(name)
                .setMotorType(Motor.Type.SINGLE)
                .setStandardDelays(new double[] { 0 })
                .setDiameter(0.029)
                .setLength(0.1)
                .setTimePoints(times)
                .setThrustPoints(thrusts)
                .setCGPoints(cg)
                .setDigest("similarity-" + name)
                .build();
    }

    /**
     * Drag polar sweep (RASAero-style Aero Plots). For each Mach across the
     * requested range it returns total CD plus the friction / pressure / base
     * split, for both power-off (coast) and power-on (all stages thrusting,
     * with the nozzle-exit base-drag reduction), CP and CNa, and a per-component
     * power-off breakdown. Zero-alpha by default. This is a static design
     * property (no flight needed).
     *
     * Options JSON: { machMin=0.05, machMax=3.0, machStep=0.05, aoaDeg=0,
     *                 thetaDeg=0, rollRate=0, machAlt }.
     * Returns: { machs:[], hasNozzle:bool, nonFinite:int, cp[], cna[],
     *            powerOff:{total[],friction[],pressure[],base[]},
     *            powerOn:{...}, components:[{key,name,cd[],...}...] }.
     * The underlying method is Extended Barrowman: accurate subsonic/
     * transonic, degrading above ~Mach 1.5-2 unless the opt-in supersonic
     * model is on. The UI labels the supersonic region accordingly.
     */
    @JSExport
    public static String getAeroSweep(int rocketHandle, String optionsJson) {
        try {
            return getAeroSweepImpl(rocketHandle, optionsJson);
        } catch (RuntimeException e) {
            return errorJson(e);
        }
    }

    private static String getAeroSweepImpl(int rocketHandle, String optionsJson) {
        RocketCtx ctx = get(rocketHandle, RocketCtx.class, "a rocket");
        FlightConfiguration config = ctx.rocket.getSelectedConfiguration();
        Map<String, Object> o = JsonLite.parseObject(optionsJson);
        double machMin = JsonLite.dbl(o, "machMin", 0.05);
        double machMax = JsonLite.dbl(o, "machMax", 3.0);
        double machStep = JsonLite.dbl(o, "machStep", 0.05);
        double aoa = Math.toRadians(JsonLite.dbl(o, "aoaDeg", 0));
        // Wind direction about the roll axis, and the roll rate itself. Both
        // default to zero. Roll rate matters for the roll damping coefficient,
        // which is proportional to it and therefore reads zero without one.
        double theta = Math.toRadians(JsonLite.dbl(o, "thetaDeg", 0));
        double rollRate = JsonLite.dbl(o, "rollRate", 0);
        // Absent or non-positive means "use the default", which the JS side
        // relies on. NaN cannot reach here (JsonLite rejects non-finite
        // literals) but is folded in for callers that bypass it.
        if (Double.isNaN(machStep) || machStep <= 0) {
            machStep = 0.05;
        }
        // machMin/machMax need their own guard: unchecked, {"machMax":1e9}
        // builds a list of 2e10 entries and exhausts the heap with no error.
        if (!isFinite(machMin) || !isFinite(machMax) || machMax < machMin) {
            throw new IllegalArgumentException(
                    "aero sweep needs finite machMin <= machMax (got " + machMin + ".." + machMax + ")");
        }
        // Count the points as an integer before believing the guard. When
        // machMin == machMax the span is 0, so any step passes a span-only
        // check, and a step below ulp(machMin) would never advance an
        // accumulating loop. machMin == machMax is a real call pattern
        // (services/design/buildRocket.ts asks for a single Mach).
        if (!isFinite(machStep) || machStep <= 0) {
            throw new IllegalArgumentException("aero sweep needs a finite machStep > 0 (got " + machStep + ")");
        }
        // Judge the quotient as a double before casting it. Finite inputs can
        // still make it infinite (machStep 5e-324, or a span wider than a
        // double), and `(long) Infinity` is Long.MAX_VALUE: the `+ 1` below
        // would wrap it negative and pass the `points > MAX` guard, giving an
        // empty sweep on WASM-GC and a RangeError on the JS target. A finite
        // quotient past the cap saturates the same way.
        final double quotient = (machMax - machMin) / machStep;
        if (!isFinite(quotient) || quotient > MAX_SWEEP_POINTS) {
            throw new IllegalArgumentException("aero sweep of " + machMin + ".." + machMax
                    + " step " + machStep + " needs "
                    + (isFinite(quotient) ? "about " + quotient : "an infinite number of")
                    + " points, over the " + MAX_SWEEP_POINTS + " limit");
        }
        final long points = (long) Math.floor(quotient) + 1;
        if (points > MAX_SWEEP_POINTS) {
            throw new IllegalArgumentException("aero sweep of " + machMin + ".." + machMax
                    + " step " + machStep + " needs " + points + " points, over the "
                    + MAX_SWEEP_POINTS + " limit");
        }

        // Indexed, not accumulated: `m += machStep` also drifts by summing
        // rounding error across the sweep, where machMin + i*machStep does not.
        int n = (int) points;
        java.util.List<Double> machList = new java.util.ArrayList<>(n);
        for (int i = 0; i < n; i++) {
            machList.add(machMin + i * machStep);
        }

        // Optional Reynolds matching: "machAlt": [[mach, altitude_m], ...] pins
        // the atmosphere (hence Re) per Mach point, linearly interpolated. The
        // validation harness uses it to match wind-tunnel Re/ft, the same
        // mechanism as RASAero's Mach-Alt table. Absent ⇒ ISA sea level.
        double[] maMach = null;
        double[] maAlt = null;
        Object maRaw = o.get("machAlt");
        if (maRaw != null && !(maRaw instanceof java.util.List)) {
            throw new IllegalArgumentException("'machAlt' should be a list of [mach, altitude] rows");
        }
        if (maRaw != null && !((java.util.List<?>) maRaw).isEmpty()) {
            java.util.List<?> rows = (java.util.List<?>) maRaw;
            maMach = new double[rows.size()];
            maAlt = new double[rows.size()];
            for (int i = 0; i < rows.size(); i++) {
                // Checked, not cast: an unchecked cast fails as a minified TeaVM
                // TypeError on the JS backend and a bare ClassCastException on
                // WASM, neither naming the field or the row.
                Object row = rows.get(i);
                if (!(row instanceof java.util.List) || ((java.util.List<?>) row).size() < 2
                        || !(((java.util.List<?>) row).get(0) instanceof Double)
                        || !(((java.util.List<?>) row).get(1) instanceof Double)) {
                    throw new IllegalArgumentException(
                            "'machAlt' row " + i + " should be [mach, altitude] numbers");
                }
                maMach[i] = (Double) ((java.util.List<?>) row).get(0);
                maAlt[i] = (Double) ((java.util.List<?>) row).get(1);
            }
        }
        ExtendedISAModel isa = (maMach != null) ? new ExtendedISAModel() : null;

        // Power-on base drag: per-assembly thrusting nozzle-exit areas of the
        // design's motors (upstream's native per-motor model). Mirrors
        // AbstractSimulationStepper.setThrustingNozzleExitAreas; the drag sweep is a
        // static analysis, so every motor is treated as thrusting (the power-on curve).
        // Read motors straight off the mounts (keyed by fcid): the FlightConfiguration's
        // motors map is derived via updateMotors(), which the setMotorById flow doesn't
        // trigger, so it can be stale here. (The flight sim is unaffected: it reads motors
        // through SimulationStatus, a separate runtime path.)
        java.util.Map<ComponentAssembly, Double> nozzleAreas = new java.util.HashMap<>();
        for (RocketComponent c : ctx.rocket) {
            if (!(c instanceof MotorMount) || !((MotorMount) c).isMotorMount()) {
                continue;
            }
            MotorConfiguration mc = ((MotorMount) c).getMotorConfig(ctx.fcid);
            if (mc == null) {
                continue;
            }
            double d = mc.getNozzleExitDiameter();
            if (d <= 0) {
                continue;
            }
            double area = mc.getMotorCount() * Math.PI * (d / 2) * (d / 2);
            nozzleAreas.merge(((MotorMount) c).getAssembly(), area, Double::sum);
        }
        boolean hasNozzle = !nozzleAreas.isEmpty();

        BarrowmanCalculator calc = rasAeroCalculator(ctx);
        WarningSet warnings = new WarningSet();

        double[] offTotal = new double[n], offFric = new double[n], offPress = new double[n], offBase = new double[n];
        double[] onTotal = new double[n], onFric = new double[n], onPress = new double[n], onBase = new double[n];
        // CP location (m from nose) and CNa (per rad) per Mach. Power state does
        // not affect them (thrust only changes base drag), so one set from fOff.
        // Feeds the validation harness (ARCAS/HB-2/Finner anchors).
        double[] cp = new double[n], cna = new double[n];
        // Per-component series. `getForceAnalysis` hands back the whole
        // AerodynamicForces for each component (the same object OpenRocket's
        // Component Analysis dialog tabulates), so the drag split and the
        // stability contribution cost nothing beyond reading more fields off a
        // call we already make.
        java.util.LinkedHashMap<String, double[]> byComp = new java.util.LinkedHashMap<>();
        java.util.LinkedHashMap<String, double[]> byCompInstance = new java.util.LinkedHashMap<>();
        java.util.LinkedHashMap<String, Integer> byCompCount = new java.util.LinkedHashMap<>();
        // Every map above is keyed on the component's UUID, not its name.
        // getName() is not unique: nothing forces a user to rename a part, and
        // an unnamed one takes its class default, so a two-tube rocket has two
        // components both called "Body tube". Keying on the name would merge
        // them into one row (drag summed, instance count last-wins, CP averaged
        // into a station belonging to neither). This holds the label to show.
        java.util.LinkedHashMap<String, String> byCompName = new java.util.LinkedHashMap<>();
        // The component's class, so the UI can tell a fin set from a body tube.
        // The roll table lists fin sets even when their coefficients are zero
        // (which is every uncanted rocket), and there is no way to tell from the
        // numbers alone, since an uncanted fin set reports exactly what a tube does.
        java.util.LinkedHashMap<String, String> byCompType = new java.util.LinkedHashMap<>();
        java.util.LinkedHashMap<String, double[]> byCompFric = new java.util.LinkedHashMap<>();
        java.util.LinkedHashMap<String, double[]> byCompPress = new java.util.LinkedHashMap<>();
        java.util.LinkedHashMap<String, double[]> byCompBase = new java.util.LinkedHashMap<>();
        java.util.LinkedHashMap<String, double[]> byCompRollF = new java.util.LinkedHashMap<>();
        java.util.LinkedHashMap<String, double[]> byCompRollD = new java.util.LinkedHashMap<>();
        java.util.LinkedHashMap<String, double[]> byCompCna = new java.util.LinkedHashMap<>();
        java.util.LinkedHashMap<String, double[]> byCompCp = new java.util.LinkedHashMap<>();

        int nonFinite = 0;

        for (int i = 0; i < n; i++) {
            double mach = machList.get(i);

            info.openrocket.core.models.atmosphere.AtmosphericConditions atm = null;
            if (isa != null) {
                double alt;
                if (mach <= maMach[0]) {
                    alt = maAlt[0];
                } else if (mach >= maMach[maMach.length - 1]) {
                    alt = maAlt[maAlt.length - 1];
                } else {
                    int j = 1;
                    while (maMach[j] < mach) {
                        j++;
                    }
                    double t = (mach - maMach[j - 1]) / (maMach[j] - maMach[j - 1]);
                    alt = maAlt[j - 1] + t * (maAlt[j] - maAlt[j - 1]);
                }
                atm = isa.getConditions(alt);
            }

            FlightConditions off = new FlightConditions(config);
            if (atm != null) {
                off.setAtmosphericConditions(atm);
            }
            off.setMach(mach);
            off.setAOA(aoa);
            off.setTheta(theta);
            off.setRollRate(rollRate);
            AerodynamicForces fOff = calc.getAerodynamicForces(config, off, warnings);
            offTotal[i] = fOff.getCD();
            offFric[i] = fOff.getFrictionCD();
            offPress[i] = fOff.getPressureCD();
            offBase[i] = fOff.getBaseCD();
            CoordinateIF cpc = fOff.getCP();
            cp[i] = cpc.getX();
            cna[i] = cpc.getWeight();

            FlightConditions on = new FlightConditions(config);
            if (atm != null) {
                on.setAtmosphericConditions(atm);
            }
            on.setMach(mach);
            on.setAOA(aoa);
            on.setTheta(theta);
            on.setRollRate(rollRate);
            on.setThrustingNozzleExitAreas(nozzleAreas);
            AerodynamicForces fOn = calc.getAerodynamicForces(config, on, warnings);
            onTotal[i] = fOn.getCD();
            onFric[i] = fOn.getFrictionCD();
            onPress[i] = fOn.getPressureCD();
            onBase[i] = fOn.getBaseCD();

            // Per-component power-off breakdown (skip the aggregate assembly nodes).
            Map<RocketComponent, AerodynamicForces> offMap = calc.getForceAnalysis(config, off, warnings);
            for (Map.Entry<RocketComponent, AerodynamicForces> e : offMap.entrySet()) {
                RocketComponent c = e.getKey();
                if (!c.isAerodynamic() || c instanceof ComponentAssembly) {
                    continue;
                }
                AerodynamicForces f = e.getValue();
                String name = c.getID().toString();
                byCompName.put(name, c.getName());
                // getCD() is per instance and getCDTotal() counts them all:
                // the desktop's "Per instance CD" and "Total CD" columns
                // (CAParameterSweep). `cd` has to be the total or a breakdown
                // does not add up: a 3-fin set would contribute a third of its drag.
                nonFinite += countNonFinite(f.getCDTotal(), f.getCD(), f.getFrictionCD(),
                        f.getPressureCD(), f.getBaseCD(), f.getCrollForce(), f.getCrollDamp());
                series(byComp, name, n)[i] += f.getCDTotal();
                series(byCompInstance, name, n)[i] += f.getCD();
                byCompCount.put(name, c.getInstanceCount());
                byCompType.put(name, c.getClass().getSimpleName());
                series(byCompFric, name, n)[i] += f.getFrictionCD();
                series(byCompPress, name, n)[i] += f.getPressureCD();
                series(byCompBase, name, n)[i] += f.getBaseCD();
                // Roll forcing and damping: non-zero only for a canted fin set,
                // which is exactly why they are worth showing: it is the one
                // way to tell a cant is doing what you meant it to.
                series(byCompRollF, name, n)[i] += f.getCrollForce();
                series(byCompRollD, name, n)[i] += f.getCrollDamp();
                // CP is a position, not a contribution: it is CNa-weighted, so
                // summing instances means summing the moment and dividing back
                // out. A component with no normal force has no CP to speak of.
                CoordinateIF fcp = f.getCP();
                nonFinite += countNonFinite(fcp.getWeight(), fcp.getX());
                double ccna = fcp.getWeight();
                series(byCompCna, name, n)[i] += ccna;
                series(byCompCp, name, n)[i] += fcp.getX() * ccna;
            }
        }

        // Non-finite readings swallowed on the way in. Null in a series says
        // "this cell is unusable", but a consumer summing a column coerces null
        // back to 0, so the count travels alongside, and the aero view can say
        // the breakdown is incomplete rather than quietly disagreeing with the
        // rocket totals.
        double[] machArr = new double[n];
        for (int i = 0; i < n; i++) {
            machArr[i] = machList.get(i);
        }

        StringBuilder sb = new StringBuilder("{\"machs\":");
        nums(sb, machArr);
        sb.append(",\"hasNozzle\":").append(hasNozzle);
        sb.append(",\"nonFinite\":").append(nonFinite);
        sb.append(",\"cp\":");
        nums(sb, cp);
        sb.append(",\"cna\":");
        nums(sb, cna);
        sb.append(",\"powerOff\":");
        dragBlock(sb, offTotal, offFric, offPress, offBase);
        sb.append(",\"powerOn\":");
        dragBlock(sb, onTotal, onFric, onPress, onBase);
        sb.append(",\"components\":[");
        boolean first = true;
        for (Map.Entry<String, double[]> e : byComp.entrySet()) {
            if (!first) sb.append(',');
            first = false;
            String name = e.getKey();
            // `key` is the stable identity (rows, joins); `name` is only a label.
            sb.append("{\"key\":\"").append(escape(name)).append('"');
            sb.append(",\"name\":\"").append(escape(byCompName.get(name))).append("\",\"cd\":");
            nums(sb, e.getValue());
            sb.append(",\"cdInstance\":");
            nums(sb, byCompInstance.get(name));
            sb.append(",\"instances\":").append(byCompCount.getOrDefault(name, 1));
            sb.append(",\"type\":\"").append(escape(byCompType.getOrDefault(name, ""))).append('"');
            sb.append(",\"friction\":");
            nums(sb, byCompFric.get(name));
            sb.append(",\"pressure\":");
            nums(sb, byCompPress.get(name));
            sb.append(",\"base\":");
            nums(sb, byCompBase.get(name));
            sb.append(",\"rollForce\":");
            nums(sb, byCompRollF.get(name));
            sb.append(",\"rollDamp\":");
            nums(sb, byCompRollD.get(name));
            sb.append(",\"cna\":");
            nums(sb, byCompCna.get(name));
            sb.append(",\"cp\":");
            // Un-weight the CNa-weighted moment accumulated above; a component
            // with no normal force reports 0 rather than a divide-by-zero.
            double[] cnaRow = byCompCna.get(name);
            double[] cpRow = byCompCp.get(name);
            double[] cpOut = new double[n];
            for (int i = 0; i < n; i++) {
                // A NaN weight takes this branch (NaN != 0) and divides out to
                // NaN, which nums() writes as null, distinct from the genuine
                // "no normal force, hence no CP" zero on the other side.
                cpOut[i] = cnaRow[i] != 0 ? cpRow[i] / cnaRow[i] : 0;
            }
            nums(sb, cpOut);
            sb.append('}');
        }
        sb.append("]}");
        return sb.toString();
    }

    /** The named component's series, created on first sight. */
    private static double[] series(java.util.Map<String, double[]> map, String name, int n) {
        double[] row = map.get(name);
        if (row == null) {
            row = new double[n];
            map.put(name, row);
        }
        return row;
    }

    /** How many of these are NaN or infinite; see getAeroSweep's `nonFinite`. */
    private static int countNonFinite(double... vs) {
        int k = 0;
        for (double v : vs) {
            if (Double.isNaN(v) || Double.isInfinite(v)) k++;
        }
        return k;
    }

    private static double zeroIfNaN(double v) {
        return (Double.isNaN(v) || Double.isInfinite(v)) ? 0 : v;
    }

    private static void dragBlock(StringBuilder sb, double[] total, double[] fric, double[] press, double[] base) {
        sb.append("{\"total\":");
        nums(sb, total);
        sb.append(",\"friction\":");
        nums(sb, fric);
        sb.append(",\"pressure\":");
        nums(sb, press);
        sb.append(",\"base\":");
        nums(sb, base);
        sb.append('}');
    }

    private static StringBuilder nums(StringBuilder sb, double[] values) {
        sb.append('[');
        for (int i = 0; i < values.length; i++) {
            if (i > 0) sb.append(',');
            double v = values[i];
            sb.append((Double.isNaN(v) || Double.isInfinite(v)) ? "null" : Double.toString(v));
        }
        return sb.append(']');
    }

    // ---------- Simulation ----------

    /**
     * Runs a full flight simulation. Returns JSON:
     * { summary:{...}, events:[{type,time}...], series:{time[],altitude[],velocity[],acceleration[]} }
     */
    @JSExport
    public static String simulate(int rocketHandle, double launchRodLength, double launchRodAngle,
            double windAverage, double windStdDeviation, double launchAltitude, double timeStep) {
        // These are concatenated straight into JSON, and JsonLite.number()
        // accepts only [+-0123456789.eE], so a NaN would emit "windAverage":NaN
        // and fail the options parse with a message that names no option.
        double[] opts = { launchRodLength, launchRodAngle, windAverage, windStdDeviation, launchAltitude, timeStep };
        for (double v : opts) {
            if (!isFinite(v)) {
                return errorJson(new IllegalArgumentException("simulate: every option must be a finite number"));
            }
        }
        return simulateJson(rocketHandle, "{"
                + "\"rodLength\":" + launchRodLength + ",\"rodAngle\":" + launchRodAngle
                + ",\"windAverage\":" + windAverage + ",\"windStdDeviation\":" + windStdDeviation
                + ",\"launchAltitude\":" + launchAltitude + ",\"timeStep\":" + timeStep + "}");
    }

    /**
     * Full-featured simulation entry point. Options JSON (all optional):
     * { rodLength, rodAngle, rodDirection, windAverage, windStdDeviation,
     *   launchAltitude, launchLatitude, launchLongitude,
     *   temperature (K, launch-site), pressure (Pa, launch-site),
     *   timeStep, maxTime, randomSeed,
     *   series: "summary" (default) | "full" (see appendBranchSeries) }
     * Custom temperature/pressure switch the atmosphere to an ISA model based
     * at the launch site; otherwise standard ISA is used.
     */
    @JSExport
    public static String simulateJson(int rocketHandle, String optionsJson) {
        // The whole body, not just the simulate() call: the handle lookup and the
        // options parse have to be inside this try, or a stale handle or a
        // malformed options blob escapes as an opaque TeaVM throw out of the
        // bundle, and openRocketEngine.ts only inspects `error`.
        try {
            return simulateJsonImpl(rocketHandle, optionsJson);
        } catch (RuntimeException e) {
            return errorJson(e);
        }
    }

    private static String simulateJsonImpl(int rocketHandle, String optionsJson) {
        RocketCtx ctx = get(rocketHandle, RocketCtx.class, "a rocket");
        Map<String, Object> o = JsonLite.parseObject(optionsJson);

        double launchAltitude = JsonLite.dbl(o, "launchAltitude", 0);
        double temperature = JsonLite.dbl(o, "temperature", Double.NaN);
        double pressure = JsonLite.dbl(o, "pressure", Double.NaN);
        // Relative humidity as a fraction (0..1), like the kernel's own field.
        // Humidity lowers air density (water vapor is lighter than dry air),
        // which is small but not nothing on a marginal-stability flight.
        double humidity = JsonLite.dbl(o, "relativeHumidity", Double.NaN);
        double timeStep = JsonLite.dbl(o, "timeStep", 0.05);
        // Series payload mode. "summary" (default) emits the friendly dozen
        // plus only the symbol series the app's flight report reads on every
        // run; "full" adds the branch's whole recording. Serializing all ~60
        // series adds roughly 45% to single-sim wall clock, so full is
        // strictly opt-in.
        String seriesMode = JsonLite.str(o, "series", "summary");
        if (!"summary".equals(seriesMode) && !"full".equals(seriesMode)) {
            throw new IllegalArgumentException("Unknown series mode: " + seriesMode);
        }
        boolean fullSeries = "full".equals(seriesMode);

        SimulationConditions conditions = new SimulationConditions();
        conditions.setSimulation(new Simulation(ctx.rocket, ctx.fcid));
        conditions.setLaunchRodLength(JsonLite.dbl(o, "rodLength", 1.0));
        conditions.setLaunchRodAngle(JsonLite.dbl(o, "rodAngle", 0));
        conditions.setLaunchRodDirection(JsonLite.dbl(o, "rodDirection", Math.PI / 2));
        conditions.setLaunchSite(new WorldCoordinate(
                JsonLite.dbl(o, "launchLatitude", 28.61),
                JsonLite.dbl(o, "launchLongitude", -80.60),
                launchAltitude));
        conditions.setGeodeticComputation(geodeticOf(JsonLite.str(o, "geodetic", "spherical")));
        List<Map<String, Object>> atmosphereLevels = JsonLite.objList(o, "atmosphereLevels");
        if (atmosphereLevels != null && !atmosphereLevels.isEmpty()) {
            conditions.setAtmosphericModel(
                    atmosphereProfileOf(atmosphereLevels, launchAltitude, temperature, pressure, humidity));
        // Any one of the three is enough to leave standard ISA: humidity alone is
        // a real case (ISA temperature and pressure, a muggy field), and keying
        // this off temperature/pressure only would silently drop it.
        } else if (!Double.isNaN(temperature) || !Double.isNaN(pressure) || !Double.isNaN(humidity)) {
            // The 4-arg ExtendedISAModel (altitude, temp, pressure, humidity), so the
            // custom values are taken as the conditions at the launch altitude; the
            // 3-arg form has no altitude.
            conditions.setAtmosphericModel(new ExtendedISAModel(
                    launchAltitude,
                    Double.isNaN(temperature) ? ExtendedISAModel.STANDARD_TEMPERATURE : temperature,
                    Double.isNaN(pressure) ? ExtendedISAModel.STANDARD_PRESSURE : pressure,
                    Double.isNaN(humidity) ? ExtendedISAModel.STANDARD_RELATIVE_HUMIDITY : humidity));
        } else {
            conditions.setAtmosphericModel(new ExtendedISAModel());
        }
        // WGS (latitude- and altitude-dependent) unless asked for a constant g.
        // OpenRocket offers both; the constant one lets a design be checked
        // against a hand calculation at 9.80665.
        if ("constant".equalsIgnoreCase(JsonLite.str(o, "gravityModel", "wgs"))) {
            conditions.setGravityModel(new ConstantGravityModel(JsonLite.dbl(o, "constantGravity", 9.80665)));
        } else {
            conditions.setGravityModel(new WGSGravityModel());
        }
        // The RK4 stepper shortens its step so the rocket never rotates more
        // than this in one step. Absent, the kernel's RECOMMENDED_ANGLE_STEP
        // (3 degrees) applies.
        double maxAngleStep = JsonLite.dbl(o, "maxAngleStep", Double.NaN);
        if (!Double.isNaN(maxAngleStep) && maxAngleStep > 0) {
            conditions.setMaximumAngleStep(maxAngleStep);
        }
        BarrowmanCalculator aeroCalc = rasAeroCalculator(ctx);
        int randomSeed = (int) JsonLite.dbl(o, "randomSeed", 42);
        List<Map<String, Object>> windLevels = JsonLite.objList(o, "windLevels");
        if (windLevels != null && !windLevels.isEmpty()) {
            // Altitude-layered winds (multilevel profile): one pink-noise
            // sub-model per level; the kernel interpolates between levels by
            // altitude. clearLevels() drops the constructor's default level 0.
            MultiLevelPinkNoiseWindModel ml = new MultiLevelPinkNoiseWindModel();
            ml.clearLevels();
            List<Double> seen = new ArrayList<>();
            for (int i = 0; i < windLevels.size(); i++) {
                Map<String, Object> lvl = windLevels.get(i);
                // The altitude is the level's identity here, not a quantity with
                // a sensible zero: the kernel keys its levels on it and
                // interpolates between them by it. Defaulting an absent or
                // unreadable one to 0 would drop the layer onto the pad, where it
                // either displaces the surface wind or collides with it and
                // fails the whole run. A level that cannot say where it is is
                // refused here, where the message can say which one it was.
                double altitude = JsonLite.dbl(lvl, "altitude", Double.NaN);
                if (!isFinite(altitude)) {
                    throw new IllegalArgumentException(
                            "wind level " + (i + 1) + " of " + windLevels.size() + " has no usable altitude");
                }
                // Said here rather than left to addWindLevel, which throws
                // "Wind level already exists for altitude: 0.0": true, but it
                // names neither the rows involved nor what to do about it.
                if (seen.contains(Double.valueOf(altitude))) {
                    throw new IllegalArgumentException("wind levels repeat the altitude " + altitude
                            + " m (level " + (i + 1) + "); each level needs its own altitude");
                }
                seen.add(Double.valueOf(altitude));
                ml.addWindLevel(
                        altitude,
                        JsonLite.dbl(lvl, "speed", 0),
                        JsonLite.dbl(lvl, "direction", Math.PI / 2),
                        JsonLite.dbl(lvl, "stddev", 0));
            }
            // Seeded last, after every level is in place: setSeed walks the
            // level list, which is only complete now. addWindLevel builds each
            // level's sub-model with the no-arg PinkNoiseWindModel constructor
            // (seed from new Random().nextInt()), so without this the turbulence
            // of a multi-level profile is freshly random on every run and two
            // runs of one design at one randomSeed cannot be compared, which is
            // exactly what the wind sweep does. setRandomSeed below does not
            // cover it: that stores an int on SimulationConditions and never
            // reaches the wind model. Upstream makes this same call in
            // SimulationOptions.toSimulationConditions; the bridge hand-builds
            // the conditions instead, so it has to make the call itself.
            // The single-level branch below is seeded via the constructor.
            // Level seeds are derived by altitude rank (the kernel keeps levels
            // sorted), so they do not depend on the order the levels arrived in.
            ml.setSeed(randomSeed);
            // MSL or AGL. The constructor defaults to MSL, so without this an
            // AGL profile would fly as if its altitudes were above sea level:
            // the same numbers, a different wind, and at a mile-high site not
            // remotely the same flight.
            ml.setAltitudeReference("agl".equalsIgnoreCase(JsonLite.str(o, "windAltitudeReference", "msl"))
                    ? WindModel.AltitudeReference.AGL
                    : WindModel.AltitudeReference.MSL);
            conditions.setWindModel(ml);
        } else {
            // Seeded explicitly: the no-arg PinkNoiseWindModel constructor seeds
            // from new Random().nextInt(), which is nondeterministic across runs.
            PinkNoiseWindModel wind = new PinkNoiseWindModel(randomSeed);
            wind.setAverage(JsonLite.dbl(o, "windAverage", 0));
            wind.setStandardDeviation(JsonLite.dbl(o, "windStdDeviation", 0));
            wind.setDirection(JsonLite.dbl(o, "windDirection", Math.PI / 2));
            conditions.setWindModel(wind);
        }
        conditions.setAerodynamicCalculator(aeroCalc);
        conditions.setMassCalculator(new MassCalculator());
        conditions.setTimeStep(timeStep > 0 ? timeStep : 0.05);
        conditions.setMaxSimulationTime(JsonLite.dbl(o, "maxTime", 1200));
        conditions.setRandomSeed(randomSeed);
        // Recovery-deployment speed thresholds. These do not change the physics;
        // they decide when the flight raises a deployment warning, and those
        // warnings already ride out to the caller in the result's `warnings`.
        // Defaults match SimulationConditions' own, so an options blob that omits
        // them gets the kernel's thresholds.
        //
        // drogueLowSpeed is read via PATCH(drogue-low-speed) in
        // BasicEventSimulationEngine: upstream ships that check commented out.
        // All four need the deploying stage's drogue flag to pick a branch,
        // which ComponentFactory sets from the node's `drogue` key.
        conditions.setRecoverySpeedWarning(JsonLite.dbl(o, "recoverySpeedWarn", 20.0));
        conditions.setDrogueLowSpeedWarning(JsonLite.dbl(o, "drogueLowSpeedWarn", 3.048));
        conditions.setRecoveryDrogueMainHighSpeedWarning(JsonLite.dbl(o, "mainHighSpeedWarn", 30.48));
        conditions.setRecoveryDrogueMainLowSpeedWarning(JsonLite.dbl(o, "mainLowSpeedWarn", 15.24));

        // Opt-in guide-aware rod clearance. Upstream compares travel with the full
        // rod length wherever the guides sit, so a lug or rail button above the
        // aft end gets travel it does not have and the rod-exit speed reads high.
        // The listener is simply absent when the key is off, which is why the
        // default flight is byte-identical to upstream rather than switched at
        // run time: see GuideClearanceListener for why no kernel file is patched.
        if (JsonLite.bool(o, "guideAwareRodClearance", false)) {
            conditions.getSimulationListenerList().add(new GuideClearanceListener());
        }

        try {
            BasicEventSimulationEngine engine = new BasicEventSimulationEngine();
            engine.simulate(conditions);
            FlightData data = engine.getFlightData();
            return flightDataToJson(data, fullSeries);
        } catch (SimulationException e) {
            return errorJson(e);
        } catch (RuntimeException e) {
            // Kept alongside the outer wrapper: this one is close to the
            // simulate() call and keeps its stack shallow, the outer one covers
            // the handle lookup and the options parse above.
            return errorJson(e);
        }
    }

    // ---------- helpers ----------

    /**
     * The atmosphere for a flight that carries {@code atmosphereLevels}: each
     * {altitude (m MSL), temperature (K), pressure (Pa), relativeHumidity
     * (fraction)}, in any order. See {@link AtmosphereProfile}.
     * <p>
     * When the site's temperature and pressure are both given, the site is the
     * profile's lowest level and any level at or below the site, by height or
     * by pressure, is dropped: the conditions stated for the pad win where the
     * rocket starts. The site's
     * humidity defaults to the lowest level kept above it. Without both site
     * values the levels are used as they are.
     */
    private static AtmosphereProfile atmosphereProfileOf(List<Map<String, Object>> levels,
            double launchAltitude, double temperature, double pressure, double humidity) {
        List<double[]> rows = new ArrayList<>();
        for (int i = 0; i < levels.size(); i++) {
            Map<String, Object> l = levels.get(i);
            rows.add(new double[] {
                    JsonLite.dbl(l, "altitude", Double.NaN),
                    JsonLite.dbl(l, "temperature", Double.NaN),
                    JsonLite.dbl(l, "pressure", Double.NaN),
                    JsonLite.dbl(l, "relativeHumidity", ExtendedISAModel.STANDARD_RELATIVE_HUMIDITY) });
        }
        rows.sort((a, b) -> Double.compare(a[0], b[0]));
        boolean anchored = !Double.isNaN(temperature) && !Double.isNaN(pressure);
        if (anchored) {
            // A level at or below the pad, by height or by pressure, is ground
            // the pad stands on, not air above it: the site's own values hold
            // there. By pressure as well because the two can disagree, a typed
            // site pressure against a forecast's levels, and a pressure that
            // rises with height is not an atmosphere.
            rows.removeIf(r -> r[0] <= launchAltitude || !(r[2] < pressure));
            double siteHumidity = !Double.isNaN(humidity) ? humidity
                    : rows.isEmpty() ? ExtendedISAModel.STANDARD_RELATIVE_HUMIDITY : rows.get(0)[3];
            rows.add(0, new double[] { launchAltitude, temperature, pressure, siteHumidity });
        }
        int n = rows.size();
        double[] alt = new double[n], t = new double[n], p = new double[n], rh = new double[n];
        for (int i = 0; i < n; i++) {
            double[] r = rows.get(i);
            alt[i] = r[0];
            t[i] = r[1];
            p[i] = r[2];
            rh[i] = r[3];
        }
        return new AtmosphereProfile(alt, t, p, rh);
    }

    /** Map a geodetic-model name to the kernel strategy (default spherical). */
    private static GeodeticComputationStrategy geodeticOf(String name) {
        switch (name == null ? "" : name.toLowerCase()) {
            case "flat": return GeodeticComputationStrategy.FLAT;
            case "wgs84": return GeodeticComputationStrategy.WGS84;
            case "spherical":
            default: return GeodeticComputationStrategy.SPHERICAL;
        }
    }

    private static final class RocketCtx {
        final Rocket rocket;
        final AxialStage stage;
        final FlightConfigurationId fcid;
        final Map<String, RocketComponent> ids = new HashMap<>();
        /**
         * Per-stage RASAero power-on nozzle-exit diameter (meters), captured from
         * the `nozzleExitDiameter` stage input. Applied to that stage's motor as
         * upstream's per-motor MotorConfiguration.nozzleExitDiameter when the motor
         * is set (see applyMotor). The browser keeps a per-stage input; the engine
         * uses OpenRocket's native per-motor model.
         */
        final Map<AxialStage, Double> nozzleDia = new HashMap<>();
        /** Opt-in Rogers Modified Barrowman body-fin interference. */
        boolean rogersKbf = false;
        /** Opt-in supersonic aerodynamics. */
        boolean supersonicAero = false;
        /**
         * Opt-in stubby stored-table nose-cone subsonic pressure-drag floor.
         * Standalone (not part of the RASAero models).
         */
        boolean stubbyNoseFloor = false;

        RocketCtx(Rocket rocket, AxialStage stage, FlightConfigurationId fcid) {
            this.rocket = rocket;
            this.stage = stage;
            this.fcid = fcid;
        }
    }

    private static void setBulkMaterial(RocketComponent c, double density) {
        if (density <= 0) {
            return; // keep the component's default material
        }
        Material m = Material.newMaterial(Material.Type.BULK, "custom", density, true);
        if (c instanceof info.openrocket.core.rocketcomponent.ExternalComponent) {
            ((info.openrocket.core.rocketcomponent.ExternalComponent) c).setMaterial(m);
        } else if (c instanceof info.openrocket.core.rocketcomponent.StructuralComponent) {
            ((info.openrocket.core.rocketcomponent.StructuralComponent) c).setMaterial(m);
        }
    }

    private static String flightDataToJson(FlightData data, boolean fullSeries) {
        StringBuilder sb = new StringBuilder("{\"summary\":{");
        num(sb, "maxAltitude", data.getMaxAltitude()).append(',');
        num(sb, "maxVelocity", data.getMaxVelocity()).append(',');
        num(sb, "maxAcceleration", data.getMaxAcceleration()).append(',');
        num(sb, "maxMachNumber", data.getMaxMachNumber()).append(',');
        num(sb, "timeToApogee", data.getTimeToApogee()).append(',');
        num(sb, "flightTime", data.getFlightTime()).append(',');
        num(sb, "groundHitVelocity", data.getGroundHitVelocity()).append(',');
        num(sb, "launchRodVelocity", data.getLaunchRodVelocity()).append(',');
        num(sb, "deploymentVelocity", data.getDeploymentVelocity()).append(',');
        num(sb, "optimumDelay", data.getOptimumDelay());
        sb.append("},\"warnings\":");
        appendWarnings(sb, data.getWarningSet());
        sb.append(",\"warningTexts\":");
        appendWarningTexts(sb, data.getWarningSet());
        sb.append(",\"events\":");
        appendEvents(sb, data.getBranch(0));
        sb.append(",\"series\":");
        appendBranchSeries(sb, data.getBranch(0), fullSeries);
        // Staged flights: every branch (sustainer = branch 0, then each
        // separated booster's own descent), each with name, events, series.
        // Omitted for single-branch flights.
        if (data.getBranchCount() > 1) {
            sb.append(",\"branches\":[");
            for (int i = 0; i < data.getBranchCount(); i++) {
                if (i > 0) sb.append(',');
                FlightDataBranch b = data.getBranch(i);
                sb.append("{\"name\":\"").append(escape(String.valueOf(b.getName())))
                        .append("\",\"events\":");
                appendEvents(sb, b);
                sb.append(",\"series\":");
                appendBranchSeries(sb, b, fullSeries);
                sb.append('}');
            }
            sb.append(']');
        }
        return sb.append('}').toString();
    }

    /**
     * Simulation warnings (FlightData.getWarningSet()) as structured entries:
     * "key" is the stable machine identity (see warningKey), "message" the human
     * text (Warning.toString(), source component names included), "priority"
     * LOW|NORMAL|HIGH (MessagePriority's own export labels).
     */
    private static void appendWarnings(StringBuilder sb, WarningSet warnings) {
        sb.append('[');
        boolean first = true;
        for (info.openrocket.core.logging.Warning w : warnings) {
            if (!first) sb.append(',');
            first = false;
            sb.append("{\"key\":\"").append(escape(warningKey(w)))
                    .append("\",\"message\":\"").append(escape(String.valueOf(w)))
                    .append("\",\"priority\":\"")
                    .append(w.getPriority().getExportLabel()).append("\"}");
        }
        sb.append(']');
    }

    /**
     * Plain warning messages, same "warningTexts" shape and naming as
     * getStaticInfo(); the app treats static and flight warnings alike.
     */
    private static void appendWarningTexts(StringBuilder sb, WarningSet warnings) {
        sb.append('[');
        boolean first = true;
        for (info.openrocket.core.logging.Warning w : warnings) {
            if (!first) sb.append(',');
            first = false;
            sb.append('"').append(escape(String.valueOf(w))).append('"');
        }
        sb.append(']');
    }

    /**
     * Stable machine identity for a Warning. No reflection (TeaVM's class
     * metadata must never leak into parity-compared output), so the typed
     * Warning subclasses are enumerated by hand. Every other warning is a
     * Warning.Other; the shim translator is a DebugTranslator, so those texts
     * start with the bracketed l10n key ("[Warning.NO_RECOVERY_DEVICE]…"),
     * and that key is the identity. Anything else falls back to "Other".
     */
    private static String warningKey(info.openrocket.core.logging.Warning w) {
        if (w instanceof info.openrocket.core.logging.Warning.LargeAOA) {
            return "LargeAOA";
        }
        // The web app's key for Warning.RecoveryHighSpeedDeployment is
        // "HighSpeedDeployment".
        if (w instanceof info.openrocket.core.logging.Warning.RecoveryHighSpeedDeployment) {
            return "HighSpeedDeployment";
        }
        if (w instanceof info.openrocket.core.logging.Warning.EventAfterLanding) {
            return "EventAfterLanding";
        }
        if (w instanceof info.openrocket.core.logging.Warning.MissingMotor) {
            return "MissingMotor";
        }
        String text = w.getMessageDescription();
        final String prefix = "[Warning.";
        if (text != null && text.startsWith(prefix)) {
            int end = text.indexOf(']');
            if (end > prefix.length()) {
                return text.substring(prefix.length(), end);
            }
        }
        return "Other";
    }

    private static void appendEvents(StringBuilder sb, FlightDataBranch branch) {
        sb.append('[');
        boolean first = true;
        for (FlightEvent ev : branch.getEvents()) {
            if (!first) sb.append(',');
            first = false;
            // The time goes through num()'s non-finite guard: a raw
            // `"time":Infinity` is not JSON, so JSON.parse would throw on the
            // browser side and discard the entire flight.
            sb.append("{\"type\":\"").append(ev.getType().name()).append('"').append(',');
            num(sb, "time", ev.getTime());
            // Source component name: tells dual-deployment rockets apart
            // (which recovery device deployed: drogue vs main).
            RocketComponent src = ev.getSource();
            if (src != null && src.getName() != null) {
                sb.append(",\"source\":\"").append(escape(src.getName())).append('"');
            }
            sb.append('}');
        }
        sb.append(']');
    }

    /**
     * The 12 types serialized under friendly names in appendBranchSeries.
     * Re-emitting them under their symbols ("t", "h"…) would be pure byte
     * duplication (~17% of the payload), so the symbol-keyed section always
     * skips them.
     */
    private static final java.util.Set<FlightDataType> FRIENDLY_NAMED_TYPES =
            new java.util.HashSet<>(java.util.Arrays.asList(
                    FlightDataType.TYPE_TIME, FlightDataType.TYPE_ALTITUDE,
                    FlightDataType.TYPE_VELOCITY_TOTAL, FlightDataType.TYPE_ACCELERATION_TOTAL,
                    FlightDataType.TYPE_MASS, FlightDataType.TYPE_THRUST_FORCE,
                    FlightDataType.TYPE_DRAG_FORCE, FlightDataType.TYPE_MACH_NUMBER,
                    FlightDataType.TYPE_STABILITY, FlightDataType.TYPE_CP_LOCATION,
                    FlightDataType.TYPE_CG_LOCATION, FlightDataType.TYPE_AOA));

    /**
     * The symbol series the app's flight report consumes on every run
     * (lateral drift Pl, θl, Px, Py and roll rate dΦ): the only
     * symbol keys "summary" mode emits.
     */
    private static final java.util.Set<FlightDataType> SUMMARY_SYMBOL_TYPES =
            new java.util.HashSet<>(java.util.Arrays.asList(
                    FlightDataType.TYPE_POSITION_XY, FlightDataType.TYPE_POSITION_DIRECTION,
                    FlightDataType.TYPE_POSITION_X, FlightDataType.TYPE_POSITION_Y,
                    FlightDataType.TYPE_ROLL_RATE));

    private static void appendBranchSeries(StringBuilder sb, FlightDataBranch branch, boolean fullSeries) {
        sb.append('{');
        appendSeries(sb, "time", branch.get(FlightDataType.TYPE_TIME)).append(',');
        appendSeries(sb, "altitude", branch.get(FlightDataType.TYPE_ALTITUDE)).append(',');
        appendSeries(sb, "velocity", branch.get(FlightDataType.TYPE_VELOCITY_TOTAL)).append(',');
        appendSeries(sb, "acceleration", branch.get(FlightDataType.TYPE_ACCELERATION_TOTAL)).append(',');
        appendSeries(sb, "mass", branch.get(FlightDataType.TYPE_MASS)).append(',');
        appendSeries(sb, "thrust", branch.get(FlightDataType.TYPE_THRUST_FORCE)).append(',');
        appendSeries(sb, "drag", branch.get(FlightDataType.TYPE_DRAG_FORCE)).append(',');
        appendSeries(sb, "mach", branch.get(FlightDataType.TYPE_MACH_NUMBER)).append(',');
        appendSeries(sb, "stability", branch.get(FlightDataType.TYPE_STABILITY)).append(',');
        appendSeries(sb, "cpLocation", branch.get(FlightDataType.TYPE_CP_LOCATION)).append(',');
        appendSeries(sb, "cgLocation", branch.get(FlightDataType.TYPE_CG_LOCATION)).append(',');
        appendSeries(sb, "aoa", branch.get(FlightDataType.TYPE_AOA));
        // Symbol-keyed series ("Pl", "Cdf", "mp"…) beyond the friendly
        // dozen, in getTypes()' natural sort order, only the types this
        // branch actually carries. Key order is deterministic, and with
        // TYPE_COMPUTATION_TIME (tc, wall-clock measurement noise) excluded
        // so are the values, so the parity test can compare the whole payload.
        // Summary mode emits only SUMMARY_SYMBOL_TYPES; full mode emits
        // everything except tc and the friendly-named duplicates.
        for (FlightDataType type : branch.getTypes()) {
            if (fullSeries
                    ? (type.equals(FlightDataType.TYPE_COMPUTATION_TIME)
                            || FRIENDLY_NAMED_TYPES.contains(type))
                    : !SUMMARY_SYMBOL_TYPES.contains(type)) {
                continue;
            }
            List<Double> values = branch.get(type);
            if (values == null) {
                continue;
            }
            sb.append(',');
            appendSeries(sb, escape(type.getSymbol()), values);
        }
        sb.append('}');
    }

    private static StringBuilder appendSeries(StringBuilder sb, String name, List<Double> values) {
        sb.append('"').append(escape(name)).append("\":[");
        if (values != null) {
            for (int i = 0; i < values.size(); i++) {
                if (i > 0) sb.append(',');
                Double v = values.get(i);
                // isInfinite too: Java Double.toString(Infinity) is a bare
                // 'Infinity', which JSON.parse rejects; one such sample
                // would kill the whole result (num() already guards this).
                sb.append(v == null || v.isNaN() || v.isInfinite() ? "null" : v.toString());
            }
        }
        return sb.append(']');
    }

    private static void requireFinite(String what, double value) {
        if (Double.isNaN(value) || Double.isInfinite(value)) {
            throw new IllegalStateException("The design's " + what + " is not a finite number (" + value
                    + "); a dimension is probably out of range.");
        }
    }

    private static StringBuilder num(StringBuilder sb, String key, double value) {
        sb.append('"').append(key).append("\":");
        if (Double.isNaN(value) || Double.isInfinite(value)) {
            return sb.append("null");
        }
        return sb.append(value);
    }

    private static String escape(String s) {
        if (s == null) return "";
        // Control characters must be escaped too: component names arrive through
        // buildRocket JSON (JsonLite decodes \n etc. into real chars) and are
        // re-emitted inside JSON string literals, and a raw newline there makes the
        // whole payload unparseable by JSON.parse on the JS side.
        StringBuilder sb = new StringBuilder(s.length() + 8);
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '\\': sb.append("\\\\"); break;
                case '"': sb.append("\\\""); break;
                case '\n': sb.append("\\n"); break;
                case '\r': sb.append("\\r"); break;
                case '\t': sb.append("\\t"); break;
                default:
                    if (c < 0x20) {
                        // Hand-rolled backslash-u00XX (avoid String.format:
                        // TeaVM's Formatter is incomplete, see PATCH(teavm-format-g)
                        // in patches/LEDGER.md).
                        sb.append("\\u00");
                        sb.append(Character.forDigit((c >> 4) & 0xF, 16));
                        sb.append(Character.forDigit(c & 0xF, 16));
                    } else {
                        sb.append(c);
                    }
            }
        }
        return sb.toString();
    }
}
