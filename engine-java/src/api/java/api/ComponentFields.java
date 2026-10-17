package api;

import info.openrocket.core.material.Material;
import info.openrocket.core.motor.MotorConfiguration;
import info.openrocket.core.rocketcomponent.AxialStage;
import info.openrocket.core.rocketcomponent.ExternalComponent;
import info.openrocket.core.rocketcomponent.StructuralComponent;
import info.openrocket.core.rocketcomponent.BodyTube;
import info.openrocket.core.rocketcomponent.DeploymentConfiguration;
import info.openrocket.core.rocketcomponent.EllipticalFinSet;
import info.openrocket.core.rocketcomponent.FinSet;
import info.openrocket.core.rocketcomponent.InnerTube;
import info.openrocket.core.rocketcomponent.LaunchLug;
import info.openrocket.core.rocketcomponent.MassComponent;
import info.openrocket.core.rocketcomponent.MassObject;
import info.openrocket.core.rocketcomponent.MotorMount;
import info.openrocket.core.rocketcomponent.NoseCone;
import info.openrocket.core.rocketcomponent.ParallelStage;
import info.openrocket.core.rocketcomponent.Parachute;
import info.openrocket.core.rocketcomponent.PodSet;
import info.openrocket.core.rocketcomponent.RadiusRingComponent;
import info.openrocket.core.rocketcomponent.RailButton;
import info.openrocket.core.rocketcomponent.RecoveryDevice;
import info.openrocket.core.rocketcomponent.RingComponent;
import info.openrocket.core.rocketcomponent.RocketComponent;
import info.openrocket.core.rocketcomponent.ShockCord;
import info.openrocket.core.rocketcomponent.StageSeparationConfiguration;
import info.openrocket.core.rocketcomponent.Streamer;
import info.openrocket.core.rocketcomponent.ThicknessRingComponent;
import info.openrocket.core.rocketcomponent.Transition;
import info.openrocket.core.rocketcomponent.TrapezoidFinSet;
import info.openrocket.core.rocketcomponent.TubeFinSet;
import info.openrocket.core.rocketcomponent.position.AnglePositionable;
import info.openrocket.core.rocketcomponent.position.AxialMethod;
import info.openrocket.core.rocketcomponent.position.RadiusPositionable;

/**
 * What a built component holds, field by field, under the app's node keys.
 *
 * Each value is read back from the kernel object through its own getter after
 * the whole rocket is built, so it is what flies: after the setters' clamps,
 * after the automatic rules have resolved, and with the constructor's value
 * wherever the node left a key out. Lengths are meters, angles radians, masses
 * kilograms, densities in the material's own unit. Enumerations are their
 * upstream names lowercased; a cluster is its file name (`getXMLName`).
 *
 * The app reads the same fields itself to draw, export and save the part, so
 * this is what those readings are tested against
 * (web/tests/engine/fieldReadback.kernel.test.ts). Desktop OpenRocket reads the
 * files the app saves through this same class, compiled against its release
 * (web/scripts/ork-check/OrkFields.java), so the two can be compared key by
 * key. Beyond the panel's fields that adds what a file also carries: overrides,
 * materials, the finish, a fin's planform area, and the same placement stated
 * the way a file format may restate it (a pod's distance from the axis, a fin
 * tab's offset from the root's front). A key a component does not have is left
 * out.
 */
public final class ComponentFields {
    private ComponentFields() {}

    public static String of(RocketComponent c) {
        Out o = new Out();
        // A mass object's length follows its radius when the radius is
        // automatic, and only getRadius() settles the pair.
        if (c instanceof MassObject) {
            ((MassObject) c).getRadius();
        }
        o.num("length", c.getLength());
        o.str("positionMethod", c.getAxialMethod().name());
        o.num("positionOffset", c.getAxialOffset());
        // Where the part's front sits from the rocket's nose, however the
        // position is stated: a file format can state the same station another way.
        o.num("positionX", c.getAxialOffset(AxialMethod.ABSOLUTE));
        o.bool("massOverridden", c.isMassOverridden());
        o.num("overrideMass", c.getOverrideMass());
        o.bool("cgOverridden", c.isCGOverridden());
        o.num("overrideCGX", c.getOverrideCGX());
        o.bool("overrideSubcomponentsMass", c.isSubcomponentsOverriddenMass());
        o.bool("overrideSubcomponentsCG", c.isSubcomponentsOverriddenCG());
        o.bool("cdOverridden", c.isCDOverridden());
        o.num("overrideCD", c.getOverrideCD());
        o.bool("overrideSubcomponentsCD", c.isSubcomponentsOverriddenCD());
        o.text("comment", c.getComment());
        if (c instanceof ExternalComponent) {
            ExternalComponent e = (ExternalComponent) c;
            o.material("", e.getMaterial());
            // Desktop's RockSim handlers leave the finish unset when the file
            // carries no FinishCode; reported as such rather than thrown on.
            o.str("finish", e.getFinish() == null ? "unset" : e.getFinish().name());
        } else if (c instanceof StructuralComponent) {
            o.material("", ((StructuralComponent) c).getMaterial());
        } else if (c instanceof RecoveryDevice) {
            o.material("", ((RecoveryDevice) c).getMaterial());
        } else if (c instanceof ShockCord) {
            o.material("", ((ShockCord) c).getMaterial());
        }
        if (c instanceof Parachute) {
            o.material("line", ((Parachute) c).getLineMaterial());
        }

        if (c instanceof NoseCone) {
            NoseCone n = (NoseCone) c;
            o.str("shape", n.getShapeType().name());
            o.num("shapeParameter", n.getShapeParameter());
            o.num("aftRadius", n.getBaseRadius());
            o.num("thickness", n.getThickness());
            o.bool("filled", n.isFilled());
            o.bool("flipped", n.isFlipped());
            o.num("shoulderLength", n.getShoulderLength());
            o.num("shoulderRadius", n.getShoulderRadius());
            o.num("shoulderThickness", n.getShoulderThickness());
            o.bool("shoulderCapped", n.isShoulderCapped());
        } else if (c instanceof Transition) {
            Transition t = (Transition) c;
            o.str("shape", t.getShapeType().name());
            o.num("shapeParameter", t.getShapeParameter());
            o.num("foreRadius", t.getForeRadius());
            o.num("aftRadius", t.getAftRadius());
            o.num("thickness", t.getThickness());
            o.bool("filled", t.isFilled());
            o.bool("clipped", t.isClipped());
            o.num("foreShoulderLength", t.getForeShoulderLength());
            o.num("foreShoulderRadius", t.getForeShoulderRadius());
            o.num("foreShoulderThickness", t.getForeShoulderThickness());
            o.bool("foreShoulderCapped", t.isForeShoulderCapped());
            o.num("aftShoulderLength", t.getAftShoulderLength());
            o.num("aftShoulderRadius", t.getAftShoulderRadius());
            o.num("aftShoulderThickness", t.getAftShoulderThickness());
            o.bool("aftShoulderCapped", t.isAftShoulderCapped());
        } else if (c instanceof BodyTube) {
            BodyTube b = (BodyTube) c;
            o.num("outerRadius", b.getOuterRadius());
            o.num("thickness", b.getThickness());
            o.bool("filled", b.isFilled());
            o.bool("motorMount", b.isMotorMount());
            o.num("motorOverhang", b.getMotorOverhang());
            defaultIgnition(o, b);
        }

        if (c instanceof FinSet) {
            FinSet f = (FinSet) c;
            o.num("finCount", f.getFinCount());
            o.num("thickness", f.getThickness());
            o.num("cant", f.getCantAngle());
            o.str("crossSection", f.getCrossSection().name());
            o.num("rotation", f.getBaseRotation());
            o.num("filletRadius", f.getFilletRadius());
            o.material("fillet", f.getFilletMaterial());
            o.num("tabLength", f.getTabLength());
            o.num("tabHeight", f.getTabHeight());
            o.num("tabOffset", f.getTabOffset());
            o.str("tabOffsetMethod", f.getTabOffsetMethod().name());
            o.num("tabOffsetFromFront", f.getTabOffset(AxialMethod.TOP));
            o.num("planformArea", f.getPlanformArea());
            if (c instanceof TrapezoidFinSet) {
                TrapezoidFinSet t = (TrapezoidFinSet) c;
                o.num("rootChord", t.getRootChord());
                o.num("tipChord", t.getTipChord());
                o.num("sweep", t.getSweep());
                o.num("height", t.getHeight());
            } else if (c instanceof EllipticalFinSet) {
                EllipticalFinSet e = (EllipticalFinSet) c;
                o.num("rootChord", e.getLength());
                o.num("height", e.getHeight());
            }
        } else if (c instanceof TubeFinSet) {
            TubeFinSet t = (TubeFinSet) c;
            o.num("finCount", t.getFinCount());
            o.num("outerRadius", t.getOuterRadius());
            o.num("thickness", t.getThickness());
            o.num("rotation", t.getBaseRotation());
        }

        if (c instanceof RingComponent) {
            RingComponent r = (RingComponent) c;
            o.num("outerRadius", r.getOuterRadius());
            o.bool("outerRadiusAuto", r.isOuterRadiusAutomatic());
            o.num("innerRadius", r.getInnerRadius());
            o.bool("innerRadiusAuto", r.isInnerRadiusAutomatic());
            if (c instanceof ThicknessRingComponent) {
                o.num("thickness", ((ThicknessRingComponent) c).getThickness());
            }
            o.num("radialPosition", r.getRadialPosition());
            o.num("radialDirection", r.getRadialDirection());
            if (c instanceof InnerTube) {
                InnerTube t = (InnerTube) c;
                o.bool("motorMount", t.isMotorMount());
                o.num("motorOverhang", t.getMotorOverhang());
                defaultIgnition(o, t);
                o.str("cluster", t.getClusterConfiguration().getXMLName());
                o.num("clusterScale", t.getClusterScale());
                o.num("clusterRotation", t.getClusterRotation());
            }
            if (c instanceof RadiusRingComponent) {
                o.num("instanceCount", r.getInstanceCount());
                o.num("instanceSeparation", ((RadiusRingComponent) c).getInstanceSeparation());
            }
        }

        if (c instanceof LaunchLug) {
            LaunchLug l = (LaunchLug) c;
            o.num("outerRadius", l.getOuterRadius());
            o.num("thickness", l.getThickness());
            o.num("angleOffset", l.getAngleOffset());
            o.num("instanceCount", l.getInstanceCount());
            o.num("instanceSeparation", l.getInstanceSeparation());
        } else if (c instanceof RailButton) {
            RailButton b = (RailButton) c;
            o.num("outerDiameter", b.getOuterDiameter());
            o.num("innerDiameter", b.getInnerDiameter());
            o.num("height", b.getTotalHeight());
            o.num("baseHeight", b.getBaseHeight());
            o.num("flangeHeight", b.getFlangeHeight());
            o.num("screwHeight", b.getScrewHeight());
            o.num("angleOffset", b.getAngleOffset());
            o.num("instanceCount", b.getInstanceCount());
            o.num("instanceSeparation", b.getInstanceSeparation());
        }

        if (c instanceof MassObject) {
            MassObject m = (MassObject) c;
            o.num("radius", m.getRadius());
            o.bool("radiusAuto", m.isRadiusAutomatic());
            o.num("radialPosition", m.getRadialPosition());
            o.num("radialDirection", m.getRadialDirection());
        }
        if (c instanceof RecoveryDevice) {
            RecoveryDevice d = (RecoveryDevice) c;
            o.num("cd", d.getCD());
            o.bool("cdAuto", d.isCDAutomatic());
            DeploymentConfiguration dc = d.getDeploymentConfigurations().getDefault();
            o.str("deployEvent", dc.getDeployEvent().name());
            o.num("deployAltitude", dc.getDeployAltitude());
            o.num("deployDelay", dc.getDeployDelay());
        }
        if (c instanceof Parachute) {
            Parachute p = (Parachute) c;
            o.num("diameter", p.getDiameter());
            o.num("lineCount", p.getLineCount());
            o.num("lineLength", p.getLineLength());
        } else if (c instanceof Streamer) {
            Streamer s = (Streamer) c;
            o.num("stripLength", s.getStripLength());
            o.num("stripWidth", s.getStripWidth());
        } else if (c instanceof ShockCord) {
            o.num("cordLength", ((ShockCord) c).getCordLength());
        } else if (c instanceof MassComponent) {
            MassComponent m = (MassComponent) c;
            o.num("mass", m.getComponentMass());
            o.str("massComponentType", m.getMassComponentType().name());
        }

        if (c instanceof PodSet || c instanceof ParallelStage) {
            o.num("instanceCount", c.getInstanceCount());
            o.num("radiusOffset", ((RadiusPositionable) c).getRadiusOffset());
            o.str("radiusMethod", ((RadiusPositionable) c).getRadiusMethod().name());
            o.num("angleOffset", ((AnglePositionable) c).getAngleOffset());
            RadiusPositionable r = (RadiusPositionable) c;
            o.num("instanceRadius", r.getRadiusMethod().getRadius(c.getParent(), c, r.getRadiusOffset()));
        }
        if (c instanceof AxialStage) {
            StageSeparationConfiguration sep = ((AxialStage) c).getSeparationConfigurations().getDefault();
            o.str("separationEvent", sep.getSeparationEvent().name());
            o.num("separationDelay", sep.getSeparationDelay());
            o.num("separationAltitude", sep.getSeparationAltitude());
        }
        return o.done();
    }

    /**
     * The mount's own ignition (`getDefaultMotorConfig()`), in the app's names:
     * lowercase with the underscore dropped, as the .ork spells them.
     */
    private static void defaultIgnition(Out o, MotorMount mount) {
        MotorConfiguration config = mount.getDefaultMotorConfig();
        o.str("ignitionEvent", config.getIgnitionEvent().name().replace("_", ""));
        o.num("ignitionDelay", config.getIgnitionDelay());
    }

    /** A flat JSON object. A later key replaces nothing: each key is written once per class branch. */
    private static final class Out {
        private final StringBuilder sb = new StringBuilder("{");
        private final java.util.Set<String> seen = new java.util.HashSet<>();

        private boolean key(String k) {
            if (!seen.add(k)) return false;
            if (sb.length() > 1) sb.append(',');
            sb.append('"').append(k).append("\":");
            return true;
        }

        void num(String k, double v) {
            if (!key(k)) return;
            if (Double.isNaN(v) || Double.isInfinite(v)) sb.append("null");
            else sb.append(v);
        }

        void bool(String k, boolean v) {
            if (key(k)) sb.append(v);
        }

        /** Enumeration names only: plain ASCII, no escaping needed. */
        void str(String k, String v) {
            if (key(k)) sb.append('"').append(v.toLowerCase()).append('"');
        }

        /** Free text as the part carries it (a comment): escaped, case kept. */
        void text(String k, String v) {
            if (!key(k)) return;
            sb.append('"');
            escape(v == null ? "" : v);
            sb.append('"');
        }

        /** JSON string escaping for free text: quotes, backslashes and control characters. */
        private void escape(String v) {
            for (char ch : v.toCharArray()) {
                if (ch == '"' || ch == '\\') sb.append('\\').append(ch);
                else if (ch == '\n') sb.append("\\n");
                else if (ch == '\r') sb.append("\\r");
                else if (ch == '\t') sb.append("\\t");
                else if (ch < 0x20) sb.append(' ');
                else sb.append(ch);
            }
        }

        /** A material's name and density, under `<prefix>MaterialName` and `<prefix>Density`. */
        void material(String prefix, Material m) {
            if (m == null) return;
            String name = prefix.isEmpty() ? "materialName" : prefix + "MaterialName";
            if (key(name)) {
                sb.append('"');
                for (char ch : m.getName().toCharArray()) {
                    if (ch == '"' || ch == '\\') sb.append('\\').append(ch);
                    else if (ch < 0x20) sb.append(' ');
                    else sb.append(ch);
                }
                sb.append('"');
            }
            num(prefix.isEmpty() ? "density" : prefix + "Density", m.getDensity());
        }

        String done() {
            return sb.append('}').toString();
        }
    }
}
