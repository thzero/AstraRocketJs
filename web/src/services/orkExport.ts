import { PLUGGED_DELAY, type ComponentNode, type ComponentPosition } from '../engine/openRocketEngine';
import { asStageNodes } from './orkTree';
import { shapeIsClippable, shapeParamDefault } from '../tree/shapeProfile';
import { num } from '../tree/nodeProps';
import { escapeXml } from './xmlUtil';
import { uuid } from './uuid';
import type { OrkExportMotor, OrkDeployOverride, OrkTreeExportInput } from './orkTypes';

// ============================ EXPORT ============================

export function exportOrk({ name, tree, motors, motor, mountId, launch, configs, activeConfigId }: OrkTreeExportInput): string {
  const motorMap: Record<string, OrkExportMotor> = { ...(motors ?? {}) };
  if (motor && mountId && !motorMap[mountId]) motorMap[mountId] = motor;
  // The configurations to write. Classic path (no configs): ONE minted
  // config carrying the working set — exactly the pre-Stage-B output.
  const active = configs?.find((c) => c.id === activeConfigId) ?? null;
  const writeConfigs: Array<{
    id: string;
    name: string | null;
    motors: Record<string, OrkExportMotor>;
    /** null for the ACTIVE config: its deployment comes from the live tree. */
    deployments: Record<string, OrkDeployOverride> | null;
  }> =
    configs && configs.length > 0
      ? configs.map((c) => ({
        id: c.id,
        name: c.name,
        motors: c === active ? motorMap : c.motors,
        deployments: c === active ? null : (c.deployments ?? {}),
      }))
      : [{ id: uuid(), name: null, motors: motorMap, deployments: null }];
  // Active = none but motors loaded: mint an extra config carrying the live
  // set, unnamed (the desktop renders unnamed configs as their motor list).
  const minted = configs && configs.length > 0 && !active && Object.keys(motorMap).length > 0
    ? { id: uuid(), name: null, motors: motorMap, deployments: null }
    : null;
  if (minted) writeConfigs.push(minted);
  // default="true" (also what <simulation> references): the active config,
  // else the minted custom one, else the original default.
  const defaultId = active?.id ?? minted?.id
    ?? (configs && configs.length > 0
      ? (configs.find((c) => c.isDefault)?.id ?? configs[0]!.id)
      : writeConfigs[0]!.id);
  const lines: string[] = [];
  const emit = (depth: number, s: string) => lines.push('  '.repeat(depth) + s);

  const material = (depth: number, node: ComponentNode, kind: 'bulk' | 'surface' | 'line' = 'bulk') => {
    if (kind === 'bulk') {
      const name = typeof node['materialName'] === 'string' ? (node['materialName'] as string) : 'custom';
      if (typeof node.density === 'number' && node.density > 0) {
        emit(depth, `<material type="bulk" density="${node.density}">${escapeXml(name)}</material>`);
      } else {
        emit(depth, '<material type="bulk" density="680.0" group="PaperProducts">Cardboard</material>');
      }
    } else if (kind === 'surface') {
      if (typeof node['surfaceDensity'] === 'number') {
        const name = typeof node['surfaceMaterialName'] === 'string'
          ? (node['surfaceMaterialName'] as string) : 'custom';
        emit(depth, `<material type="surface" density="${node['surfaceDensity']}">${escapeXml(name)}</material>`);
      } else {
        emit(depth, '<material type="surface" density="0.067" group="Fabrics">Ripstop nylon</material>');
      }
    } else {
      if (typeof node['lineDensity'] === 'number') {
        const name = typeof node['lineMaterialName'] === 'string'
          ? (node['lineMaterialName'] as string) : 'custom';
        emit(depth, `<material type="line" density="${node['lineDensity']}">${escapeXml(name)}</material>`);
      } else {
        emit(depth, '<material type="line" density="0.0018" group="ThreadsLines">Elastic cord (round 2 mm, 1/16 in)</material>');
      }
    }
  };

  const position = (depth: number, node: ComponentNode, dflt: ComponentPosition['method'] = 'top') => {
    const pos = (node.position ?? { method: dflt, offset: 0 }) as ComponentPosition;
    emit(depth, `<axialoffset method="${pos.method}">${pos.offset}</axialoffset>`);
    emit(depth, `<position type="${pos.method}">${pos.offset}</position>`);
  };

  const header = (depth: number, node: ComponentNode, fallback: string) => {
    emit(depth, `<name>${escapeXml(node.name ?? fallback)}</name>`);
    emit(depth, `<id>${uuid()}</id>`);
    overrides(depth, node);
  };

  // Mass/CG/Cd overrides, exactly as the desktop RocketComponentSaver writes them.
  const overrides = (depth: number, node: ComponentNode) => {
    const sub = (key: string) => (node[key] === true ? 'true' : 'false');
    if (typeof node['overrideMass'] === 'number') {
      emit(depth, `<overridemass>${node['overrideMass']}</overridemass>`);
      emit(depth, `<overridesubcomponentsmass>${sub('overrideSubcomponentsMass')}</overridesubcomponentsmass>`);
    }
    if (typeof node['overrideCGX'] === 'number') {
      emit(depth, `<overridecg>${node['overrideCGX']}</overridecg>`);
      emit(depth, `<overridesubcomponentscg>${sub('overrideSubcomponentsCG')}</overridesubcomponentscg>`);
    }
    if (typeof node['overrideCD'] === 'number') {
      emit(depth, `<overridecd>${node['overrideCD']}</overridecd>`);
      emit(depth, `<overridesubcomponentscd>${sub('overrideSubcomponentsCD')}</overridesubcomponentscd>`);
    }
  };

  // RASAero feature #4: supersonic airfoil section — our extension tags,
  // written only when set (the desktop loader warns-and-continues on them).
  const airfoilXml = (depth: number, node: ComponentNode) => {
    const section = node['airfoilSection'];
    if (typeof section === 'string' && section) {
      emit(depth, `<airfoilsection>${escapeXml(section)}</airfoilsection>`);
    }
    for (const [key, tag] of [
      ['airfoilLeDiamond', 'airfoillediamond'],
      ['airfoilTeDiamond', 'airfoiltediamond'],
      ['finLeRadius', 'finleradius'],
    ] as const) {
      const v = node[key];
      if (typeof v === 'number' && v > 0) emit(depth, `<${tag}>${v}</${tag}>`);
    }
  };

  /**
   * Per-configuration recovery deployment. The ACTIVE configuration (and the
   * classic single-config path) takes its values from the live tree — those are
   * already written as the bare defaults just above, so its block simply
   * repeats them. Every OTHER configuration replays what it carried in from
   * import. Without this, saving after opening one configuration rewrote every
   * configuration's recovery settings to the opened one's — a chute set to pop
   * at apogee in config A could come back deploying at 300 m.
   */
  const deploymentConfigs = (depth: number, node: ComponentNode) => {
    if (writeConfigs.length < 2) return;
    for (const c of writeConfigs) {
      const o: OrkDeployOverride = c.deployments === null
        ? {
          deployEvent: String(node['deployEvent'] ?? 'ejection'),
          deployAltitude: typeof node['deployAltitude'] === 'number' ? node['deployAltitude'] as number : 200,
          deployDelay: typeof node['deployDelay'] === 'number' ? node['deployDelay'] as number : 0,
        }
        : (node.id ? c.deployments[node.id] ?? {} : {});
      if (Object.keys(o).length === 0) continue;
      emit(depth, `<deploymentconfiguration configid="${c.id}">`);
      if (o.deployEvent !== undefined) emit(depth + 1, `<deployevent>${escapeXml(o.deployEvent)}</deployevent>`);
      if (o.deployAltitude !== undefined) emit(depth + 1, `<deployaltitude>${o.deployAltitude}</deployaltitude>`);
      if (o.deployDelay !== undefined) emit(depth + 1, `<deploydelay>${o.deployDelay}</deploydelay>`);
      emit(depth, '</deploymentconfiguration>');
    }
  };

  /**
   * Writes back whatever fillet the file came in with (see readFillet). The old
   * hard-coded 0.0 + Cardboard silently deleted a designer's epoxy fillets from
   * their own .ork on every save; these defaults are the same literals, used
   * only when the design genuinely has no fillet.
   */
  const filletXml = (depth: number, node: ComponentNode) => {
    emit(depth, `<filletradius>${num(node, 'filletRadius', 0)}</filletradius>`);
    const density = typeof node['filletDensity'] === 'number' ? node['filletDensity'] as number : 680;
    const group = typeof node['filletMaterialGroup'] === 'string'
      ? node['filletMaterialGroup'] as string : 'PaperProducts';
    const matName = typeof node['filletMaterialName'] === 'string'
      ? node['filletMaterialName'] as string : 'Cardboard';
    emit(depth, `<filletmaterial type="bulk" density="${density}" group="${escapeXml(group)}">`
      + `${escapeXml(matName)}</filletmaterial>`);
  };

  const finishXml = (depth: number, node: ComponentNode) => {
    // finish (like shape/crosssection/cluster below) is file-sourced free
    // text on import — escape it or a crafted file breaks the re-export.
    emit(depth, `<finish>${escapeXml(String(node['finish'] ?? 'normal'))}</finish>`);
  };

  // Fin tabs — written like the desktop's FinSetSaver: only when both depth
  // and length are nonzero, with the legacy relativeto spelling first
  // (front/center/end, OR 15.03 compat) then the modern one (top/middle/
  // bottom); readers apply the last occurrence.
  const finTabsXml = (depth: number, node: ComponentNode) => {
    const h = num(node, 'tabHeight', 0);
    const len = num(node, 'tabLength', 0);
    if (h <= 0 || len <= 0) return;
    const method = typeof node['tabOffsetMethod'] === 'string'
      ? (node['tabOffsetMethod'] as string) : 'middle';
    const legacy = method === 'top' ? 'front' : method === 'bottom' ? 'end' : 'center';
    const offset = num(node, 'tabOffset', 0);
    emit(depth, `<tabheight>${h}</tabheight>`);
    emit(depth, `<tablength>${len}</tablength>`);
    emit(depth, `<tabposition relativeto="${legacy}">${offset}</tabposition>`);
    emit(depth, `<tabposition relativeto="${method}">${offset}</tabposition>`);
  };

  // The desktop encodes "solid" as <thickness>filled</thickness>.
  const thicknessXml = (depth: number, node: ComponentNode, fb: number) => {
    emit(depth, node['filled'] === true
      ? '<thickness>filled</thickness>'
      : `<thickness>${typeof node['thickness'] === 'number' ? node['thickness'] : fb}</thickness>`);
  };

  /** The write-configs that hold a motor for this mount, in write order. */
  const mountConfigs = (nodeId: string | undefined) =>
    nodeId ? writeConfigs.filter((c) => c.motors[nodeId]) : [];

  // Configs may all be empty here: a mount with no motor loaded still writes
  // <motormount> so the mount flag survives the round trip (desktop same).
  const motorMountXml = (depth: number, nodeId: string | undefined, overhangM = 0) => {
    const withMotor = mountConfigs(nodeId);
    // Bare ignition defaults: the default-marked config's motor when it has
    // one here (the desktop writes its default config bare), else the first.
    const bare = (withMotor.find((c) => c.id === defaultId) ?? withMotor[0])?.motors[nodeId!];
    const ev = bare?.ignitionEvent ?? 'automatic';
    const evDelay = bare?.ignitionDelay ?? 0;
    emit(depth, '<motormount>');
    emit(depth + 1, `<ignitionevent>${escapeXml(ev)}</ignitionevent>`);
    emit(depth + 1, `<ignitiondelay>${evDelay}</ignitiondelay>`);
    emit(depth + 1, `<overhang>${overhangM}</overhang>`);
    for (const c of withMotor) {
      const m = c.motors[nodeId!]!;
      emit(depth + 1, `<motor configid="${c.id}">`);
      emit(depth + 2, '<type>single</type>');
      emit(depth + 2, `<manufacturer>${escapeXml(m.manufacturer ?? 'custom')}</manufacturer>`);
      emit(depth + 2, `<designation>${escapeXml(m.designation)}</designation>`);
      emit(depth + 2, `<diameter>${m.diameter}</diameter>`);
      emit(depth + 2, `<length>${m.length}</length>`);
      // Plugged (no ejection charge) → the desktop's literal "none".
      emit(depth + 2, `<delay>${m.delay >= PLUGGED_DELAY ? 'none' : m.delay}</delay>`);
      emit(depth + 1, '</motor>');
    }
    for (const c of withMotor) {
      const m = c.motors[nodeId!]!;
      emit(depth + 1, `<ignitionconfiguration configid="${c.id}">`);
      emit(depth + 2, `<ignitionevent>${escapeXml(m.ignitionEvent ?? 'automatic')}</ignitionevent>`);
      emit(depth + 2, `<ignitiondelay>${m.ignitionDelay ?? 0}</ignitiondelay>`);
      emit(depth + 1, '</ignitionconfiguration>');
    }
    emit(depth, '</motormount>');
  };

  // Engine defaults from Transition.Shape.defaultParameter() — writing any
  // other fallback silently reshapes the nose (haack's default is 0, not 1).
  const shapeParamXml = (depth: number, node: ComponentNode) => {
    const dflt = shapeParamDefault(String(node['shape'] ?? 'ogive'));
    emit(depth, `<shapeparameter>${num(node, 'shapeParameter', dflt)}</shapeparameter>`);
  };

  const emitChildren = (node: ComponentNode, depth: number) => {
    const kids = node.children ?? [];
    if (kids.length === 0) return;
    emit(depth, '<subcomponents>');
    for (const kid of kids) {
      emitNode(kid, depth + 1);
    }
    emit(depth, '</subcomponents>');
  };

  const emitNode = (node: ComponentNode, depth: number) => {
    const t = node.type;
    const open = (tag: string) => emit(depth, `<${tag}>`);
    const close = (tag: string) => {
      emitChildren(node, depth + 1);
      emit(depth, `</${tag}>`);
    };

    switch (t) {
      case 'nosecone': {
        open('nosecone');
        header(depth + 1, node, 'Nose Cone');
        finishXml(depth + 1, node);
        material(depth + 1, node);
        emit(depth + 1, `<length>${num(node, 'length', 0.07)}</length>`);
        thicknessXml(depth + 1, node, 0.002);
        emit(depth + 1, `<shape>${escapeXml(String(node['shape'] ?? 'ogive'))}</shape>`);
        emit(depth + 1, '<shapeclipped>false</shapeclipped>');
        shapeParamXml(depth + 1, node);
        emit(depth + 1, `<aftradius>${num(node, 'aftRadius', 0.012)}</aftradius>`);
        emit(depth + 1, `<aftshoulderradius>${num(node, 'shoulderRadius', 0)}</aftshoulderradius>`);
        emit(depth + 1, `<aftshoulderlength>${num(node, 'shoulderLength', 0)}</aftshoulderlength>`);
        emit(depth + 1, `<aftshoulderthickness>${num(node, 'shoulderThickness', 0)}</aftshoulderthickness>`);
        emit(depth + 1, `<aftshouldercapped>${node['shoulderCapped'] === true}</aftshouldercapped>`);
        emit(depth + 1, '<isflipped>false</isflipped>');
        close('nosecone');
        break;
      }
      case 'transition': {
        open('transition');
        header(depth + 1, node, 'Transition');
        finishXml(depth + 1, node);
        material(depth + 1, node);
        emit(depth + 1, `<length>${num(node, 'length', 0.04)}</length>`);
        thicknessXml(depth + 1, node, 0.002);
        emit(depth + 1, `<shape>${escapeXml(String(node['shape'] ?? 'conical'))}</shape>`);
        // Write what actually simulated so the desktop reproduces our
        // aerodynamics: an explicit imported/edited 'clipped' wins; otherwise
        // the kernel's default clipped state, which setShapeType() sets to
        // type.isClippable() (true for every shape that reaches this branch).
        // Desktop TransitionSaver only writes <shapeclipped> for CLIPPABLE
        // shapes — a conical transition carries no tag, and emitting one
        // anyway would grow a 'clipped' field on re-import that the golden
        // file never had (breaking bit-stable round trips).
        if (shapeIsClippable(String(node['shape'] ?? 'conical'))) {
          const clippedOut = typeof node['clipped'] === 'boolean'
            ? (node['clipped'] as boolean) : true;
          emit(depth + 1, `<shapeclipped>${clippedOut}</shapeclipped>`);
        }
        shapeParamXml(depth + 1, node);
        emit(depth + 1, `<foreradius>${typeof node['foreRadius'] === 'number' ? node['foreRadius'] : 'auto'}</foreradius>`);
        emit(depth + 1, `<aftradius>${typeof node['aftRadius'] === 'number' ? node['aftRadius'] : 'auto'}</aftradius>`);
        for (const side of ['fore', 'aft'] as const) {
          const key = side === 'fore' ? 'foreShoulder' : 'aftShoulder';
          emit(depth + 1, `<${side}shoulderradius>${num(node, `${key}Radius`, 0)}</${side}shoulderradius>`);
          emit(depth + 1, `<${side}shoulderlength>${num(node, `${key}Length`, 0)}</${side}shoulderlength>`);
          emit(depth + 1, `<${side}shoulderthickness>${num(node, `${key}Thickness`, 0)}</${side}shoulderthickness>`);
          emit(depth + 1, `<${side}shouldercapped>false</${side}shouldercapped>`);
        }
        close('transition');
        break;
      }
      case 'bodytube': {
        open('bodytube');
        header(depth + 1, node, 'Body Tube');
        finishXml(depth + 1, node);
        material(depth + 1, node);
        emit(depth + 1, `<length>${num(node, 'length', 0.3)}</length>`);
        emit(depth + 1, `<thickness>${num(node, 'thickness', 0.0005)}</thickness>`);
        emit(depth + 1, `<radius>${num(node, 'outerRadius', 0.012)}</radius>`);
        // Extension tag (desktop warns-and-ignores): sub-minimum flag.
        if (node['caseAirframe'] === true) {
          emit(depth + 1, '<caseairframe>true</caseairframe>');
        }
        // Min-diameter: the body tube itself is the motor mount.
        if (node['motorMount'] === true || mountConfigs(node.id).length > 0) {
          motorMountXml(depth + 1, node.id, num(node, 'motorOverhang', 0));
        }
        close('bodytube');
        break;
      }
      case 'trapezoidfinset': {
        open('trapezoidfinset');
        header(depth + 1, node, 'Trapezoidal Fin Set');
        emit(depth + 1, `<instancecount>${num(node, 'finCount', 3)}</instancecount>`);
        emit(depth + 1, `<fincount>${num(node, 'finCount', 3)}</fincount>`);
        emit(depth + 1, '<radiusoffset method="surface">0.0</radiusoffset>');
        emit(depth + 1, '<angleoffset method="relative">0.0</angleoffset>');
        emit(depth + 1, `<rotation>${(num(node, 'rotation', 0) * 180) / Math.PI}</rotation>`);
        position(depth + 1, node, 'bottom');
        finishXml(depth + 1, node);
        material(depth + 1, node);
        emit(depth + 1, `<thickness>${num(node, 'thickness', 0.003)}</thickness>`);
        emit(depth + 1, `<crosssection>${escapeXml(String(node['crossSection'] ?? 'square'))}</crosssection>`);
        airfoilXml(depth + 1, node);
        emit(depth + 1, `<cant>${(num(node, 'cant', 0) * 180) / Math.PI}</cant>`);
        finTabsXml(depth + 1, node);
        filletXml(depth + 1, node);
        emit(depth + 1, `<rootchord>${num(node, 'rootChord', 0.05)}</rootchord>`);
        emit(depth + 1, `<tipchord>${num(node, 'tipChord', 0.03)}</tipchord>`);
        emit(depth + 1, `<sweeplength>${num(node, 'sweep', 0.02)}</sweeplength>`);
        emit(depth + 1, `<height>${num(node, 'height', 0.03)}</height>`);
        close('trapezoidfinset');
        break;
      }
      case 'freeformfinset': {
        open('freeformfinset');
        header(depth + 1, node, 'Freeform Fin Set');
        emit(depth + 1, `<instancecount>${num(node, 'finCount', 3)}</instancecount>`);
        emit(depth + 1, `<fincount>${num(node, 'finCount', 3)}</fincount>`);
        emit(depth + 1, '<radiusoffset method="surface">0.0</radiusoffset>');
        emit(depth + 1, '<angleoffset method="relative">0.0</angleoffset>');
        emit(depth + 1, `<rotation>${(num(node, 'rotation', 0) * 180) / Math.PI}</rotation>`);
        position(depth + 1, node, 'bottom');
        finishXml(depth + 1, node);
        material(depth + 1, node);
        emit(depth + 1, `<thickness>${num(node, 'thickness', 0.003)}</thickness>`);
        emit(depth + 1, `<crosssection>${escapeXml(String(node['crossSection'] ?? 'square'))}</crosssection>`);
        airfoilXml(depth + 1, node);
        emit(depth + 1, `<cant>${(num(node, 'cant', 0) * 180) / Math.PI}</cant>`);
        finTabsXml(depth + 1, node);
        filletXml(depth + 1, node);
        emit(depth + 1, '<finpoints>');
        const ffPts = (node['points'] as [number, number][] | undefined) ?? [];
        for (const [px, py] of ffPts) {
          emit(depth + 2, `<point x="${px}" y="${py}"/>`);
        }
        emit(depth + 1, '</finpoints>');
        close('freeformfinset');
        break;
      }
      case 'ellipticalfinset': {
        open('ellipticalfinset');
        header(depth + 1, node, 'Elliptical Fin Set');
        emit(depth + 1, `<instancecount>${num(node, 'finCount', 3)}</instancecount>`);
        emit(depth + 1, `<fincount>${num(node, 'finCount', 3)}</fincount>`);
        emit(depth + 1, '<radiusoffset method="surface">0.0</radiusoffset>');
        emit(depth + 1, '<angleoffset method="relative">0.0</angleoffset>');
        emit(depth + 1, `<rotation>${(num(node, 'rotation', 0) * 180) / Math.PI}</rotation>`);
        position(depth + 1, node, 'bottom');
        finishXml(depth + 1, node);
        material(depth + 1, node);
        emit(depth + 1, `<thickness>${num(node, 'thickness', 0.003)}</thickness>`);
        emit(depth + 1, `<crosssection>${escapeXml(String(node['crossSection'] ?? 'square'))}</crosssection>`);
        airfoilXml(depth + 1, node);
        emit(depth + 1, `<cant>${(num(node, 'cant', 0) * 180) / Math.PI}</cant>`);
        finTabsXml(depth + 1, node);
        filletXml(depth + 1, node);
        emit(depth + 1, `<rootchord>${num(node, 'rootChord', 0.05)}</rootchord>`);
        emit(depth + 1, `<height>${num(node, 'height', 0.03)}</height>`);
        close('ellipticalfinset');
        break;
      }
      case 'tubefinset': {
        open('tubefinset');
        header(depth + 1, node, 'Tube Fin Set');
        emit(depth + 1, `<instancecount>${num(node, 'finCount', 6)}</instancecount>`);
        emit(depth + 1, `<fincount>${num(node, 'finCount', 6)}</fincount>`);
        emit(depth + 1, '<radiusoffset method="coaxial">0.0</radiusoffset>');
        emit(depth + 1, '<angleoffset method="fixed">0.0</angleoffset>');
        emit(depth + 1, `<rotation>${(num(node, 'rotation', 0) * 180) / Math.PI}</rotation>`);
        position(depth + 1, node, 'bottom');
        finishXml(depth + 1, node);
        material(depth + 1, node);
        emit(depth + 1, `<radius>${typeof node['outerRadius'] === 'number' ? node['outerRadius'] : 'auto'}</radius>`);
        emit(depth + 1, `<length>${num(node, 'length', 0.1)}</length>`);
        emit(depth + 1, `<thickness>${num(node, 'thickness', 0.0005)}</thickness>`);
        close('tubefinset');
        break;
      }
      case 'innertube': {
        open('innertube');
        header(depth + 1, node, 'Inner Tube');
        position(depth + 1, node, 'bottom');
        material(depth + 1, node);
        emit(depth + 1, `<length>${num(node, 'length', 0.07)}</length>`);
        // Preserve the off-axis / split-cluster offset (see the innertube reader):
        // <radialposition> metres, <radialdirection> DEGREES. Defaults to 0 so a
        // centred tube is byte-identical to before.
        emit(depth + 1, `<radialposition>${num(node, 'radialPosition', 0)}</radialposition>`);
        emit(depth + 1, `<radialdirection>${(num(node, 'radialDirection', 0) * 180) / Math.PI}</radialdirection>`);
        emit(depth + 1, `<outerradius>${num(node, 'outerRadius', 0.0095)}</outerradius>`);
        emit(depth + 1, `<thickness>${num(node, 'thickness', 0.0005)}</thickness>`);
        // Desktop stores cluster rotation in DEGREES; we keep radians inside.
        emit(depth + 1, `<clusterconfiguration>${escapeXml(typeof node['cluster'] === 'string' ? (node['cluster'] as string) : 'single')}</clusterconfiguration>`);
        emit(depth + 1, `<clusterscale>${num(node, 'clusterScale', 1)}</clusterscale>`);
        emit(depth + 1, `<clusterrotation>${(num(node, 'clusterRotation', 0) * 180) / Math.PI}</clusterrotation>`);
        if (typeof node['maxMotorLength'] === 'number') {
          // Extension tag (desktop warns-and-ignores): the mount's physical
          // motor-length limit travels with the design.
          emit(depth + 1, `<maxmotorlength>${node['maxMotorLength']}</maxmotorlength>`);
        }
        if (node['motorMount'] === true || mountConfigs(node.id).length > 0) {
          motorMountXml(depth + 1, node.id, num(node, 'motorOverhang', 0));
        }
        close('innertube');
        break;
      }
      case 'tubecoupler': {
        open('tubecoupler');
        header(depth + 1, node, 'Tube Coupler');
        position(depth + 1, node, 'bottom');
        material(depth + 1, node);
        emit(depth + 1, `<length>${num(node, 'length', 0.05)}</length>`);
        emit(depth + 1, '<radialposition>0.0</radialposition>');
        emit(depth + 1, '<radialdirection>0.0</radialdirection>');
        emit(depth + 1, '<outerradius>auto</outerradius>');
        emit(depth + 1, `<thickness>${num(node, 'thickness', 0.0005)}</thickness>`);
        close('tubecoupler');
        break;
      }
      case 'centeringring':
      case 'bulkhead': {
        open(t);
        header(depth + 1, node, t === 'bulkhead' ? 'Bulkhead' : 'Centering Ring');
        emit(depth + 1, `<instancecount>${num(node, 'instanceCount', 1)}</instancecount>`);
        emit(depth + 1, `<instanceseparation>${num(node, 'instanceSeparation', 0)}</instanceseparation>`);
        position(depth + 1, node, 'bottom');
        material(depth + 1, node);
        emit(depth + 1, `<length>${num(node, 'length', 0.002)}</length>`);
        emit(depth + 1, '<radialposition>0.0</radialposition>');
        emit(depth + 1, '<radialdirection>0.0</radialdirection>');
        emit(depth + 1, '<outerradius>auto</outerradius>');
        if (t === 'centeringring') emit(depth + 1, '<innerradius>auto</innerradius>');
        close(t);
        break;
      }
      case 'engineblock': {
        open('engineblock');
        header(depth + 1, node, 'Engine Block');
        position(depth + 1, node, 'bottom');
        material(depth + 1, node);
        emit(depth + 1, `<length>${num(node, 'length', 0.005)}</length>`);
        emit(depth + 1, '<radialposition>0.0</radialposition>');
        emit(depth + 1, '<radialdirection>0.0</radialdirection>');
        emit(depth + 1, '<outerradius>auto</outerradius>');
        emit(depth + 1, `<thickness>${num(node, 'thickness', 0.001)}</thickness>`);
        close('engineblock');
        break;
      }
      case 'fairing': {
        // Extension element: our own reader round-trips it; the desktop
        // warns-and-skips (same contract as the airfoil-section tags).
        open('fairing');
        header(depth + 1, node, 'Camera shroud');
        position(depth + 1, node, 'middle');
        finishXml(depth + 1, node);
        emit(depth + 1, `<length>${num(node, 'length', 0.08)}</length>`);
        emit(depth + 1, `<width>${num(node, 'width', 0.025)}</width>`);
        emit(depth + 1, `<height>${num(node, 'height', 0.02)}</height>`);
        emit(depth + 1, `<fairingshape>${escapeXml(String(node['fairingShape'] ?? 'halfround'))}</fairingshape>`);
        emit(depth + 1, `<mass>${num(node, 'mass', 0.03)}</mass>`);
        close('fairing');
        break;
      }
      case 'launchlug': {
        open('launchlug');
        header(depth + 1, node, 'Launch Lug');
        emit(depth + 1, `<instancecount>${num(node, 'instanceCount', 1)}</instancecount>`);
        emit(depth + 1, `<instanceseparation>${num(node, 'instanceSeparation', 0)}</instanceseparation>`);
        emit(depth + 1, `<angleoffset method="relative">${(num(node, 'angleOffset', Math.PI) * 180) / Math.PI}</angleoffset>`);
        emit(depth + 1, `<radialdirection>${(num(node, 'angleOffset', Math.PI) * 180) / Math.PI}</radialdirection>`);
        position(depth + 1, node, 'middle');
        finishXml(depth + 1, node);
        material(depth + 1, node);
        emit(depth + 1, `<radius>${num(node, 'outerRadius', 0.0022)}</radius>`);
        emit(depth + 1, `<length>${num(node, 'length', 0.05)}</length>`);
        emit(depth + 1, `<thickness>${num(node, 'thickness', 0.0003)}</thickness>`);
        close('launchlug');
        break;
      }
      case 'railbutton': {
        open('railbutton');
        header(depth + 1, node, 'Rail Button');
        emit(depth + 1, `<instancecount>${num(node, 'instanceCount', 1)}</instancecount>`);
        emit(depth + 1, `<instanceseparation>${num(node, 'instanceSeparation', 0)}</instanceseparation>`);
        emit(depth + 1, `<angleoffset method="relative">${(num(node, 'angleOffset', Math.PI) * 180) / Math.PI}</angleoffset>`);
        position(depth + 1, node, 'middle');
        finishXml(depth + 1, node);
        emit(depth + 1, '<material type="bulk" density="1420.0" group="Plastics">Delrin</material>');
        emit(depth + 1, `<outerdiameter>${num(node, 'outerDiameter', 0.0097)}</outerdiameter>`);
        emit(depth + 1, '<innerdiameter>0.008</innerdiameter>');
        emit(depth + 1, '<height>0.0097</height>');
        emit(depth + 1, '<baseheight>0.002</baseheight>');
        emit(depth + 1, '<flangeheight>0.002</flangeheight>');
        emit(depth + 1, '<screwheight>0.0</screwheight>');
        close('railbutton');
        break;
      }
      case 'parachute': {
        open('parachute');
        header(depth + 1, node, 'Parachute');
        position(depth + 1, node, 'top');
        emit(depth + 1, '<packedlength>0.025</packedlength>');
        emit(depth + 1, '<packedradius>0.0125</packedradius>');
        emit(depth + 1, '<radialposition>0.0</radialposition>');
        emit(depth + 1, '<radialdirection>0.0</radialdirection>');
        emit(depth + 1, `<cd>${typeof node['cd'] === 'number' ? node['cd'] : 'auto'}</cd>`);
        material(depth + 1, node, 'surface');
        emit(depth + 1, `<deployevent>${escapeXml(String(node['deployEvent'] ?? 'ejection'))}</deployevent>`);
        emit(depth + 1, `<deployaltitude>${num(node, 'deployAltitude', 200)}</deployaltitude>`);
        emit(depth + 1, `<deploydelay>${num(node, 'deployDelay', 0)}</deploydelay>`);
        deploymentConfigs(depth + 1, node);
        emit(depth + 1, `<diameter>${num(node, 'diameter', 0.3)}</diameter>`);
        if (typeof node['spillHoleDiameter'] === 'number' && (node['spillHoleDiameter'] as number) > 0) {
          // Extension tag (desktop warns-and-ignores, same as airfoilsection).
          emit(depth + 1, `<spillholediameter>${node['spillHoleDiameter']}</spillholediameter>`);
        }
        emit(depth + 1, `<linecount>${num(node, 'lineCount', 6)}</linecount>`);
        emit(depth + 1, `<linelength>${num(node, 'lineLength', 0.3)}</linelength>`);
        if (typeof node['lineDensity'] === 'number') {
          const lname = typeof node['lineMaterialName'] === 'string' ? (node['lineMaterialName'] as string) : 'custom';
          emit(depth + 1, `<linematerial type="line" density="${node['lineDensity']}">${escapeXml(lname)}</linematerial>`);
        } else {
          emit(depth + 1, '<linematerial type="line" density="0.0018" group="ThreadsLines">Elastic cord (round 2 mm, 1/16 in)</linematerial>');
        }
        close('parachute');
        break;
      }
      case 'streamer': {
        open('streamer');
        header(depth + 1, node, 'Streamer');
        position(depth + 1, node, 'top');
        emit(depth + 1, '<packedlength>0.025</packedlength>');
        emit(depth + 1, '<packedradius>0.0125</packedradius>');
        emit(depth + 1, '<radialposition>0.0</radialposition>');
        emit(depth + 1, '<radialdirection>0.0</radialdirection>');
        emit(depth + 1, `<cd>${typeof node['cd'] === 'number' ? node['cd'] : 'auto'}</cd>`);
        material(depth + 1, node, 'surface');
        emit(depth + 1, `<deployevent>${escapeXml(String(node['deployEvent'] ?? 'ejection'))}</deployevent>`);
        emit(depth + 1, `<deployaltitude>${num(node, 'deployAltitude', 200)}</deployaltitude>`);
        emit(depth + 1, `<deploydelay>${num(node, 'deployDelay', 0)}</deploydelay>`);
        deploymentConfigs(depth + 1, node);
        emit(depth + 1, `<striplength>${num(node, 'stripLength', 0.5)}</striplength>`);
        emit(depth + 1, `<stripwidth>${num(node, 'stripWidth', 0.05)}</stripwidth>`);
        close('streamer');
        break;
      }
      case 'shockcord': {
        open('shockcord');
        header(depth + 1, node, 'Shock Cord');
        position(depth + 1, node, 'top');
        emit(depth + 1, '<packedlength>0.025</packedlength>');
        emit(depth + 1, '<packedradius>0.0125</packedradius>');
        emit(depth + 1, '<radialposition>0.0</radialposition>');
        emit(depth + 1, '<radialdirection>0.0</radialdirection>');
        emit(depth + 1, `<cordlength>${num(node, 'cordLength', 0.3)}</cordlength>`);
        material(depth + 1, node, 'line');
        close('shockcord');
        break;
      }
      case 'masscomponent': {
        open('masscomponent');
        header(depth + 1, node, 'Mass Component');
        position(depth + 1, node, 'top');
        emit(depth + 1, `<packedlength>${num(node, 'length', 0.02)}</packedlength>`);
        emit(depth + 1, `<packedradius>${num(node, 'radius', 0.005)}</packedradius>`);
        emit(depth + 1, '<radialposition>0.0</radialposition>');
        emit(depth + 1, '<radialdirection>0.0</radialdirection>');
        emit(depth + 1, `<mass>${num(node, 'mass', 0.01)}</mass>`);
        // Legal values = MassComponent.MassComponentType lowercased:
        // masscomponent, altimeter, flightcomputer, deploymentcharge,
        // tracker, payload, recoveryhardware, battery.
        emit(depth + 1, `<masscomponenttype>${escapeXml(String(node['massComponentType'] ?? 'masscomponent'))}</masscomponenttype>`);
        close('masscomponent');
        break;
      }
      case 'podset':
      case 'parallelstage': {
        open(t);
        header(depth + 1, node, t === 'podset' ? 'Pod set' : 'Booster');
        // ComponentAssembly: NO <color>/<linestyle>/<radialdirection> — the
        // desktop savers suppress all three for assemblies.
        emit(depth + 1, `<instancecount>${num(node, 'instanceCount', 2)}</instancecount>`);
        const rMethod = node['radiusMethod'] === 'free' ? 'free' : 'relative';
        emit(depth + 1, `<radiusoffset method="${rMethod}">${num(node, 'radiusOffset', 0)}</radiusoffset>`); // metres
        const aMethod = node['angleMethod'] === 'fixed' ? 'fixed' : 'relative';
        // angleOffset is stored in radians → DEGREES on disk (same as cant).
        emit(depth + 1, `<angleoffset method="${aMethod}">${(num(node, 'angleOffset', 0) * 180) / Math.PI}</angleoffset>`);
        position(depth + 1, node, 'bottom');
        if (t === 'parallelstage') {
          // Same separation block a booster <stage> writes (bare default + config).
          const ev = typeof node['separationEvent'] === 'string' ? (node['separationEvent'] as string) : 'ejection';
          const delay = typeof node['separationDelay'] === 'number' ? (node['separationDelay'] as number) : 0;
          const alt = typeof node['separationAltitude'] === 'number' ? (node['separationAltitude'] as number) : 200;
          const sep = (d: number) => {
            emit(d, `<separationevent>${escapeXml(ev)}</separationevent>`);
            emit(d, `<separationaltitude>${alt}</separationaltitude>`);
            emit(d, `<separationdelay>${delay}</separationdelay>`);
          };
          sep(depth + 1);
          for (const c of writeConfigs) {
            emit(depth + 1, `<separationconfiguration configid="${c.id}">`);
            sep(depth + 2);
            emit(depth + 1, '</separationconfiguration>');
          }
        }
        close(t);
        break;
      }
    }
  };

  emit(0, "<?xml version='1.0' encoding='utf-8'?>");
  emit(0, '<openrocket version="1.10" creator="ArsRocketJs Sim">');
  emit(1, '<rocket>');
  emit(2, `<name>${escapeXml(name)}</name>`);
  emit(2, `<id>${uuid()}</id>`);
  emit(2, '<axialoffset method="absolute">0.0</axialoffset>');
  emit(2, '<position type="absolute">0.0</position>');
  emit(2, '<designtype>original</designtype>');
  // Stage nodes at the top level export as sibling <stage> blocks (the
  // desktop model); legacy flat trees wrap into one implicit stage.
  const stageNodes = asStageNodes(tree);
  for (const c of writeConfigs) {
    emit(2, `<motorconfiguration configid="${c.id}"${c.id === defaultId ? ' default="true"' : ''}>`);
    if (c.name !== null) emit(3, `<name>${escapeXml(c.name)}</name>`);
    for (let i = 0; i < stageNodes.length; i++) {
      emit(3, `<stage number="${i}" active="true"/>`);
    }
    emit(2, '</motorconfiguration>');
  }
  emit(2, '<referencetype>maximum</referencetype>');
  emit(2, '<subcomponents>');
  for (let i = 0; i < stageNodes.length; i++) {
    const st = stageNodes[i]!;
    emit(3, '<stage>');
    emit(4, `<name>${escapeXml(st.name ?? (i === 0 ? 'Sustainer' : `Booster ${i}`))}</name>`);
    emit(4, `<id>${uuid()}</id>`);
    // RASAero power-on base-drag input (metres, no conversion). Non-standard
    // element (OpenRocket desktop ignores it); only emitted when set > 0 so a
    // plain design round-trips exactly. Applies to every stage incl. sustainer.
    if (typeof st['nozzleExitDiameter'] === 'number' && (st['nozzleExitDiameter'] as number) > 0) {
      emit(4, `<nozzleexitdiameter>${st['nozzleExitDiameter']}</nozzleexitdiameter>`);
    }
    if (i > 0) {
      // Separation (lower stages only) — desktop writes the DEFAULT params
      // bare, then a per-config block (AxialStageSaver).
      const ev = typeof st['separationEvent'] === 'string' ? (st['separationEvent'] as string) : 'ejection';
      const delay = typeof st['separationDelay'] === 'number' ? (st['separationDelay'] as number) : 0;
      const alt = typeof st['separationAltitude'] === 'number' ? (st['separationAltitude'] as number) : 200;
      const sep = (d: number) => {
        emit(d, `<separationevent>${escapeXml(ev)}</separationevent>`);
        emit(d, `<separationaltitude>${alt}</separationaltitude>`);
        emit(d, `<separationdelay>${delay}</separationdelay>`);
      };
      sep(4);
      for (const c of writeConfigs) {
        emit(4, `<separationconfiguration configid="${c.id}">`);
        sep(5);
        emit(4, '</separationconfiguration>');
      }
    }
    emit(4, '<subcomponents>');
    for (const node of st.children ?? []) {
      emitNode(node, 5);
    }
    emit(4, '</subcomponents>');
    emit(3, '</stage>');
  }
  emit(2, '</subcomponents>');
  emit(1, '</rocket>');
  emit(1, '<simulations>');
  if (launch) {
    // One <simulation> in the exact shape of the desktop's
    // OpenRocketSaver.saveSimulation() so 24.12 opens it cleanly. Its loader
    // tolerates missing elements but WARNS on any simulator/calculator other
    // than RK4Simulator/BarrowmanCalculator and on unknown status values —
    // write the only ones it accepts. <configid> ties the simulation to the
    // default-marked motorconfiguration emitted above.
    emit(2, '<simulation status="notsimulated">');
    emit(3, '<name>Simulation 1</name>');
    emit(3, '<simulator>RK4Simulator</simulator>');
    emit(3, '<calculator>BarrowmanCalculator</calculator>');
    emit(3, '<conditions>');
    emit(4, `<configid>${defaultId}</configid>`);
    emit(4, `<launchrodlength>${launch.launchRodLengthM}</launchrodlength>`);
    // Desktop defaults for options we don't model: launch into wind, and
    // rod/wind direction (rod direction is DEGREES on disk, 90 = π/2 rad).
    emit(4, '<launchintowind>true</launchintowind>');
    // Rod angle is DEGREES on disk (the saver multiplies by 180/π).
    emit(4, `<launchrodangle>${launch.launchRodAngleDeg}</launchrodangle>`);
    emit(4, '<launchroddirection>90.0</launchroddirection>');
    // ≤23.09 legacy trio the desktop still writes: turbulence here is the
    // INTENSITY ratio stddev/average (PinkNoiseWindModel maps zero wind to
    // 0 or 1 — mirror it so old desktops recover the same stddev).
    const turb = launch.windAverage !== 0 ? launch.windStdDev / launch.windAverage
      : launch.windStdDev !== 0 ? 1 : 0;
    emit(4, `<windaverage>${launch.windAverage}</windaverage>`);
    emit(4, `<windturbulence>${turb}</windturbulence>`);
    // Wind direction is RADIANS on disk (unlike the rod elements — the
    // saver writes getDirection() raw); π/2 is the desktop default.
    emit(4, `<winddirection>${Math.PI / 2}</winddirection>`);
    emit(4, '<wind model="average">');
    emit(5, `<speed>${launch.windAverage}</speed>`);
    emit(5, `<direction>${Math.PI / 2}</direction>`);
    emit(5, `<standarddeviation>${launch.windStdDev}</standarddeviation>`);
    emit(4, '</wind>');
    emit(4, '<windmodeltype>Average</windmodeltype>');
    emit(4, `<launchaltitude>${launch.launchAltitudeM}</launchaltitude>`);
    emit(4, `<launchlatitude>${launch.latitudeDeg}</launchlatitude>`);
    // We don't model longitude — the desktop's preference default.
    emit(4, '<launchlongitude>-80.6</launchlongitude>');
    emit(4, '<geodeticmethod>spherical</geodeticmethod>');
    if (launch.temperatureC === null && launch.pressureHPa === null) {
      emit(4, '<atmosphere model="isa"/>');
    } else {
      // KELVIN / PASCAL on disk. The desktop stores both-or-ISA, so a
      // single custom value fills the other with the ISA sea-level standard.
      emit(4, '<atmosphere model="extendedisa">');
      emit(5, `<basetemperature>${(launch.temperatureC ?? 15) + 273.15}</basetemperature>`);
      emit(5, `<basepressure>${(launch.pressureHPa ?? 1013.25) * 100}</basepressure>`);
      emit(4, '</atmosphere>');
    }
    // RK4SimulationStepper recommended defaults (the desktop's own values).
    emit(4, '<timestep>0.05</timestep>');
    emit(4, '<maxtime>1200.0</maxtime>');
    emit(3, '</conditions>');
    emit(2, '</simulation>');
  }
  emit(1, '</simulations>');
  emit(0, '</openrocket>');
  return lines.join('\n') + '\n';
}

