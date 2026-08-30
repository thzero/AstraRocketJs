package parity;

import info.openrocket.core.masscalc.MassCalculator;
import info.openrocket.core.masscalc.RigidBody;
import info.openrocket.core.material.Material;
import info.openrocket.core.models.atmosphere.AtmosphericConditions;
import info.openrocket.core.models.atmosphere.ExtendedISAModel;
import info.openrocket.core.rocketcomponent.AxialStage;
import info.openrocket.core.rocketcomponent.BodyTube;
import info.openrocket.core.rocketcomponent.FlightConfiguration;
import info.openrocket.core.rocketcomponent.InnerTube;
import info.openrocket.core.rocketcomponent.NoseCone;
import info.openrocket.core.rocketcomponent.Parachute;
import info.openrocket.core.rocketcomponent.Rocket;
import info.openrocket.core.rocketcomponent.Transition;
import info.openrocket.core.rocketcomponent.TrapezoidFinSet;
import info.openrocket.core.util.Coordinate;
import info.openrocket.core.util.CoordinateIF;
import info.openrocket.core.util.Quaternion;

/**
 * JVM-vs-JS parity harness.
 *
 * Runs a fixed battery of engine calculations (atmosphere, mass/CG, aero CP/CD, full flights,
 * staging, clusters, etc.) and prints every result as a pipe-delimited line of raw
 * {@code Double.toString} values — no rounding, no locale, so the text is byte-comparable.
 *
 * The point is not the numbers themselves but that they are IDENTICAL on two runtimes: this
 * same class is compiled to the JVM and to TeaVM-JS, and {@code test/parity/parity.mjs} runs both
 * and diffs the output line-by-line. A mismatch means the browser build diverged from the
 * reference JVM (a TeaVM miscompile or unported dependency). This is a test artifact only —
 * compiled solely under {@code -Pparity}, never shipped in the production engine.
 */
public final class ParityMain {
    public static void main(String[] args) {
        atmosphereScenarios();
        quaternionScenarios();
        massScenarios();
        aeroScenarios();
        randomScenarios();
        flightScenarios();
        treeApiScenarios();
        conditionsScenarios();
        finVariantScenarios();
        dualDeployScenarios();
        clusterScenarios();
        stagingScenarios();
        podScenarios();
        dragSweepScenarios();
        minDiameterScenarios();
        airfoilSectionScenarios();
        rogersKbfScenarios();
        supersonicAeroScenarios();
        // nozzleBaseDragScenarios(): RASAero feature #2 is now upstream-native
        // (per-motor MotorConfiguration.nozzleExitDiameter). A native-model parity
        // scenario is deferred with the web nozzle-bridge migration.
    }

    /**
     * Opt-in supersonic aerodynamics (RASAero feature #1, Phase 1). With the
     * flag ON: corrected supersonic fin normal force (2D Busemann level with
     * finite-span correction — roughly doubles the clamped classic value),
     * exact NACA-1307 body-fin interference, Mach-dependent nose CNa growth,
     * and no M4.9 grid clamp. Locks CP/CNa at transonic, supersonic and
     * hypersonic Mach for both flag states — flag OFF must stay identical to
     * the classic values (also covered by existing paritys).
     */
    private static void supersonicAeroScenarios() {
        Rocket rocket = buildReferenceRocket();
        info.openrocket.core.rocketcomponent.FlightConfiguration config =
                rocket.getSelectedConfiguration();
        info.openrocket.core.logging.WarningSet w =
                new info.openrocket.core.logging.WarningSet();
        double[] machs = { 1.2, 2.0, 4.0, 8.0 };
        for (double mach : machs) {
            info.openrocket.core.aerodynamics.BarrowmanCalculator off =
                    new info.openrocket.core.aerodynamics.BarrowmanCalculator();
            info.openrocket.core.aerodynamics.FlightConditions cOff =
                    new info.openrocket.core.aerodynamics.FlightConditions(config);
            cOff.setMach(mach);
            cOff.setAOA(Math.toRadians(2));
            CoordinateIF cpOff = off.getCP(config, cOff, w);

            // feature #1 supersonicAero via the RASAero strategy pair.
            info.openrocket.core.aerodynamics.RASAeroStabilityCalculator stab =
                    new info.openrocket.core.aerodynamics.RASAeroStabilityCalculator();
            stab.setSupersonicAero(true);
            info.openrocket.core.aerodynamics.RASAeroDragCalculator drag =
                    new info.openrocket.core.aerodynamics.RASAeroDragCalculator();
            drag.setSupersonicAero(true);
            info.openrocket.core.aerodynamics.BarrowmanCalculator on =
                    new info.openrocket.core.aerodynamics.BarrowmanCalculator(stab, drag);
            info.openrocket.core.aerodynamics.FlightConditions cOn =
                    new info.openrocket.core.aerodynamics.FlightConditions(config);
            cOn.setMach(mach);
            cOn.setAOA(Math.toRadians(2));
            CoordinateIF cpOn = on.getCP(config, cOn, w);

            line("ssaero." + mach, cpOff.getX(), cpOff.getWeight(), cpOn.getX(), cpOn.getWeight());

            // Phase 2: lock the flag-on drag decomposition too.
            info.openrocket.core.aerodynamics.AerodynamicForces fOn =
                    on.getAerodynamicForces(config, cOn, w);
            line("ssaerocd." + mach, fOn.getCD(), fOn.getFrictionCD(),
                    fOn.getPressureCD(), fOn.getBaseCD());
        }
    }

    /**
     * RASAero feature #4: fin airfoil cross-sections. Input-gated (no flag):
     * a single-wedge section (thickness wave + fin base drag) and a hexagonal
     * section with an explicit LE radius, locked at subsonic/supersonic Mach.
     * The same tree WITHOUT airfoilSection is covered by existing paritys
     * (absent input = bit-identical classic).
     */
    private static void airfoilSectionScenarios() {
        String base = "{\"components\":[{\"type\":\"stage\",\"name\":\"S\",\"children\":["
                + "{\"type\":\"nosecone\",\"shape\":\"conical\",\"length\":0.085,\"aftRadius\":0.015,\"thickness\":0.0015},"
                + "{\"type\":\"bodytube\",\"length\":0.215,\"outerRadius\":0.015,\"thickness\":0.0015,\"children\":["
                + "  {\"type\":\"trapezoidfinset\",\"finCount\":4,\"rootChord\":0.03,\"tipChord\":0.03,\"sweep\":0,\"height\":0.03,\"thickness\":0.0024,%FIN%"
                + "\"position\":{\"method\":\"bottom\",\"offset\":0}}"
                + "]}]}]}";
        String[][] variants = {
                { "wedge", "\"airfoilSection\":\"singlewedge\"," },
                { "hexle", "\"airfoilSection\":\"hexagonal\",\"airfoilLeDiamond\":0.008,\"airfoilTeDiamond\":0.008,\"finLeRadius\":0.0004," },
        };
        for (String[] v : variants) {
            int r = api.OpenRocketEngine.buildRocket(base.replace("%FIN%", v[1]));
            String sweep = api.OpenRocketEngine.getDragSweep(r, "{\"machMin\":0.5,\"machMax\":3.5,\"machStep\":1.0}");
            java.util.Map<String, Object> parsed = api.JsonLite.parseObject(sweep);
            java.util.Map<String, Object> off = asMap(parsed.get("powerOff"));
            java.util.List<?> total = (java.util.List<?>) off.get("total");
            java.util.List<?> press = (java.util.List<?>) off.get("pressure");
            line("finsection." + v[0],
                    ((Number) total.get(0)).doubleValue(), ((Number) press.get(0)).doubleValue(),
                    ((Number) total.get(2)).doubleValue(), ((Number) press.get(2)).doubleValue());
        }
    }

    /**
     * Minimum-diameter rocket: the BODY TUBE itself is the motor mount (no
     * inner tube) — kernel BodyTube implements MotorMount, and setMotorById
     * must accept it. 24 mm airframe flying a 18 mm C6 loaded directly in the
     * tube, with a nozzle exit near the body diameter (the power-on base-drag
     * case min-diameter rockets exist for). Locks static info + flight summary.
     */
    private static void minDiameterScenarios() {
        String json = "{\"name\":\"MinDia\",\"components\":[{\"type\":\"stage\",\"name\":\"S\",\"nozzleExitDiameter\":0.014,\"children\":["
                + "{\"type\":\"nosecone\",\"length\":0.10,\"aftRadius\":0.012,\"thickness\":0.002},"
                + "{\"type\":\"bodytube\",\"id\":\"body\",\"length\":0.45,\"outerRadius\":0.012,\"thickness\":0.0005,\"density\":950,\"motorMount\":true,\"motorOverhang\":0.006,\"children\":["
                + "  {\"type\":\"trapezoidfinset\",\"finCount\":3,\"rootChord\":0.05,\"tipChord\":0.03,\"sweep\":0.02,\"height\":0.025,\"thickness\":0.003},"
                + "  {\"type\":\"parachute\",\"diameter\":0.30}"
                + "]}]}]}";
        int r = api.OpenRocketEngine.buildRocket(json);
        api.OpenRocketEngine.setMotorById(r, "body", "C6", 0.018, 0.070,
                new double[] { 0, 0.1, 0.3, 0.5, 1.0, 1.5, 1.85, 2.0 },
                new double[] { 0, 12.0, 6.0, 5.1, 4.9, 4.8, 4.5, 0 },
                new double[] { 0.0240, 0.0231, 0.0215, 0.0202, 0.0174, 0.0147, 0.0133, 0.0132 },
                0.035, 5.0);
        lineStaticInfo("mindia.info", api.OpenRocketEngine.getStaticInfo(r));

        String result = api.OpenRocketEngine.simulateJson(r, "{\"rodLength\":1.0}");
        java.util.Map<String, Object> parsed = api.JsonLite.parseObject(result);
        java.util.Map<String, Object> summary = asMap(parsed.get("summary"));
        line("flight.mindia",
                api.JsonLite.dbl(summary, "maxAltitude", Double.NaN),
                api.JsonLite.dbl(summary, "maxVelocity", Double.NaN),
                api.JsonLite.dbl(summary, "timeToApogee", Double.NaN));
    }

    /**
     * Opt-in Rogers Modified Barrowman body-fin interference (feature #3). With
     * the flag ON the fin set adds the Kbf body carryover (τ·cna at the fin root
     * quarter-chord), so total CNα rises and CP moves slightly AFT (more
     * conservative margin) vs classic Barrowman. Flag OFF must reproduce the
     * plain-Barrowman CP exactly (covered by the existing aero.cp paritys; here
     * we assert on≠off and the direction). Both JVM and JS run the patched calc.
     */
    private static void rogersKbfScenarios() {
        Rocket rocket = buildReferenceRocket();
        info.openrocket.core.rocketcomponent.FlightConfiguration config =
                rocket.getSelectedConfiguration();
        info.openrocket.core.logging.WarningSet w =
                new info.openrocket.core.logging.WarningSet();
        double[] machs = { 0.3, 0.8 };
        for (double mach : machs) {
            info.openrocket.core.aerodynamics.BarrowmanCalculator off =
                    new info.openrocket.core.aerodynamics.BarrowmanCalculator();
            info.openrocket.core.aerodynamics.FlightConditions cOff =
                    new info.openrocket.core.aerodynamics.FlightConditions(config);
            cOff.setMach(mach);
            cOff.setAOA(Math.toRadians(2));
            CoordinateIF cpOff = off.getCP(config, cOff, w);

            // feature #3 Rogers Kbf via the RASAero strategy pair.
            info.openrocket.core.aerodynamics.RASAeroStabilityCalculator stab =
                    new info.openrocket.core.aerodynamics.RASAeroStabilityCalculator();
            stab.setRogersKbf(true);
            info.openrocket.core.aerodynamics.RASAeroDragCalculator drag =
                    new info.openrocket.core.aerodynamics.RASAeroDragCalculator();
            drag.setRogersKbf(true);
            info.openrocket.core.aerodynamics.BarrowmanCalculator on =
                    new info.openrocket.core.aerodynamics.BarrowmanCalculator(stab, drag);
            info.openrocket.core.aerodynamics.FlightConditions cOn =
                    new info.openrocket.core.aerodynamics.FlightConditions(config);
            cOn.setMach(mach);
            cOn.setAOA(Math.toRadians(2));
            CoordinateIF cpOn = on.getCP(config, cOn, w);

            line("rogerskbf." + mach, cpOff.getX(), cpOff.getWeight(), cpOn.getX(), cpOn.getWeight());
        }
    }

    /**
     * Drag polar sweep bridge method (feature #5). Exercises getDragSweep over a
     * small Mach grid on a rocket with a stage nozzle set — power-off vs power-on
     * total/base CD must match JVM↔JS, and power-on base CD must be lower.
     */
    private static void dragSweepScenarios() {
        String json = "{\"components\":[{\"type\":\"stage\",\"name\":\"S\",\"nozzleExitDiameter\":0.016,\"children\":["
                + "{\"type\":\"nosecone\",\"length\":0.07,\"aftRadius\":0.012,\"thickness\":0.002},"
                + "{\"type\":\"bodytube\",\"length\":0.30,\"outerRadius\":0.012,\"thickness\":0.0005,\"density\":950,\"children\":["
                + "  {\"type\":\"trapezoidfinset\",\"finCount\":3,\"rootChord\":0.05,\"tipChord\":0.03,\"sweep\":0.02,\"height\":0.03,\"thickness\":0.003}"
                + "]}]}]}";
        int r = api.OpenRocketEngine.buildRocket(json);
        String sweep = api.OpenRocketEngine.getDragSweep(r, "{\"machMin\":0.3,\"machMax\":1.5,\"machStep\":0.6}");
        java.util.Map<String, Object> parsed = api.JsonLite.parseObject(sweep);
        java.util.List<?> machs = (java.util.List<?>) parsed.get("machs");
        java.util.Map<String, Object> off = asMap(parsed.get("powerOff"));
        java.util.Map<String, Object> on = asMap(parsed.get("powerOn"));
        java.util.List<?> offTotal = (java.util.List<?>) off.get("total");
        java.util.List<?> onTotal = (java.util.List<?>) on.get("total");
        java.util.List<?> offBase = (java.util.List<?>) off.get("base");
        java.util.List<?> onBase = (java.util.List<?>) on.get("base");
        for (int i = 0; i < machs.size(); i++) {
            line("dragsweep." + i,
                    (Double) machs.get(i),
                    (Double) offTotal.get(i), (Double) onTotal.get(i),
                    (Double) offBase.get(i), (Double) onBase.get(i));
        }
        java.util.List<?> comps = (java.util.List<?>) parsed.get("components");
        System.out.println("dragsweep.compcount|" + comps.size());
    }

    /**
     * RASAero power-on base-drag reduction (feature #2). The reference rocket's
     * body tube has an exposed aft base; setting a stage nozzle exit diameter
     * must LOWER the base CD (and total CD) while that stage's motor is thrusting
     * (power-on), and leave it unchanged during coast (power-off). Power-off must
     * exactly equal the no-nozzle base CD. Both JVM and JS run the patched
     * calculator, so the values must match bit-for-bit.
     */
    private static void nozzleBaseDragScenarios() {
        // PATCH(migration Stage 1): disabled — used the removed per-stage
        // setNozzleExitDiameter()/setThrustingStages() APIs. Feature #2 is now
        // upstream-native (per-motor MotorConfiguration.nozzleExitDiameter +
        // FlightConditions.thrustingNozzleExitAreas); re-add a native-model
        // scenario in Stage 2 alongside the web nozzle-bridge migration.
    }

    /**
     * Off-axis assemblies (PodSet / ParallelStage) through the tree API — the
     * newly-reachable ComponentAssemblyCalc / off-axis MassCalculation paths.
     * A symmetric 2-pod ring keeps CG on-axis but gains transverse/roll inertia
     * (parallel-axis term); a 1-instance pod shifts CG laterally (CM.y != 0);
     * a separating ParallelStage must spawn an extra flight branch.
     */
    private static void podScenarios() {
        // --- (A) Symmetric 2-pod set: on-axis CG, off-axis inertia ---
        String podJson = "{\"name\":\"Pod\",\"components\":[{\"type\":\"stage\",\"name\":\"Core\",\"children\":["
                + "{\"type\":\"nosecone\",\"length\":0.07,\"aftRadius\":0.012,\"thickness\":0.002},"
                + "{\"type\":\"bodytube\",\"length\":0.30,\"outerRadius\":0.012,\"thickness\":0.0003,\"density\":950,\"children\":["
                + "  {\"type\":\"podset\",\"id\":\"pod\",\"instanceCount\":2,\"radiusMethod\":\"relative\",\"radiusOffset\":0.005,"
                + "   \"angleOffset\":0,\"position\":{\"method\":\"bottom\",\"offset\":0},\"children\":["
                + "    {\"type\":\"bodytube\",\"length\":0.10,\"outerRadius\":0.008,\"thickness\":0.0003,\"density\":950,\"children\":["
                + "      {\"type\":\"trapezoidfinset\",\"finCount\":3,\"rootChord\":0.03,\"tipChord\":0.02,\"sweep\":0.01,\"height\":0.02,\"thickness\":0.002}"
                + "    ]}"
                + "  ]}"
                + "]}]}]}";
        int r = api.OpenRocketEngine.buildRocket(podJson);

        info.openrocket.core.rocketcomponent.Rocket rocket =
                (info.openrocket.core.rocketcomponent.Rocket) getRocketFromInfo(r);
        info.openrocket.core.rocketcomponent.PodSet pod = null;
        for (info.openrocket.core.rocketcomponent.RocketComponent comp : rocket) {
            if (comp instanceof info.openrocket.core.rocketcomponent.PodSet) {
                pod = (info.openrocket.core.rocketcomponent.PodSet) comp;
            }
        }
        CoordinateIF[] offs = pod.getInstanceOffsets();
        double[] geom = new double[2 + offs.length * 2];
        geom[0] = pod.getInstanceCount();
        geom[1] = pod.getAngleOffset();
        for (int i = 0; i < offs.length; i++) {
            geom[2 + i * 2] = offs[i].getY();
            geom[3 + i * 2] = offs[i].getZ();
        }
        line("pod.geometry", geom);
        lineStaticInfo("pod.info", api.OpenRocketEngine.getStaticInfo(r));
        lineComponentInfo("pod.comp", api.OpenRocketEngine.getComponentInfo(r, "pod"));

        RigidBody podStruct = MassCalculator.calculateStructure(rocket.getSelectedConfiguration());
        line("mass.pod.structure", podStruct.getMass(),
                podStruct.getCM().getX(),podStruct.getCM().getY(),podStruct.getCM().getZ(),
                podStruct.getIxx(), podStruct.getIyy(), podStruct.getIzz(),
                podStruct.getLongitudinalInertia(), podStruct.getRotationalInertia());

        // --- (B) Asymmetric 1-instance pod: lateral CG shift (CM.y != 0) ---
        int r1 = api.OpenRocketEngine.buildRocket(podJson.replace("\"instanceCount\":2", "\"instanceCount\":1"));
        RigidBody s1 = MassCalculator.calculateStructure(
                ((info.openrocket.core.rocketcomponent.Rocket) getRocketFromInfo(r1)).getSelectedConfiguration());
        line("mass.pod1.offaxis", s1.getMass(), s1.getCM().getX(),s1.getCM().getY(),s1.getCM().getZ(),
                s1.getIxx(), s1.getIyy(), s1.getIzz());

        // --- (C) Separating ParallelStage booster -> extra flight branch ---
        String boosterJson = "{\"name\":\"Booster\",\"components\":[{\"type\":\"stage\",\"name\":\"Core\",\"children\":["
                + "{\"type\":\"nosecone\",\"length\":0.07,\"aftRadius\":0.012,\"thickness\":0.002},"
                + "{\"type\":\"bodytube\",\"length\":0.30,\"outerRadius\":0.012,\"thickness\":0.0003,\"density\":950,\"children\":["
                + "  {\"type\":\"trapezoidfinset\",\"finCount\":3,\"rootChord\":0.05,\"tipChord\":0.03,\"sweep\":0.02,\"height\":0.03,\"thickness\":0.003},"
                + "  {\"type\":\"innertube\",\"id\":\"cmount\",\"length\":0.07,\"outerRadius\":0.0095,\"thickness\":0.0005,\"motorMount\":true,\"position\":{\"method\":\"bottom\",\"offset\":0}},"
                + "  {\"type\":\"parachute\",\"diameter\":0.30},"
                + "  {\"type\":\"parallelstage\",\"id\":\"boost\",\"instanceCount\":2,\"radiusMethod\":\"relative\",\"radiusOffset\":0,"
                + "   \"angleOffset\":0,\"angleMethod\":\"relative\",\"separationEvent\":\"burnout\",\"separationDelay\":0,\"position\":{\"method\":\"bottom\",\"offset\":0},\"children\":["
                + "    {\"type\":\"bodytube\",\"length\":0.12,\"outerRadius\":0.010,\"thickness\":0.0003,\"density\":950,\"children\":["
                + "      {\"type\":\"trapezoidfinset\",\"finCount\":3,\"rootChord\":0.04,\"tipChord\":0.02,\"sweep\":0.02,\"height\":0.03,\"thickness\":0.003},"
                + "      {\"type\":\"innertube\",\"id\":\"bmount\",\"length\":0.07,\"outerRadius\":0.0095,\"thickness\":0.0005,\"motorMount\":true,\"position\":{\"method\":\"bottom\",\"offset\":0}}"
                + "    ]}"
                + "  ]}"
                + "]}]}]}";
        int rb = api.OpenRocketEngine.buildRocket(boosterJson);
        double[] times = { 0, 0.1, 0.3, 0.5, 1.0, 1.5, 1.85, 2.0 };
        double[] thrusts = { 0, 12.0, 6.0, 5.1, 4.9, 4.8, 4.5, 0 };
        double[] masses = { 0.0240, 0.0231, 0.0215, 0.0202, 0.0174, 0.0147, 0.0133, 0.0132 };
        api.OpenRocketEngine.setMotorById(rb, "cmount", "C6", 0.018, 0.070, times, thrusts, masses, 0.035, 5.0);
        api.OpenRocketEngine.setMotorById(rb, "bmount", "C6", 0.018, 0.070, times, thrusts, masses, 0.035, 0.0);
        lineStaticInfo("para.info", api.OpenRocketEngine.getStaticInfo(rb));

        // maxTime cap: turbulent-descent ULP row-count drift (same reasoning as
        // conditions/staging). Assert branch COUNT + names EXACTLY; summary at tol.
        String result = api.OpenRocketEngine.simulateJson(rb, "{\"rodLength\":1.2,\"maxTime\":6}");
        java.util.Map<String, Object> parsed = api.JsonLite.parseObject(result);
        Object branchesObj = parsed.get("branches");
        StringBuilder names = new StringBuilder("para.branches|");
        if (branchesObj instanceof java.util.List) {
            java.util.List<?> branches = (java.util.List<?>) branchesObj;
            names.append(branches.size());
            for (Object b : branches) names.append('|').append(asMap(b).get("name"));
        } else {
            names.append("MISSING");
        }
        System.out.println(names);
        java.util.Map<String, Object> summary = asMap(parsed.get("summary"));
        line("flight.para.summary",
                api.JsonLite.dbl(summary, "maxAltitude", Double.NaN),
                api.JsonLite.dbl(summary, "maxVelocity", Double.NaN),
                api.JsonLite.dbl(summary, "timeToApogee", Double.NaN));
    }

    /**
     * Serial two-stage flights through the tree API. Two patterns from the
     * field (Eric's rules):
     * - "auto": low/mid-power gap staging — booster motor's ejection charge
     *   (delay 0) separates the booster AND lights the sustainer
     *   (IgnitionEvent.AUTOMATIC). Chuteless booster falls on its own branch.
     * - "timed": the high-power pattern — separation at booster burnout,
     *   sustainer lit by electronics (burnout + 1 s); booster recovers under
     *   its own chute on its own branch.
     * Locks: branch count/names, per-branch event sequences, per-branch
     * apogee/end-time (the sustainer must fly ~2 stages high; the booster
     * branch must end on its own GROUND_HIT).
     */
    private static void stagingScenarios() {
        runStagingScenario("auto", null, 0.0, false);
        runStagingScenario("timed", "burnout", 1.0, true);
    }

    private static void runStagingScenario(String name, String sustainerIgnition,
            double ignitionDelay, boolean boosterChute) {
        String sustainer = "{\"type\":\"stage\",\"name\":\"Sustainer\",\"children\":["
                + "{\"type\":\"nosecone\",\"length\":0.07,\"aftRadius\":0.012,\"thickness\":0.002},"
                + "{\"type\":\"bodytube\",\"length\":0.30,\"outerRadius\":0.012,\"thickness\":0.0003,\"density\":950,\"children\":["
                + "  {\"type\":\"trapezoidfinset\",\"finCount\":3,\"rootChord\":0.05,\"tipChord\":0.03,\"sweep\":0.02,\"height\":0.025,\"thickness\":0.003},"
                + "  {\"type\":\"innertube\",\"id\":\"smount\",\"length\":0.07,\"outerRadius\":0.0095,\"thickness\":0.0005,\"motorMount\":true,"
                + "   \"position\":{\"method\":\"bottom\",\"offset\":0}},"
                + "  {\"type\":\"parachute\",\"name\":\"SustainerChute\",\"diameter\":0.35}"
                + "]}]}";
        String booster = "{\"type\":\"stage\",\"name\":\"Booster\","
                + "\"separationEvent\":\"" + (sustainerIgnition == null ? "ejection" : "burnout") + "\",\"children\":["
                + "{\"type\":\"bodytube\",\"length\":0.12,\"outerRadius\":0.012,\"thickness\":0.0003,\"density\":950,\"children\":["
                + "  {\"type\":\"trapezoidfinset\",\"finCount\":3,\"rootChord\":0.05,\"tipChord\":0.03,\"sweep\":0.025,\"height\":0.035,\"thickness\":0.003},"
                + "  {\"type\":\"innertube\",\"id\":\"bmount\",\"length\":0.07,\"outerRadius\":0.0095,\"thickness\":0.0005,\"motorMount\":true,"
                + "   \"position\":{\"method\":\"bottom\",\"offset\":0}}"
                + (boosterChute ? ",{\"type\":\"parachute\",\"name\":\"BoosterChute\",\"diameter\":0.25}" : "")
                + "]}]}";
        int r = api.OpenRocketEngine.buildRocket(
                "{\"name\":\"TwoStage\",\"components\":[" + sustainer + "," + booster + "]}");

        double[] times = { 0, 0.1, 0.3, 0.5, 1.0, 1.5, 1.85, 2.0 };
        double[] thrusts = { 0, 12.0, 6.0, 5.1, 4.9, 4.8, 4.5, 0 };
        double[] masses = { 0.0240, 0.0231, 0.0215, 0.0202, 0.0174, 0.0147, 0.0133, 0.0132 };
        api.OpenRocketEngine.setMotorById(r, "smount", "C6", 0.018, 0.070, times, thrusts, masses, 0.035, 5.0);
        api.OpenRocketEngine.setMotorById(r, "bmount", "C6", 0.018, 0.070, times, thrusts, masses, 0.035, 0.0);
        if (sustainerIgnition != null) {
            api.OpenRocketEngine.setMotorIgnitionById(r, "smount", sustainerIgnition, ignitionDelay);
        }

        String result = api.OpenRocketEngine.simulateJson(r, "{\"rodLength\":1.0}");
        java.util.Map<String, Object> parsed = api.JsonLite.parseObject(result);
        Object branchesObj = parsed.get("branches");
        if (!(branchesObj instanceof java.util.List)) {
            System.out.println("staging." + name + ".branches|MISSING");
            return;
        }
        java.util.List<?> branches = (java.util.List<?>) branchesObj;
        StringBuilder names = new StringBuilder("staging." + name + ".branches|" + branches.size());
        for (Object b : branches) {
            names.append('|').append(asMap(b).get("name"));
        }
        System.out.println(names);

        for (int i = 0; i < branches.size(); i++) {
            java.util.Map<String, Object> b = asMap(branches.get(i));
            StringBuilder evs = new StringBuilder("staging." + name + ".b" + i + ".events");
            for (Object e : (java.util.List<?>) b.get("events")) {
                java.util.Map<String, Object> ev = asMap(e);
                evs.append('|').append(ev.get("type"));
                Object src = ev.get("source");
                if (src != null) evs.append('@').append(src);
            }
            System.out.println(evs);

            java.util.Map<String, Object> series = asMap(b.get("series"));
            java.util.List<?> alt = (java.util.List<?>) series.get("altitude");
            double maxAlt = 0;
            for (Object v : alt) {
                if (v instanceof Double && (Double) v > maxAlt) maxAlt = (Double) v;
            }
            // Apogee + separation time only: the END of a ~3-minute chute
            // descent accumulates transcendental ULP noise (end time drifts
            // ~1e-6 rel, sample count ±1) — same class as the turbulent-
            // scenario cap. The event SEQUENCES above are exact strings.
            double sepTime = Double.NaN;
            for (Object e : (java.util.List<?>) b.get("events")) {
                java.util.Map<String, Object> ev = asMap(e);
                if ("STAGE_SEPARATION".equals(ev.get("type"))) {
                    sepTime = api.JsonLite.dbl(ev, "time", Double.NaN);
                    break;
                }
            }
            line("flight.staging." + name + ".b" + i, maxAlt, sepTime);
        }
    }

    /**
     * Clustered motor mount: identical airframe flown with a single mount vs
     * a 3-ring cluster of the same motor. The kernel fires the cluster as
     * thrust×count with mass/inertia at the cluster geometry points — the
     * cluster flight must show ~3× the loaded-motor mass delta and a much
     * higher max acceleration. Also asserts the cluster geometry itself
     * (count + tube offsets) so a silently-ignored cluster param can't pass.
     */
    private static void clusterScenarios() {
        for (String pattern : new String[] { null, "3-ring" }) {
            String name = pattern == null ? "single" : "ring3";
            String clusterAttrs = pattern == null ? ""
                    : ",\"cluster\":\"" + pattern + "\",\"clusterScale\":1.0,\"clusterRotation\":0.5235987755982988";
            String json = "{\"name\":\"Cluster\",\"components\":["
                    + "{\"type\":\"nosecone\",\"length\":0.12,\"aftRadius\":0.033,\"thickness\":0.002},"
                    + "{\"type\":\"bodytube\",\"length\":0.45,\"outerRadius\":0.033,\"thickness\":0.001,\"density\":950,\"children\":["
                    + "  {\"type\":\"trapezoidfinset\",\"finCount\":3,\"rootChord\":0.09,\"tipChord\":0.05,\"sweep\":0.04,\"height\":0.06,\"thickness\":0.003},"
                    + "  {\"type\":\"innertube\",\"id\":\"mount\",\"length\":0.075,\"outerRadius\":0.0095,\"thickness\":0.0005,\"motorMount\":true"
                    + clusterAttrs + ",\"position\":{\"method\":\"bottom\",\"offset\":0}},"
                    + "  {\"type\":\"parachute\",\"diameter\":0.45}"
                    + "]}]}";
            int r = api.OpenRocketEngine.buildRocket(json);

            // Geometry assertion straight off the kernel component.
            info.openrocket.core.rocketcomponent.Rocket rocket =
                    (info.openrocket.core.rocketcomponent.Rocket) getRocketFromInfo(r);
            info.openrocket.core.rocketcomponent.InnerTube mount = null;
            for (info.openrocket.core.rocketcomponent.RocketComponent comp : rocket) {
                if (comp instanceof info.openrocket.core.rocketcomponent.InnerTube) {
                    mount = (info.openrocket.core.rocketcomponent.InnerTube) comp;
                }
            }
            CoordinateIF[] offsets = mount.getInstanceOffsets();
            double[] geom = new double[1 + offsets.length * 2];
            geom[0] = mount.getInstanceCount();
            for (int i = 0; i < offsets.length; i++) {
                geom[1 + i * 2] = offsets[i].getY();
                geom[2 + i * 2] = offsets[i].getZ();
            }
            line("cluster." + name + ".geometry", geom);

            api.OpenRocketEngine.setMotorById(r, "mount", "C6", 0.018, 0.070,
                    new double[] { 0, 0.1, 0.3, 0.5, 1.0, 1.5, 1.85, 2.0 },
                    new double[] { 0, 12.0, 6.0, 5.1, 4.9, 4.8, 4.5, 0 },
                    new double[] { 0.0240, 0.0231, 0.0215, 0.0202, 0.0174, 0.0147, 0.0133, 0.0132 },
                    0.035, 4.0);
            lineStaticInfo("cluster." + name + ".info", api.OpenRocketEngine.getStaticInfo(r));

            String result = api.OpenRocketEngine.simulateJson(r, "{\"rodLength\":1.0}");
            java.util.Map<String, Object> parsed = api.JsonLite.parseObject(result);
            java.util.Map<String, Object> summary = asMap(parsed.get("summary"));
            line("flight.cluster." + name,
                    api.JsonLite.dbl(summary, "maxAltitude", Double.NaN),
                    api.JsonLite.dbl(summary, "maxVelocity", Double.NaN),
                    api.JsonLite.dbl(summary, "maxAcceleration", Double.NaN),
                    api.JsonLite.dbl(summary, "timeToApogee", Double.NaN),
                    api.JsonLite.dbl(summary, "flightTime", Double.NaN));
        }
    }

    /**
     * Dual deployment: drogue at apogee + main at 150 m AGL. Events must
     * carry their SOURCE component name so the app can tell WHICH device
     * deployed (drogue vs main) — safety thresholds differ per stage.
     */
    private static void dualDeployScenarios() {
        String rocket = "{\"name\":\"DualDeploy\",\"components\":["
                + "{\"type\":\"nosecone\",\"length\":0.07,\"aftRadius\":0.012,\"thickness\":0.002},"
                + "{\"type\":\"bodytube\",\"length\":0.30,\"outerRadius\":0.012,\"thickness\":0.0003,\"density\":950,\"children\":["
                + "  {\"type\":\"trapezoidfinset\",\"finCount\":3,\"rootChord\":0.05,\"tipChord\":0.03,\"sweep\":0.02,\"height\":0.03,\"thickness\":0.003},"
                + "  {\"type\":\"innertube\",\"id\":\"mount\",\"length\":0.07,\"outerRadius\":0.0095,\"thickness\":0.0005,\"motorMount\":true},"
                + "  {\"type\":\"parachute\",\"name\":\"Drogue\",\"diameter\":0.15,\"deployEvent\":\"apogee\"},"
                + "  {\"type\":\"parachute\",\"name\":\"Main\",\"diameter\":0.45,\"deployEvent\":\"altitude\",\"deployAltitude\":150}"
                + "]}]}";
        int r = api.OpenRocketEngine.buildRocket(rocket);
        api.OpenRocketEngine.setMotorById(r, "mount", "C6", 0.018, 0.070,
                new double[] { 0, 0.1, 0.3, 0.5, 1.0, 1.5, 1.85, 2.0 },
                new double[] { 0, 12.0, 6.0, 5.1, 4.9, 4.8, 4.5, 0 },
                new double[] { 0.0240, 0.0231, 0.0215, 0.0202, 0.0174, 0.0147, 0.0133, 0.0132 },
                0.035, 5.0);
        String result = api.OpenRocketEngine.simulateJson(r, "{\"rodLength\":1.0}");
        java.util.Map<String, Object> parsed = api.JsonLite.parseObject(result);
        Object events = parsed.get("events");
        StringBuilder sources = new StringBuilder("flight.dualdeploy.sources");
        java.util.List<Double> times = new java.util.ArrayList<>();
        if (events instanceof java.util.List) {
            for (Object e : (java.util.List<?>) events) {
                if (!(e instanceof java.util.Map)) continue;
                java.util.Map<String, Object> ev = asMap(e);
                if ("RECOVERY_DEVICE_DEPLOYMENT".equals(ev.get("type"))) {
                    sources.append('|').append(ev.get("source"));
                    times.add(api.JsonLite.dbl(ev, "time", Double.NaN));
                }
            }
        }
        // Sources compare exactly (strings); times get flight.* tolerance.
        System.out.println(sources);
        double[] t = new double[times.size()];
        for (int i = 0; i < times.size(); i++) t[i] = times.get(i);
        line("flight.dualdeploy.times", t);
    }

    @SuppressWarnings("unchecked")
    private static java.util.Map<String, Object> asMap(Object o) {
        return (java.util.Map<String, Object>) o;
    }

    /** Cross-sections and freeform fins through the tree API. */
    private static void finVariantScenarios() {
        // Same reference rocket, airfoil cross-section: CD must drop vs square.
        for (String cs : new String[] { "square", "rounded", "airfoil" }) {
            String json = "{\"components\":["
                    + "{\"type\":\"nosecone\",\"length\":0.07,\"aftRadius\":0.012,\"thickness\":0.002},"
                    + "{\"type\":\"bodytube\",\"length\":0.30,\"outerRadius\":0.012,\"thickness\":0.0003,\"density\":950,\"children\":["
                    + "  {\"type\":\"trapezoidfinset\",\"finCount\":3,\"rootChord\":0.05,\"tipChord\":0.03,\"sweep\":0.02,\"height\":0.03,\"thickness\":0.003,\"crossSection\":\"" + cs + "\"}"
                    + "]}]}";
            int r = api.OpenRocketEngine.buildRocket(json);
            info.openrocket.core.rocketcomponent.FlightConfiguration config =
                    ((info.openrocket.core.rocketcomponent.Rocket)
                            getRocketFromInfo(r)).getSelectedConfiguration();
            info.openrocket.core.aerodynamics.BarrowmanCalculator calc =
                    new info.openrocket.core.aerodynamics.BarrowmanCalculator();
            info.openrocket.core.aerodynamics.FlightConditions cond =
                    new info.openrocket.core.aerodynamics.FlightConditions(config);
            cond.setMach(0.3);
            cond.setAOA(0);
            info.openrocket.core.logging.WarningSet w = new info.openrocket.core.logging.WarningSet();
            info.openrocket.core.aerodynamics.AerodynamicForces f =
                    calc.getAerodynamicForces(config, cond, w);
            line("fins.crosssection." + cs, f.getCD(), f.getFrictionCD(), f.getPressureCD());
        }

        // Freeform fin set: swept clipped-delta planform.
        String freeform = "{\"components\":["
                + "{\"type\":\"nosecone\",\"length\":0.07,\"aftRadius\":0.012,\"thickness\":0.002},"
                + "{\"type\":\"bodytube\",\"length\":0.30,\"outerRadius\":0.012,\"thickness\":0.0003,\"density\":950,\"children\":["
                + "  {\"type\":\"freeformfinset\",\"finCount\":3,\"thickness\":0.003,\"crossSection\":\"airfoil\","
                + "   \"points\":[[0,0],[0.03,0.035],[0.055,0.035],[0.06,0.0]],"
                + "   \"position\":{\"method\":\"bottom\",\"offset\":0}}"
                + "]}]}";
        int r2 = api.OpenRocketEngine.buildRocket(freeform);
        lineStaticInfo("fins.freeform.info", api.OpenRocketEngine.getStaticInfo(r2));

        finTabScenarios();
    }

    /**
     * Fin tabs (through-the-wall): tab volume must add mass and shift CG;
     * per-component info must expose the (all-fins) mass and subtree mass.
     */
    private static void finTabScenarios() {
        // Trapezoid fins, no tab vs 10 mm-deep × 30 mm-long tab.
        String noTab = "{\"components\":["
                + "{\"type\":\"nosecone\",\"length\":0.07,\"aftRadius\":0.012,\"thickness\":0.002},"
                + "{\"type\":\"bodytube\",\"id\":\"body\",\"length\":0.30,\"outerRadius\":0.012,\"thickness\":0.0003,\"density\":950,\"children\":["
                + "  {\"type\":\"trapezoidfinset\",\"id\":\"fins\",\"finCount\":3,\"rootChord\":0.05,\"tipChord\":0.03,\"sweep\":0.02,\"height\":0.03,\"thickness\":0.003,\"density\":680,"
                + "   \"position\":{\"method\":\"bottom\",\"offset\":0}}"
                + "]}]}";
        int rPlain = api.OpenRocketEngine.buildRocket(noTab);
        lineStaticInfo("fins.tab.none", api.OpenRocketEngine.getStaticInfo(rPlain));
        lineComponentInfo("fins.tab.none.comp", api.OpenRocketEngine.getComponentInfo(rPlain, "fins"));

        String withTab = noTab.replace("\"position\":{\"method\":\"bottom\",\"offset\":0}}",
                "\"position\":{\"method\":\"bottom\",\"offset\":0},"
                + "\"tabHeight\":0.010,\"tabLength\":0.030,\"tabOffset\":0,\"tabOffsetMethod\":\"middle\"}");
        int rTab = api.OpenRocketEngine.buildRocket(withTab);
        lineStaticInfo("fins.tab.10mm", api.OpenRocketEngine.getStaticInfo(rTab));
        lineComponentInfo("fins.tab.10mm.comp", api.OpenRocketEngine.getComponentInfo(rTab, "fins"));
        lineComponentInfo("fins.tab.10mm.body", api.OpenRocketEngine.getComponentInfo(rTab, "body"));

        // Tab height beyond the body radius must clamp (kernel validation).
        String clamped = noTab.replace("\"position\":{\"method\":\"bottom\",\"offset\":0}}",
                "\"position\":{\"method\":\"bottom\",\"offset\":0},"
                + "\"tabHeight\":0.5,\"tabLength\":0.030}");
        int rClamp = api.OpenRocketEngine.buildRocket(clamped);
        lineComponentInfo("fins.tab.clamped.comp", api.OpenRocketEngine.getComponentInfo(rClamp, "fins"));

        // Freeform fins with a tab.
        String ffTab = "{\"components\":["
                + "{\"type\":\"nosecone\",\"length\":0.07,\"aftRadius\":0.012,\"thickness\":0.002},"
                + "{\"type\":\"bodytube\",\"length\":0.30,\"outerRadius\":0.012,\"thickness\":0.0003,\"density\":950,\"children\":["
                + "  {\"type\":\"freeformfinset\",\"id\":\"ff\",\"finCount\":3,\"thickness\":0.003,\"crossSection\":\"airfoil\",\"density\":680,"
                + "   \"points\":[[0,0],[0.03,0.035],[0.055,0.035],[0.06,0.0]],"
                + "   \"tabHeight\":0.008,\"tabLength\":0.025,\"tabOffset\":0,\"tabOffsetMethod\":\"middle\","
                + "   \"position\":{\"method\":\"bottom\",\"offset\":0}}"
                + "]}]}";
        int rFf = api.OpenRocketEngine.buildRocket(ffTab);
        lineStaticInfo("fins.tab.freeform", api.OpenRocketEngine.getStaticInfo(rFf));
        lineComponentInfo("fins.tab.freeform.comp", api.OpenRocketEngine.getComponentInfo(rFf, "ff"));
    }

    private static void lineComponentInfo(String tag, String json) {
        java.util.Map<String, Object> info = api.JsonLite.parseObject(json);
        line(tag,
                api.JsonLite.dbl(info, "length", Double.NaN),
                api.JsonLite.dbl(info, "mass", Double.NaN),
                api.JsonLite.dbl(info, "sectionMass", Double.NaN),
                api.JsonLite.dbl(info, "cgX", Double.NaN),
                api.JsonLite.dbl(info, "positionX", Double.NaN));
    }

    /** Reflection-free accessor: rebuild handle context via the public API. */
    private static Object getRocketFromInfo(int handle) {
        return api.OpenRocketEngine.getRocketForTesting(handle);
    }

    /** P2.4: custom launch conditions (wind + site atmosphere) through the API. */
    private static void conditionsScenarios() {
        String reference = "{\"name\":\"Ref\",\"components\":["
                + "{\"type\":\"nosecone\",\"length\":0.07,\"aftRadius\":0.012,\"thickness\":0.002,\"shape\":\"ogive\"},"
                + "{\"type\":\"bodytube\",\"length\":0.30,\"outerRadius\":0.012,\"thickness\":0.0003,\"density\":950,\"children\":["
                + "  {\"type\":\"trapezoidfinset\",\"finCount\":3,\"rootChord\":0.05,\"tipChord\":0.03,\"sweep\":0.02,\"height\":0.03,\"thickness\":0.003},"
                + "  {\"type\":\"innertube\",\"id\":\"mount\",\"length\":0.07,\"outerRadius\":0.0095,\"thickness\":0.0005,\"motorMount\":true},"
                + "  {\"type\":\"parachute\",\"diameter\":0.30}"
                + "]}]}";
        int r = api.OpenRocketEngine.buildRocket(reference);
        api.OpenRocketEngine.setMotorById(r, "mount", "C6", 0.018, 0.070,
                new double[] { 0, 0.1, 0.3, 0.5, 1.0, 1.5, 1.85, 2.0 },
                new double[] { 0, 12.0, 6.0, 5.1, 4.9, 4.8, 4.5, 0 },
                new double[] { 0.0240, 0.0231, 0.0215, 0.0202, 0.0174, 0.0147, 0.0133, 0.0132 },
                0.035, 5.0);

        // Windy launch from a hot high-altitude site with low pressure.
        // maxTime caps the flight just past apogee (~6.8 s) and deployment
        // (~7.2 s): a turbulent sim is chaotic, and over a ~100 s descent the
        // JVM-vs-JS transcendental ULP noise amplifies until the adaptive
        // stepper's ROW COUNT flips — a structural diff no numeric tolerance
        // absorbs. 8 s keeps full coverage (wind, atmosphere, deployment,
        // every series) while staying within comparable drift.
        String result = api.OpenRocketEngine.simulateJson(r, "{"
                + "\"rodLength\":1.2,\"rodAngle\":0.087,\"windAverage\":3.0,"
                + "\"windStdDeviation\":0.6,\"launchAltitude\":1400,"
                + "\"temperature\":303.15,\"pressure\":86000,\"randomSeed\":7,"
                + "\"maxTime\":8}");
        java.util.Map<String, Object> parsed = api.JsonLite.parseObject(result);
        java.util.Map<String, Object> summary = api.JsonLite.obj(parsed, "summary");
        line("flight.conditions.summary",
                api.JsonLite.dbl(summary, "maxAltitude", Double.NaN),
                api.JsonLite.dbl(summary, "maxVelocity", Double.NaN),
                api.JsonLite.dbl(summary, "timeToApogee", Double.NaN),
                api.JsonLite.dbl(summary, "groundHitVelocity", Double.NaN));
        line("flight.conditions.summaryext",
                api.JsonLite.dbl(summary, "maxMachNumber", Double.NaN),
                api.JsonLite.dbl(summary, "launchRodVelocity", Double.NaN),
                api.JsonLite.dbl(summary, "deploymentVelocity", Double.NaN),
                api.JsonLite.dbl(summary, "optimumDelay", Double.NaN));

        // Extended series exist and have consistent lengths.
        java.util.Map<String, Object> series = api.JsonLite.obj(parsed, "series");
        String[] keys = { "time", "altitude", "velocity", "acceleration", "mass",
                "thrust", "drag", "mach", "stability", "cpLocation", "cgLocation", "aoa" };
        double[] sizes = new double[keys.length];
        for (int i = 0; i < keys.length; i++) {
            Object arr = series.get(keys[i]);
            sizes[i] = arr instanceof java.util.List ? ((java.util.List<?>) arr).size() : -1;
        }
        line("flight.conditions.serieslens", sizes);
    }

    /**
     * P2.1: the JSON tree API must produce identical physics to direct
     * construction, and the extended component set must compute consistent
     * mass/CP on both JVM and TeaVM.
     */
    private static void treeApiScenarios() {
        // Same reference rocket, built via the JSON tree API.
        String reference = "{\"name\":\"Ref\",\"components\":["
                + "{\"type\":\"nosecone\",\"length\":0.07,\"aftRadius\":0.012,\"thickness\":0.002,\"shape\":\"ogive\"},"
                + "{\"type\":\"bodytube\",\"length\":0.30,\"outerRadius\":0.012,\"thickness\":0.0003,\"density\":950,\"children\":["
                + "  {\"type\":\"trapezoidfinset\",\"finCount\":3,\"rootChord\":0.05,\"tipChord\":0.03,\"sweep\":0.02,\"height\":0.03,\"thickness\":0.003},"
                + "  {\"type\":\"innertube\",\"id\":\"mount\",\"length\":0.07,\"outerRadius\":0.0095,\"thickness\":0.0005,\"motorMount\":true},"
                + "  {\"type\":\"parachute\",\"diameter\":0.30}"
                + "]}]}";
        int r1 = api.OpenRocketEngine.buildRocket(reference);
        line("tree.api.ref", 1);
        lineStaticInfo("tree.info.ref", api.OpenRocketEngine.getStaticInfo(r1));

        // Extended component set: transition, coupler, rings, lug, streamer,
        // shock cord, mass component, elliptical fins.
        String extended = "{\"name\":\"Extended\",\"components\":["
                + "{\"type\":\"nosecone\",\"length\":0.1,\"aftRadius\":0.0125,\"thickness\":0.002,\"shape\":\"haack\"},"
                + "{\"type\":\"bodytube\",\"length\":0.35,\"outerRadius\":0.0125,\"thickness\":0.0005,\"density\":950,\"children\":["
                + "  {\"type\":\"ellipticalfinset\",\"finCount\":4,\"rootChord\":0.06,\"height\":0.04,\"thickness\":0.003},"
                + "  {\"type\":\"launchlug\",\"length\":0.05,\"outerRadius\":0.0025,\"thickness\":0.0004,"
                + "   \"position\":{\"method\":\"middle\",\"offset\":0}},"
                + "  {\"type\":\"innertube\",\"id\":\"mount\",\"length\":0.08,\"outerRadius\":0.012,\"thickness\":0.0005,\"motorMount\":true,"
                + "   \"position\":{\"method\":\"bottom\",\"offset\":0},\"children\":["
                + "    {\"type\":\"engineblock\",\"length\":0.005,\"thickness\":0.001,\"position\":{\"method\":\"top\",\"offset\":0}}"
                + "  ]},"
                + "  {\"type\":\"centeringring\",\"length\":0.002,\"position\":{\"method\":\"bottom\",\"offset\":-0.01}},"
                + "  {\"type\":\"centeringring\",\"length\":0.002,\"position\":{\"method\":\"bottom\",\"offset\":-0.07}},"
                + "  {\"type\":\"streamer\",\"stripLength\":0.6,\"stripWidth\":0.05,\"position\":{\"method\":\"top\",\"offset\":0.02}},"
                + "  {\"type\":\"shockcord\",\"cordLength\":0.4,\"position\":{\"method\":\"top\",\"offset\":0.01}},"
                + "  {\"type\":\"masscomponent\",\"mass\":0.015,\"length\":0.02,\"radius\":0.006,\"position\":{\"method\":\"top\",\"offset\":0.05}}"
                + "]},"
                + "{\"type\":\"transition\",\"length\":0.04,\"foreRadius\":0.0125,\"aftRadius\":0.009,\"thickness\":0.001,\"shape\":\"conical\",\"density\":680}"
                + "]}";
        int r2 = api.OpenRocketEngine.buildRocket(extended);
        lineStaticInfo("tree.info.ext", api.OpenRocketEngine.getStaticInfo(r2));
    }

    /** Re-parse the API's JSON (JsonLite) into numeric parity fields so the
     *  differential comparator can apply per-field ULP tolerance. */
    private static void lineStaticInfo(String tag, String json) {
        java.util.Map<String, Object> info = api.JsonLite.parseObject(json);
        line(tag,
                api.JsonLite.dbl(info, "length", Double.NaN),
                api.JsonLite.dbl(info, "mass", Double.NaN),
                api.JsonLite.dbl(info, "cg", Double.NaN),
                api.JsonLite.dbl(info, "cp", Double.NaN),
                api.JsonLite.dbl(info, "cna", Double.NaN),
                api.JsonLite.dbl(info, "stabilityCalibers", Double.NaN),
                api.JsonLite.dbl(info, "warnings", Double.NaN));
    }

    /** java.util.Random is algorithm-specified (LCG) — verify TeaVM matches. */
    private static void randomScenarios() {
        java.util.Random r = new java.util.Random(42);
        line("random.seeded42", r.nextDouble(), r.nextDouble(), r.nextGaussian(), r.nextGaussian());
    }

    /** P1.4: full 6DOF flight — C6-class motor, no wind, ISA, WGS gravity. */
    private static void flightScenarios() {
        Rocket rocket = buildReferenceRocket();
        // Dedicated flight configuration (motors cannot attach to the default config).
        info.openrocket.core.rocketcomponent.FlightConfigurationId fcid =
                new info.openrocket.core.rocketcomponent.FlightConfigurationId(
                        "00000001-0001-4001-8001-000000000001");
        rocket.createFlightConfiguration(fcid);
        rocket.setSelectedConfiguration(fcid);

        // C6-class motor built from explicit data points (deterministic; no db).
        info.openrocket.core.motor.ThrustCurveMotor motor =
                new info.openrocket.core.motor.ThrustCurveMotor.Builder()
                        .setManufacturer(info.openrocket.core.motor.Manufacturer.getManufacturer("Estes"))
                        .setDesignation("C6")
                        .setCommonName("C6")
                        .setMotorType(info.openrocket.core.motor.Motor.Type.SINGLE)
                        .setStandardDelays(new double[] { 3, 5, 7 })
                        .setDiameter(0.018)
                        .setLength(0.070)
                        .setTimePoints(new double[] { 0, 0.1, 0.3, 0.5, 1.0, 1.5, 1.85, 2.0 })
                        .setThrustPoints(new double[] { 0, 12.0, 6.0, 5.1, 4.9, 4.8, 4.5, 0 })
                        .setCGPoints(new Coordinate[] {
                                new Coordinate(0.035, 0, 0, 0.0240), new Coordinate(0.035, 0, 0, 0.0231),
                                new Coordinate(0.035, 0, 0, 0.0215), new Coordinate(0.035, 0, 0, 0.0202),
                                new Coordinate(0.035, 0, 0, 0.0174), new Coordinate(0.035, 0, 0, 0.0147),
                                new Coordinate(0.035, 0, 0, 0.0133), new Coordinate(0.035, 0, 0, 0.0132) })
                        .setDigest("harness-c6")
                        .build();

        // Attach to the inner-tube mount.
        InnerTube mount = null;
        for (info.openrocket.core.rocketcomponent.RocketComponent c
                : rocket.getSelectedConfiguration().getAllComponents()) {
            if (c instanceof InnerTube) {
                mount = (InnerTube) c;
            }
        }
        mount.setMotorMount(true);
        info.openrocket.core.motor.MotorConfiguration mc =
                new info.openrocket.core.motor.MotorConfiguration(mount, fcid);
        mc.setMotor(motor);
        mc.setEjectionDelay(5.0);
        mount.setMotorConfig(mc, fcid);

        info.openrocket.core.simulation.SimulationConditions conditions =
                new info.openrocket.core.simulation.SimulationConditions();
        conditions.setSimulation(new info.openrocket.core.document.Simulation(rocket, fcid));
        conditions.setLaunchRodLength(1.0);
        conditions.setLaunchRodAngle(0.0);
        conditions.setLaunchRodDirection(Math.PI / 2);
        conditions.setLaunchSite(new info.openrocket.core.util.WorldCoordinate(28.61, -80.60, 0));
        conditions.setGeodeticComputation(info.openrocket.core.util.GeodeticComputationStrategy.SPHERICAL);
        conditions.setAtmosphericModel(new ExtendedISAModel());
        conditions.setGravityModel(new info.openrocket.core.models.gravity.WGSGravityModel());
        info.openrocket.core.models.wind.PinkNoiseWindModel wind =
                new info.openrocket.core.models.wind.PinkNoiseWindModel();
        wind.setAverage(0.0);
        wind.setStandardDeviation(0.0);
        conditions.setWindModel(wind);
        conditions.setAerodynamicCalculator(new info.openrocket.core.aerodynamics.BarrowmanCalculator());
        conditions.setMassCalculator(new MassCalculator());
        conditions.setTimeStep(0.05);
        conditions.setMaxSimulationTime(1200);
        conditions.setRandomSeed(42);

        try {
            info.openrocket.core.simulation.BasicEventSimulationEngine engine =
                    new info.openrocket.core.simulation.BasicEventSimulationEngine();
            engine.simulate(conditions);
            info.openrocket.core.simulation.FlightData data = engine.getFlightData();

            line("flight.summary", data.getMaxAltitude(), data.getMaxVelocity(),
                    data.getMaxAcceleration(), data.getTimeToApogee(),
                    data.getFlightTime(), data.getGroundHitVelocity(), data.getBranchCount());

            info.openrocket.core.simulation.FlightDataBranch branch = data.getBranch(0);
            for (info.openrocket.core.simulation.FlightEvent ev : branch.getEvents()) {
                line("flight.event." + ev.getType().name(), ev.getTime());
                if (ev.getData() != null) {
                    System.out.println("flight.eventdata|" + ev.getType().name() + "|" + ev.getData());
                }
            }

            java.util.List<Double> t = branch.get(
                    info.openrocket.core.simulation.FlightDataType.TYPE_TIME);
            java.util.List<Double> alt = branch.get(
                    info.openrocket.core.simulation.FlightDataType.TYPE_ALTITUDE);
            java.util.List<Double> vel = branch.get(
                    info.openrocket.core.simulation.FlightDataType.TYPE_VELOCITY_TOTAL);
            java.util.List<Double> acc = branch.get(
                    info.openrocket.core.simulation.FlightDataType.TYPE_ACCELERATION_TOTAL);
            line("flight.rows", t.size());
            if (alt != null && vel != null && acc != null) {
                for (int i = 0; i < t.size(); i += 25) {
                    line("flight.sample." + i, t.get(i), alt.get(i), vel.get(i), acc.get(i));
                }
            }
        } catch (info.openrocket.core.simulation.exception.SimulationException e) {
            line("flight.exception", -1);
            System.out.println("EXCEPTION: " + e);
        }
    }

    /** P1.3: Extended-Barrowman CP and force coefficients across Mach and AoA. */
    private static void aeroScenarios() {
        Rocket rocket = buildReferenceRocket();
        FlightConfiguration config = rocket.getSelectedConfiguration();
        info.openrocket.core.aerodynamics.BarrowmanCalculator calc =
                new info.openrocket.core.aerodynamics.BarrowmanCalculator();
        info.openrocket.core.logging.WarningSet warnings =
                new info.openrocket.core.logging.WarningSet();

        double[] machs = { 0.1, 0.3, 0.5, 0.8, 0.95, 1.05, 1.5, 2.0 };
        double[] aoasDeg = { 0, 2, 5, 15 };

        for (double mach : machs) {
            for (double aoaDeg : aoasDeg) {
                info.openrocket.core.aerodynamics.FlightConditions conditions =
                        new info.openrocket.core.aerodynamics.FlightConditions(config);
                conditions.setMach(mach);
                conditions.setAOA(Math.toRadians(aoaDeg));

                warnings.clear();
                CoordinateIF cp = calc.getCP(config, conditions, warnings);
                info.openrocket.core.aerodynamics.AerodynamicForces forces =
                        calc.getAerodynamicForces(config, conditions, warnings);

                line("aero.cp", mach, aoaDeg, cp.getX(), cp.getWeight());
                line("aero.forces", mach, aoaDeg,
                        forces.getCN(), forces.getCm(), forces.getCD(),
                        forces.getCDaxial(), forces.getPressureCD(),
                        forces.getBaseCD(), forces.getFrictionCD());
            }
        }
        line("aero.warnings", warnings.size());

        // Static helper functions (pure math, worth pinning).
        for (double m : machs) {
            line("aero.staticCD", m,
                    info.openrocket.core.aerodynamics.BarrowmanCalculator.calculateStagnationCD(m),
                    info.openrocket.core.aerodynamics.BarrowmanCalculator.calculateBaseCD(m));
        }
    }

    /**
     * Reference rocket (Alpha-III class): ogive nose, body tube, 3 trapezoid
     * fins, inner-tube motor mount, parachute. Mix of default materials
     * (exercises the shimmed preference defaults, identical both sides) and
     * explicit materials.
     */
    private static Rocket buildReferenceRocket() {
        Rocket rocket = new Rocket();
        AxialStage stage = new AxialStage();
        rocket.addChild(stage);

        NoseCone nose = new NoseCone(Transition.Shape.OGIVE, 0.07, 0.012);
        nose.setThickness(0.002);
        stage.addChild(nose);

        BodyTube body = new BodyTube(0.30, 0.012, 0.0003);
        body.setMaterial(Material.newMaterial(Material.Type.BULK, "Kraft phenolic", 950, false));
        stage.addChild(body);

        TrapezoidFinSet fins = new TrapezoidFinSet(3, 0.05, 0.03, 0.02, 0.03);
        fins.setThickness(0.003);
        body.addChild(fins);

        InnerTube mount = new InnerTube();
        mount.setLength(0.07);
        mount.setOuterRadius(0.0095);
        mount.setThickness(0.0005);
        body.addChild(mount);

        Parachute chute = new Parachute();
        chute.setDiameter(0.30);
        body.addChild(chute);

        rocket.enableEvents();
        return rocket;
    }

    private static void massScenarios() {
        Rocket rocket = buildReferenceRocket();
        FlightConfiguration config = rocket.getSelectedConfiguration();

        // Direct per-class calls to the bounds API. These are real parity values
        // AND they force TeaVM's dependency analyzer to link every implementation
        // (it under-links impls reached only via map-key virtual dispatch).
        int bi = 0;
        for (info.openrocket.core.rocketcomponent.RocketComponent c : config.getAllComponents()) {
            double boundsSize = c.getComponentBounds().size();
            double instBox = (c instanceof info.openrocket.core.rocketcomponent.BoxBounded)
                    ? ((info.openrocket.core.rocketcomponent.BoxBounded) c).getInstanceBoundingBox().span().getX()
                    : -1;
            line("comp.bounds." + (bi++), boundsSize, instBox);
        }

        // Structural counts — parity values AND the first divergence tripwire.
        line("tree.counts", rocket.getChildCount(), config.getAllComponents().size(),
                config.getActiveComponents().size(), config.getActiveStages().size(),
                config.getStageCount(), config.getActiveInstances().size());

        // Per-component masses — localizes any mass divergence to a component.
        // (Indexed tag, not getSimpleName(): TeaVM strips class name metadata.)
        int ci = 0;
        for (info.openrocket.core.rocketcomponent.RocketComponent c : config.getAllComponents()) {
            line("comp.mass." + (ci++), c.getMass(), c.getLength());
        }

        // Instance-context counts — masses aggregate through these transforms.
        // Sorted (HashMap iteration order differs between JVM and TeaVM).
        java.util.List<Integer> ctxCounts = new java.util.ArrayList<>();
        for (java.util.ArrayList<info.openrocket.core.rocketcomponent.InstanceContext> v
                : config.getActiveInstances().values()) {
            ctxCounts.add(v.size());
        }
        java.util.Collections.sort(ctxCounts);
        double[] sortedCounts = new double[ctxCounts.size()];
        for (int i = 0; i < ctxCounts.size(); i++) {
            sortedCounts[i] = ctxCounts.get(i);
        }
        line("tree.ctx.sorted", sortedCounts);

        // Direct probes at the JVM/JS divergence point (fin instance expansion).
        TrapezoidFinSet finProbe = null;
        for (info.openrocket.core.rocketcomponent.RocketComponent c : config.getAllComponents()) {
            if (c instanceof TrapezoidFinSet) {
                finProbe = (TrapezoidFinSet) c;
            }
        }
        line("fins.instances", finProbe.getFinCount(), finProbe.getInstanceCount(),
                finProbe.getInstanceAngles().length, finProbe.getInstanceOffsets().length);

        // Virtual dispatch check: the tree walk calls getInstanceCount() through
        // a RocketComponent-typed reference — must hit FinSet's override (=3).
        info.openrocket.core.rocketcomponent.RocketComponent rcRef = finProbe;
        line("fins.virtual", rcRef.getInstanceCount(), rcRef.getInstanceAngles().length);

        // Map emplace probe: repeated emplace on the same key must append (list
        // grows), not replace. InstanceMap extends LinkedHashMap (patched from
        // upstream's ConcurrentHashMap — see patches/LEDGER.md determinism fix).
        info.openrocket.core.rocketcomponent.InstanceMap im =
                new info.openrocket.core.rocketcomponent.InstanceMap();
        im.emplace(finProbe, 0, info.openrocket.core.util.Transformation.IDENTITY);
        im.emplace(finProbe, 1, info.openrocket.core.util.Transformation.IDENTITY);
        im.emplace(finProbe, 2, info.openrocket.core.util.Transformation.IDENTITY);
        line("im.count", im.count(finProbe), im.size());

        // Does an explicit post-enableEvents change event rebuild the contexts?
        line("fins.ctx.before", config.getActiveInstances().count(finProbe));
        finProbe.setFinCount(4);
        line("fins.ctx.after4", config.getActiveInstances().count(finProbe));
        finProbe.setFinCount(3);
        line("fins.ctx.after3", config.getActiveInstances().count(finProbe));

        RigidBody structure = MassCalculator.calculateStructure(config);
        line("mass.structure", structure.getMass(),
                structure.getCM().getX(),structure.getCM().getY(),structure.getCM().getZ(),
                structure.getIxx(), structure.getIyy(), structure.getIzz(),
                structure.getLongitudinalInertia(), structure.getRotationalInertia());

        RigidBody burnout = MassCalculator.calculateBurnout(config);
        line("mass.burnout", burnout.getMass(),
                burnout.getCM().getX(),burnout.getCM().getY(),burnout.getCM().getZ(),
                burnout.getLongitudinalInertia(), burnout.getRotationalInertia());

        line("rocket.length", rocket.getLength());
    }

    private static void atmosphereScenarios() {
        ExtendedISAModel std = new ExtendedISAModel();
        // Altitudes probing layer boundaries, interpolation midpoints, clamps.
        double[] alts = { -100, 0, 1, 250, 499, 500, 501, 1234.56, 5000, 10999, 11000,
                11001, 15000, 20000, 32000, 47000, 51000, 71000, 84852, 90000 };
        for (double alt : alts) {
            AtmosphericConditions c = std.getConditions(alt);
            line("isa.std", alt, c.getTemperature(), c.getPressure(), c.getDensity(),
                    c.getMachSpeed(), c.getKinematicViscosity());
        }
        // Custom launch-site model (plan: base configurable at site altitude).
        // Upstream added a relative-humidity arg: (altitude, temp, pressure, humidity).
        ExtendedISAModel site = new ExtendedISAModel(1400, 285.15, 86000,
                ExtendedISAModel.STANDARD_RELATIVE_HUMIDITY);
        for (double alt : new double[] { 0, 1400, 1401, 3000, 11000, 20000 }) {
            AtmosphericConditions c = site.getConditions(alt);
            line("isa.site1400", alt, c.getTemperature(), c.getPressure(), c.getDensity());
        }
    }

    private static void quaternionScenarios() {
        double[][] rotVecs = {
                { Math.PI / 2, 0, 0 }, { 0, Math.PI / 2, 0 }, { 0, 0, Math.PI / 2 },
                { 0.1, -0.2, 0.3 }, { 1e-9, 0, 0 }, { Math.PI, Math.PI / 3, -Math.PI / 5 },
        };
        Coordinate[] vecs = {
                new Coordinate(1, 0, 0), new Coordinate(0, 1, 0), new Coordinate(0, 0, 1),
                new Coordinate(1.5, -2.5, 3.5),
        };
        for (double[] rv : rotVecs) {
            Quaternion q = Quaternion.rotation(new Coordinate(rv[0], rv[1], rv[2]));
            for (Coordinate v : vecs) {
                CoordinateIF r = q.rotate(v);
                line("quat.rot", rv[0], rv[1], rv[2], v.x, v.y, v.z, r.getX(), r.getY(), r.getZ());
            }
        }
    }

    /** Canonical output: tag then raw Double.toString values, '|'-separated. */
    private static void line(String tag, double... values) {
        StringBuilder sb = new StringBuilder(tag);
        for (double v : values) {
            sb.append('|').append(v);
        }
        System.out.println(sb);
    }

    private ParityMain() {}
}
