package ref;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;

import info.openrocket.core.material.Material;
import info.openrocket.core.motor.Manufacturer;
import info.openrocket.core.motor.IgnitionEvent;
import info.openrocket.core.motor.Motor;
import info.openrocket.core.motor.MotorConfiguration;
import info.openrocket.core.motor.ThrustCurveMotor;
import info.openrocket.core.rocketcomponent.AxialStage;
import info.openrocket.core.rocketcomponent.BodyTube;
import info.openrocket.core.rocketcomponent.DeploymentConfiguration;
import info.openrocket.core.rocketcomponent.ExternalComponent;
import info.openrocket.core.rocketcomponent.FlightConfigurationId;
import info.openrocket.core.rocketcomponent.InnerTube;
import info.openrocket.core.rocketcomponent.MotorMount;
import info.openrocket.core.rocketcomponent.NoseCone;
import info.openrocket.core.rocketcomponent.Parachute;
import info.openrocket.core.rocketcomponent.RecoveryDevice;
import info.openrocket.core.rocketcomponent.Rocket;
import info.openrocket.core.rocketcomponent.RocketComponent;
import info.openrocket.core.rocketcomponent.StageSeparationConfiguration;
import info.openrocket.core.rocketcomponent.StructuralComponent;
import info.openrocket.core.rocketcomponent.Transition;
import info.openrocket.core.rocketcomponent.TrapezoidFinSet;
import info.openrocket.core.rocketcomponent.position.AxialMethod;
import info.openrocket.core.util.Coordinate;

/**
 * Builds the fixture's rocket through upstream's OWN component API.
 *
 * This is deliberately a SECOND, independent reading of the fixture: our
 * {@code api.ComponentFactory} is the first. Two independent readings of one
 * explicit spec is the whole mechanism - if the shipped bridge mis-seats a motor,
 * drops a separation config or applies a dimension to the wrong field, this side
 * will not make the same mistake and the flights will disagree.
 *
 * <b>Strict by construction.</b> Every key is consumed explicitly and anything
 * left over is an error. A reader that silently ignored an unknown key would let
 * a fixture grow a property only ONE side honors, and then report agreement on a
 * comparison that never tested it.
 */
final class Fixture {

    /** Mount id -> the component, so motors and ignition can be seated by id. */
    private final Map<String, MotorMount> mounts = new HashMap<>();

    private Fixture() {
    }

    static final class Built {
        final Rocket rocket;
        final FlightConfigurationId fcid;

        Built(Rocket rocket, FlightConfigurationId fcid) {
            this.rocket = rocket;
            this.fcid = fcid;
        }
    }

    static Built build(JsonObject fixture) {
        Fixture f = new Fixture();
        JsonObject design = obj(fixture, "design");

        Rocket rocket = new Rocket();
        rocket.setName(str(design, "name", "Reference"));

        JsonArray components = arr(design, "components");
        List<JsonObject> stages = new ArrayList<>();
        for (JsonElement e : components) {
            JsonObject node = e.getAsJsonObject();
            if (!"stage".equals(str(node, "type", null))) {
                throw new IllegalArgumentException(
                        "top-level components must all be stages; got " + str(node, "type", "(none)"));
            }
            stages.add(node);
        }
        if (stages.isEmpty()) {
            throw new IllegalArgumentException("design has no stages");
        }

        for (JsonObject stageNode : stages) {
            Set<String> used = new LinkedHashSet<>(List.of("type"));
            AxialStage stage = new AxialStage();
            stage.setName(str(stageNode, "name", "Stage"));
            used.add("name");
            rocket.addChild(stage);

            f.applySeparation(stage, stageNode, used);

            for (JsonElement child : arrOrEmpty(stageNode, "children")) {
                stage.addChild(f.component(child.getAsJsonObject()));
            }
            used.add("children");
            reject(stageNode, used, "stage");
        }

        // Now that every component has its parent, the deferred positions apply.
        f.applyPositions();

        // The configuration must exist before motors are seated: MotorConfiguration
        // and the separation/ignition configs are all keyed by this id.
        FlightConfigurationId fcid = new FlightConfigurationId();
        rocket.createFlightConfiguration(fcid);
        rocket.setSelectedConfiguration(fcid);

        for (JsonElement e : arrOrEmpty(fixture, "motors")) {
            f.motor(e.getAsJsonObject(), fcid);
        }
        for (JsonElement e : arrOrEmpty(fixture, "ignition")) {
            f.ignition(e.getAsJsonObject(), fcid);
        }

        // Without this the configuration's motor list stays stale and the on-pad
        // mass is the UNLOADED rocket. The shipped bridge has the same call for
        // the same reason.
        rocket.getSelectedConfiguration().update();
        rocket.enableEvents();
        return new Built(rocket, fcid);
    }

    private void applySeparation(AxialStage stage, JsonObject node, Set<String> used) {
        String event = str(node, "separationEvent", null);
        Double delay = dblOrNull(node, "separationDelay");
        Double altitude = dblOrNull(node, "separationAltitude");
        used.add("separationEvent");
        used.add("separationDelay");
        used.add("separationAltitude");
        if (event == null && delay == null && altitude == null) {
            return;
        }
        StageSeparationConfiguration sep = new StageSeparationConfiguration();
        if (event != null) {
            sep.setSeparationEvent(separationEvent(event));
        }
        if (delay != null) {
            sep.setSeparationDelay(delay);
        }
        if (altitude != null) {
            sep.setSeparationAltitude(altitude);
        }
        stage.getSeparationConfigurations().setDefault(sep);
    }

    private RocketComponent component(JsonObject node) {
        Set<String> used = new LinkedHashSet<>(List.of("type"));
        String type = str(node, "type", null);
        if (type == null) {
            throw new IllegalArgumentException("component node has no type");
        }
        RocketComponent c;
        switch (type) {
            case "nosecone": {
                NoseCone n = new NoseCone();
                // Shape FIRST: upstream's setShapeType resets the shape
                // parameter, so anything set before it is discarded.
                n.setShapeType(shape(req(node, "shape", used)));
                n.setLength(reqDbl(node, "length", used));
                n.setAftRadius(reqDbl(node, "aftRadius", used));
                n.setThickness(reqDbl(node, "thickness", used));
                c = n;
                break;
            }
            case "bodytube": {
                BodyTube t = new BodyTube();
                t.setLength(reqDbl(node, "length", used));
                t.setOuterRadius(reqDbl(node, "outerRadius", used));
                t.setThickness(reqDbl(node, "thickness", used));
                c = t;
                break;
            }
            case "trapezoidfinset": {
                TrapezoidFinSet fs = new TrapezoidFinSet();
                fs.setFinCount((int) reqDbl(node, "finCount", used));
                fs.setRootChord(reqDbl(node, "rootChord", used));
                fs.setTipChord(reqDbl(node, "tipChord", used));
                fs.setSweep(reqDbl(node, "sweep", used));
                fs.setHeight(reqDbl(node, "height", used));
                fs.setThickness(reqDbl(node, "thickness", used));
                c = fs;
                break;
            }
            case "innertube": {
                InnerTube t = new InnerTube();
                t.setLength(reqDbl(node, "length", used));
                t.setOuterRadius(reqDbl(node, "outerRadius", used));
                t.setThickness(reqDbl(node, "thickness", used));
                c = t;
                if (bool(node, "motorMount", false, used)) {
                    t.setMotorMount(true);
                }
                break;
            }
            case "parachute": {
                Parachute p = new Parachute();
                p.setDiameter(reqDbl(node, "diameter", used));
                p.setCD(reqDbl(node, "cd", used));
                p.setLineCount((int) reqDbl(node, "lineCount", used));
                p.setLineLength(reqDbl(node, "lineLength", used));
                applyDeployment(p, node, used);
                c = p;
                break;
            }
            default:
                throw new IllegalArgumentException("reference harness does not build component type: " + type);
        }

        String name = str(node, "name", null);
        used.add("name");
        if (name != null) {
            c.setName(name);
        }

        Double density = dblOrNull(node, "density");
        used.add("density");
        if (density != null) {
            Material m = Material.newMaterial(Material.Type.BULK, "custom", density, true);
            if (c instanceof ExternalComponent) {
                ((ExternalComponent) c).setMaterial(m);
            } else if (c instanceof StructuralComponent) {
                ((StructuralComponent) c).setMaterial(m);
            } else {
                throw new IllegalArgumentException(
                        "density given for a component that carries no bulk material: " + type);
            }
        }

        String id = str(node, "id", null);
        used.add("id");
        if (id != null) {
            if (!(c instanceof MotorMount)) {
                throw new IllegalArgumentException("id '" + id + "' is on a component that is not a motor mount");
            }
            if (mounts.put(id, (MotorMount) c) != null) {
                throw new IllegalArgumentException("duplicate mount id: " + id);
            }
        }

        // Children before position: upstream's setAxialMethod/setAxialOffset read
        // getParent(), so they are applied by the PARENT after the attach below.
        for (JsonElement child : arrOrEmpty(node, "children")) {
            c.addChild(component(child.getAsJsonObject()));
        }
        used.add("children");

        JsonObject position = node.has("position") ? node.getAsJsonObject("position") : null;
        used.add("position");
        if (position != null) {
            // Deferred: upstream's setAxialMethod and setAxialOffset both read
            // getParent() and NPE on a component that has not been attached yet.
            // The attach happens in the CALLER, so the position cannot be applied
            // here however tempting the ordering looks.
            pending.add(new Pos(c, position));
            reject(position, new LinkedHashSet<>(List.of("method", "offset")), type + ".position");
        }

        reject(node, used, type);
        return c;
    }

    /** A position that could not be applied until its component had a parent. */
    private static final class Pos {
        final RocketComponent component;
        final JsonObject position;

        Pos(RocketComponent component, JsonObject position) {
            this.component = component;
            this.position = position;
        }
    }

    private final List<Pos> pending = new ArrayList<>();

    /** Applied once the whole tree is attached, so every parent exists. */
    private void applyPositions() {
        for (Pos p : pending) {
            p.component.setAxialMethod(axialMethod(str(p.position, "method", "bottom")));
            p.component.setAxialOffset(dbl(p.position, "offset", 0));
        }
        pending.clear();
    }

    private void applyDeployment(RecoveryDevice device, JsonObject node, Set<String> used) {
        DeploymentConfiguration config = device.getDeploymentConfigurations().getDefault();
        String event = req(node, "deployEvent", used);
        config.setDeployEvent(deployEvent(event));
        config.setDeployDelay(reqDbl(node, "deployDelay", used));
        Double altitude = dblOrNull(node, "deployAltitude");
        used.add("deployAltitude");
        if (altitude != null) {
            config.setDeployAltitude(altitude);
        }
    }

    private void motor(JsonObject node, FlightConfigurationId fcid) {
        Set<String> used = new LinkedHashSet<>();
        String mountId = req(node, "mount", used);
        MotorMount mount = mounts.get(mountId);
        if (mount == null) {
            throw new IllegalArgumentException("no mount with id '" + mountId + "'");
        }
        String designation = req(node, "designation", used);
        double diameter = reqDbl(node, "diameter", used);
        double length = reqDbl(node, "length", used);
        double cgX = reqDbl(node, "cgX", used);
        double ejectionDelay = reqDbl(node, "ejectionDelay", used);
        double[] times = doubles(node, "times", used);
        double[] thrusts = doubles(node, "thrusts", used);
        double[] masses = doubles(node, "masses", used);
        reject(node, used, "motor");

        if (times.length < 2 || thrusts.length != times.length || masses.length != times.length) {
            throw new IllegalArgumentException(
                    "motor " + designation + ": times/thrusts/masses must match and be at least 2 long");
        }
        Coordinate[] cg = new Coordinate[times.length];
        for (int i = 0; i < times.length; i++) {
            cg[i] = new Coordinate(cgX, 0, 0, masses[i]);
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
                .setCGPoints(cg)
                .setDigest("reference-" + designation)
                .build();

        MotorConfiguration mc = new MotorConfiguration(mount, fcid);
        mc.setMotor(motor);
        mc.setEjectionDelay(ejectionDelay);
        mount.setMotorConfig(mc, fcid);
    }

    private void ignition(JsonObject node, FlightConfigurationId fcid) {
        Set<String> used = new LinkedHashSet<>();
        String mountId = req(node, "mount", used);
        MotorMount mount = mounts.get(mountId);
        if (mount == null) {
            throw new IllegalArgumentException("no mount with id '" + mountId + "'");
        }
        String event = req(node, "event", used);
        double delay = reqDbl(node, "delay", used);
        reject(node, used, "ignition");

        MotorConfiguration mc = mount.getMotorConfig(fcid);
        if (mc == null) {
            throw new IllegalArgumentException("ignition set for mount '" + mountId + "' before its motor");
        }
        mc.setIgnitionEvent(ignitionEvent(event));
        mc.setIgnitionDelay(delay);
    }

    // ---- enum mappings. Unknown names THROW; the shipped bridge falls through to
    // ---- a default, which is right for a UI and wrong for a reference.

    private static Transition.Shape shape(String name) {
        switch (name.toLowerCase()) {
            case "conical": return Transition.Shape.CONICAL;
            case "ogive": return Transition.Shape.OGIVE;
            case "ellipsoid": return Transition.Shape.ELLIPSOID;
            case "power": return Transition.Shape.POWER;
            case "parabolic": return Transition.Shape.PARABOLIC;
            case "haack": return Transition.Shape.HAACK;
            default: throw new IllegalArgumentException("unknown nose shape: " + name);
        }
    }

    private static AxialMethod axialMethod(String name) {
        switch (name.toLowerCase()) {
            case "top": return AxialMethod.TOP;
            case "middle": return AxialMethod.MIDDLE;
            case "bottom": return AxialMethod.BOTTOM;
            case "absolute": return AxialMethod.ABSOLUTE;
            case "afterr":
            case "after": return AxialMethod.AFTER;
            default: throw new IllegalArgumentException("unknown axial method: " + name);
        }
    }

    private static DeploymentConfiguration.DeployEvent deployEvent(String name) {
        switch (name.toLowerCase()) {
            case "launch": return DeploymentConfiguration.DeployEvent.LAUNCH;
            case "apogee": return DeploymentConfiguration.DeployEvent.APOGEE;
            case "altitude": return DeploymentConfiguration.DeployEvent.ALTITUDE;
            case "never": return DeploymentConfiguration.DeployEvent.NEVER;
            case "ejection": return DeploymentConfiguration.DeployEvent.EJECTION;
            default: throw new IllegalArgumentException("unknown deploy event: " + name);
        }
    }

    private static StageSeparationConfiguration.SeparationEvent separationEvent(String name) {
        switch (name.toLowerCase().replace("_", "")) {
            case "launch": return StageSeparationConfiguration.SeparationEvent.LAUNCH;
            case "ignition": return StageSeparationConfiguration.SeparationEvent.IGNITION;
            case "burnout": return StageSeparationConfiguration.SeparationEvent.BURNOUT;
            case "ejection": return StageSeparationConfiguration.SeparationEvent.EJECTION;
            case "apogee": return StageSeparationConfiguration.SeparationEvent.APOGEE;
            case "upperignition": return StageSeparationConfiguration.SeparationEvent.UPPER_IGNITION;
            // Upstream splits altitude by direction of travel; there is no bare
            // ALTITUDE, so a fixture must say which crossing it means.
            case "altitudeascending": return StageSeparationConfiguration.SeparationEvent.ALTITUDE_ASCENDING;
            case "altitudedescending": return StageSeparationConfiguration.SeparationEvent.ALTITUDE_DESCENDING;
            case "never": return StageSeparationConfiguration.SeparationEvent.NEVER;
            default: throw new IllegalArgumentException("unknown separation event: " + name);
        }
    }

    private static IgnitionEvent ignitionEvent(String name) {
        switch (name.toLowerCase().replace("_", "")) {
            case "automatic": return IgnitionEvent.AUTOMATIC;
            case "launch": return IgnitionEvent.LAUNCH;
            case "ejectioncharge": return IgnitionEvent.EJECTION_CHARGE;
            case "burnout": return IgnitionEvent.BURNOUT;
            case "never": return IgnitionEvent.NEVER;
            default: throw new IllegalArgumentException("unknown ignition event: " + name);
        }
    }

    // ---- json helpers

    static JsonObject obj(JsonObject o, String key) {
        if (!o.has(key)) {
            throw new IllegalArgumentException("fixture is missing '" + key + "'");
        }
        return o.getAsJsonObject(key);
    }

    static JsonArray arr(JsonObject o, String key) {
        if (!o.has(key)) {
            throw new IllegalArgumentException("fixture is missing '" + key + "'");
        }
        return o.getAsJsonArray(key);
    }

    static JsonArray arrOrEmpty(JsonObject o, String key) {
        return o.has(key) ? o.getAsJsonArray(key) : new JsonArray();
    }

    static String str(JsonObject o, String key, String fallback) {
        return o.has(key) && !o.get(key).isJsonNull() ? o.get(key).getAsString() : fallback;
    }

    static double dbl(JsonObject o, String key, double fallback) {
        return o.has(key) && !o.get(key).isJsonNull() ? o.get(key).getAsDouble() : fallback;
    }

    private static Double dblOrNull(JsonObject o, String key) {
        return o.has(key) && !o.get(key).isJsonNull() ? o.get(key).getAsDouble() : null;
    }

    private static String req(JsonObject o, String key, Set<String> used) {
        used.add(key);
        String v = str(o, key, null);
        if (v == null) {
            throw new IllegalArgumentException("required key '" + key + "' is missing");
        }
        return v;
    }

    private static double reqDbl(JsonObject o, String key, Set<String> used) {
        used.add(key);
        Double v = dblOrNull(o, key);
        if (v == null) {
            throw new IllegalArgumentException("required key '" + key + "' is missing");
        }
        return v;
    }

    private static boolean bool(JsonObject o, String key, boolean fallback, Set<String> used) {
        used.add(key);
        return o.has(key) && !o.get(key).isJsonNull() ? o.get(key).getAsBoolean() : fallback;
    }

    private static double[] doubles(JsonObject o, String key, Set<String> used) {
        used.add(key);
        JsonArray a = arr(o, key);
        double[] out = new double[a.size()];
        for (int i = 0; i < out.length; i++) {
            out[i] = a.get(i).getAsDouble();
        }
        return out;
    }

    /**
     * Every key must have been consumed. Keys starting with '_' are comments.
     */
    private static void reject(JsonObject o, Set<String> used, String where) {
        List<String> extra = new ArrayList<>();
        for (String k : o.keySet()) {
            if (!k.startsWith("_") && !used.contains(k)) {
                extra.add(k);
            }
        }
        if (!extra.isEmpty()) {
            throw new IllegalArgumentException(
                    "the reference harness does not handle " + where + " key(s) " + extra
                            + " - either implement them here or take them out of the fixture;"
                            + " silently ignoring one would report agreement on an untested property");
        }
    }
}
