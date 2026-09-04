import { unzipSync, strFromU8 } from 'fflate';
import { PLUGGED_DELAY, type ComponentNode, type ComponentPosition, type ComponentType } from '../engine/openRocketEngine';
import { freshId, type LaunchConditions } from './orkTree';
import { shapeParamDefault } from '../tree/shapeProfile';
import { xmlText as text } from './xmlUtil';
import { FEATURES } from './featureFlags';
import type { OrkMotorRef, OrkFlightConfig, OrkDeployOverride, OrkImportResult } from './orkTypes';

// ============================ IMPORT ============================

export function importOrk(data: ArrayBuffer | string, opts?: { configId?: string }): OrkImportResult {
  let xml: string;
  if (typeof data === 'string') {
    xml = data;
  } else {
    const bytes = new Uint8Array(data);
    if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
      const entries = unzipSync(bytes);
      const entryName = Object.keys(entries).find((n) => n.endsWith('.ork'))
        ?? Object.keys(entries)[0];
      if (!entryName) throw new Error('Empty .ork archive');
      xml = strFromU8(entries[entryName]!);
    } else {
      xml = strFromU8(bytes);
    }
  }

  // OpenRocket writes a single-quoted XML declaration; some parsers reject it.
  if (xml.charCodeAt(0) === 0xfeff) xml = xml.slice(1); // strip optional BOM
  xml = xml.replace(/^\s*<\?xml[^?]*\?>/, '');
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  if (doc.querySelector('parsererror')) {
    throw new Error('Not a valid .ork file (XML parse error)');
  }
  const rocketEl = doc.querySelector('openrocket > rocket');
  if (!rocketEl) throw new Error('Not a .ork file (missing <rocket>)');

  // Pods (podset) aren't supported yet — they can't be added or edited in the
  // app. Refuse the whole file rather than importing it partially. (Parallel
  // boosters are fine.) See TODO: finish pod add/edit, then drop FEATURES.pods.
  if (!FEATURES.pods && doc.querySelector('podset')) {
    throw new Error('This design uses pods, which are not supported yet.');
  }

  const ignored = new Set<string>();
  const notes: string[] = [];
  let motor: OrkMotorRef | undefined;
  const motors: Record<string, OrkMotorRef> = {};

  const name = text(rocketEl, ':scope > name') ?? 'Imported rocket';
  const stages = Array.from(rocketEl.querySelectorAll(':scope > subcomponents > stage'));
  if (stages.length === 0) throw new Error('No stage found');

  // Multiple (axial) stages aren't supported yet — a second stage can't be added
  // or edited in the app, and staged flights are untested, so refuse rather than
  // import a design we can't faithfully author/simulate. (Parallel boosters —
  // <parallelstage> — are unaffected.) See TODO: author stages + validate a
  // booster+sustainer flight, then drop FEATURES.multiStage.
  if (!FEATURES.multiStage && stages.length > 1) {
    throw new Error('This design has multiple stages, which are not supported yet.');
  }

  // Flight-configuration table: rocket-level <motorconfiguration> blocks
  // (optional <name>, optional default="true" — desktop 24.12
  // MotorConfigurationHandler).
  const configEls = Array.from(rocketEl.querySelectorAll(':scope > motorconfiguration'));
  const configs: OrkFlightConfig[] = configEls
    .map((c) => ({
      id: c.getAttribute('configid') ?? '',
      name: text(c, ':scope > name'),
      isDefault: c.getAttribute('default') === 'true',
      motors: {},
      deployments: {},
    }))
    .filter((c) => c.id !== '');
  const requested = opts?.configId;
  const chosenConfigId =
    (requested != null && configs.some((c) => c.id === requested) ? requested : null)
    ?? configs.find((c) => c.isDefault)?.id
    ?? configs[0]?.id
    ?? null;

  // The chosen configuration's child of `el` by tag name (per-config motor
  // or override block). With no declared configs, the first such child —
  // hand-rolled files may key <motor configid>s without declarations, and
  // first-in-document-order is the long-standing read for them.
  const configScoped = (el: Element, tag: string): Element | null =>
    chosenConfigId === null
      ? el.querySelector(`:scope > ${tag}`)
      : Array.from(el.children).find(
          (c) => c.tagName === tag && c.getAttribute('configid') === chosenConfigId) ?? null;

  /**
   * Record EVERY configuration's <deploymentconfiguration> for this recovery
   * device, not just the chosen one. Export replays them so opening config A
   * and saving cannot rewrite config B's recovery settings (see
   * OrkFlightConfig.deployments).
   */
  const captureDeployments = (el: Element, node: ComponentNode): void => {
    for (const c of configs) {
      const block = Array.from(el.children).find(
        (x) => x.tagName === 'deploymentconfiguration' && x.getAttribute('configid') === c.id);
      // Fall back to the BARE tags for a configuration that declares no block
      // of its own. Recording the resolved value (not "nothing") is what makes
      // the round-trip safe: on save the bare defaults are rewritten from the
      // configuration the user opened, so a config that silently inherited the
      // old defaults would otherwise inherit the NEW ones instead.
      const src = block ?? el;
      const o: OrkDeployOverride = {};
      const event = text(src, ':scope > deployevent');
      if (event) o.deployEvent = event;
      if (text(src, ':scope > deployaltitude') !== null) o.deployAltitude = num(src, 'deployaltitude', 200);
      if (text(src, ':scope > deploydelay') !== null) o.deployDelay = num(src, 'deploydelay', 0);
      if (Object.keys(o).length > 0 && node.id) c.deployments[node.id] = o;
    }
  };

  const readMotor = (el: Element, node: ComponentNode) => {
    const mountEl = el.querySelector(':scope > motormount');
    if (!mountEl) return;
    // Any tube with a <motormount> IS a mount — an inner tube, or a body tube
    // on a minimum-diameter rocket (kernel BodyTube implements MotorMount,
    // same as the desktop). The flag survives even with no motor loaded.
    node['motorMount'] = true;
    // Motor overhang (m): aft protrusion past the mount — min-diameter practice.
    const overhang = num(mountEl, 'overhang', 0);
    if (overhang !== 0) node['motorOverhang'] = overhang;
    // ONE configuration's motor+ignition off this mount. Plugged motors (no
    // ejection charge): the desktop writes the literal string "none"
    // (Motor.PLUGGED_DELAY). Represent as the JSON-safe PLUGGED_DELAY sentinel,
    // which the engine maps to +Inf ("never fires") at the kernel boundary.
    const resolveRef = (motorEl: Element, igEl: Element): OrkMotorRef => {
      const delayText = text(motorEl, ':scope > delay');
      return {
        designation: text(motorEl, ':scope > designation') ?? 'unknown',
        manufacturer: text(motorEl, ':scope > manufacturer') ?? 'unknown',
        diameter: num(motorEl, 'diameter', 0.018),
        length: num(motorEl, 'length', 0.07),
        delay: delayText === 'none' ? PLUGGED_DELAY : num(motorEl, 'delay', 0),
        mountId: node.id,
        ignitionEvent: text(igEl, ':scope > ignitionevent') ?? undefined,
        ignitionDelay: num(igEl, 'ignitiondelay', 0),
      };
    };
    // Stage B: EVERY declared configuration's motor rides along as a preset
    // (its own ignition override winning over the bare defaults, same as the
    // chosen read below). Quiet — only the chosen config's notes surface.
    if (node.id) {
      for (const cfg of configs) {
        const byId = (tag: string) => Array.from(mountEl.children).find(
          (c) => c.tagName === tag && c.getAttribute('configid') === cfg.id);
        const cfgMotorEl = byId('motor');
        if (!cfgMotorEl) continue; // no motor for this config here — empty
        cfg.motors[node.id] = resolveRef(cfgMotorEl, byId('ignitionconfiguration') ?? mountEl);
      }
    }
    // A mount with no motor for the chosen configuration imports empty.
    const motorEl = configScoped(mountEl, 'motor');
    if (!motorEl) return;
    // Ignition: the chosen config's block wins over the bare default
    // (desktop writes defaults bare, overrides in <ignitionconfiguration>).
    const ref = resolveRef(motorEl, configScoped(mountEl, 'ignitionconfiguration') ?? mountEl);
    if (ref.delay >= PLUGGED_DELAY) {
      notes.push(
        `Motor ${ref.designation}: plugged (no ejection charge) — make sure recovery deploys on apogee/altitude, not the ejection charge.`);
    }
    if (node.id) {
      motors[node.id] = ref;
    }
    if (!motor) motor = ref;
  };

  const convertElement = (el: Element): ComponentNode | null => {
    const tag = el.tagName;
    const base = (type: ComponentType, withPosition: boolean): ComponentNode => {
      const node: ComponentNode = { type, id: freshId() };
      const nm = text(el, ':scope > name');
      if (nm) node.name = nm;
      const density = matDensity(el);
      if (density !== undefined) node.density = density;
      const matName = matName_(el, 'bulk');
      if (matName) node['materialName'] = matName;
      const fin = text(el, ':scope > finish');
      if (fin && fin !== 'normal') node['finish'] = fin;
      const om = num(el, 'overridemass', NaN);
      if (!Number.isNaN(om)) node['overrideMass'] = om;
      const ocg = num(el, 'overridecg', NaN);
      if (!Number.isNaN(ocg)) node['overrideCGX'] = ocg;
      const ocd = num(el, 'overridecd', NaN);
      if (!Number.isNaN(ocd)) node['overrideCD'] = ocd;
      // "Override for all subcomponents": per-quantity flags (24.x format);
      // legacy files carry a single <overridesubcomponents> covering all.
      const legacyAll = text(el, ':scope > overridesubcomponents') === 'true';
      if (legacyAll || text(el, ':scope > overridesubcomponentsmass') === 'true') {
        node['overrideSubcomponentsMass'] = true;
      }
      if (legacyAll || text(el, ':scope > overridesubcomponentscg') === 'true') {
        node['overrideSubcomponentsCG'] = true;
      }
      if (legacyAll || text(el, ':scope > overridesubcomponentscd') === 'true') {
        node['overrideSubcomponentsCD'] = true;
      }
      if (withPosition) {
        const pos = readPosition(el);
        if (pos) node.position = pos;
      }
      return node;
    };

    switch (tag) {
      case 'nosecone': {
        const n = base('nosecone', false);
        n['length'] = num(el, 'length', 0.07);
        n['aftRadius'] = num(el, 'aftradius', 0.012);
        // Desktop writes <thickness>filled</thickness> for solid components.
        if (text(el, ':scope > thickness') === 'filled') {
          n['filled'] = true;
        } else {
          n['thickness'] = num(el, 'thickness', 0.002);
        }
        n['shape'] = text(el, ':scope > shape') ?? 'ogive';
        n['shapeParameter'] = num(el, 'shapeparameter', shapeParamDefault(String(n['shape'])));
        const shR = num(el, 'aftshoulderradius', 0);
        const shL = num(el, 'aftshoulderlength', 0);
        if (shR > 0) n['shoulderRadius'] = shR;
        if (shL > 0) n['shoulderLength'] = shL;
        const shT = num(el, 'aftshoulderthickness', 0);
        if (shT > 0) n['shoulderThickness'] = shT;
        if (text(el, ':scope > aftshouldercapped') === 'true') n['shoulderCapped'] = true;
        return n;
      }
      case 'transition': {
        const n = base('transition', false);
        n['length'] = num(el, 'length', 0.04);
        const fore = num(el, 'foreradius', NaN);
        const aft = num(el, 'aftradius', NaN);
        if (!Number.isNaN(fore)) n['foreRadius'] = fore;
        if (!Number.isNaN(aft)) n['aftRadius'] = aft;
        if (text(el, ':scope > thickness') === 'filled') {
          n['filled'] = true;
        } else {
          n['thickness'] = num(el, 'thickness', 0.002);
        }
        n['shape'] = text(el, ':scope > shape') ?? 'conical';
        n['shapeParameter'] = num(el, 'shapeparameter', shapeParamDefault(String(n['shape'])));
        // <shapeclipped>: clipped vs full profile (ellipsoid/power/haack).
        // Forwarded to the kernel bridge as 'clipped'; absent keeps the
        // kernel default (clipped, matching the desktop).
        const clip = text(el, ':scope > shapeclipped');
        if (clip === 'true' || clip === 'false') n['clipped'] = clip === 'true';
        for (const [side, key] of [['fore', 'foreShoulder'], ['aft', 'aftShoulder']] as const) {
          const r = num(el, `${side}shoulderradius`, 0);
          const l = num(el, `${side}shoulderlength`, 0);
          if (r > 0) n[`${key}Radius`] = r;
          if (l > 0) n[`${key}Length`] = l;
          const th = num(el, `${side}shoulderthickness`, 0);
          if (th > 0) n[`${key}Thickness`] = th;
        }
        return n;
      }
      case 'bodytube': {
        const n = base('bodytube', false);
        n['length'] = num(el, 'length', 0.3);
        n['outerRadius'] = num(el, 'radius', 0.012);
        n['thickness'] = num(el, 'thickness', 0.0005);
        readMotor(el, n);
        // Extension tag: sub-minimum flag (motor case is the airframe).
        if (text(el, ':scope > caseairframe') === 'true') n['caseAirframe'] = true;
        return n;
      }
      case 'trapezoidfinset': {
        const n = base('trapezoidfinset', true);
        n['finCount'] = Math.round(num(el, 'fincount', 3));
        n['rootChord'] = num(el, 'rootchord', 0.05);
        n['tipChord'] = num(el, 'tipchord', 0.03);
        n['sweep'] = num(el, 'sweeplength', 0.02);
        n['height'] = num(el, 'height', 0.03);
        n['thickness'] = num(el, 'thickness', 0.003);
        const cantDeg = num(el, 'cant', 0);
        if (cantDeg !== 0) n['cant'] = (cantDeg * Math.PI) / 180;
        const cs = text(el, ':scope > crosssection');
        if (cs && cs !== 'square') n['crossSection'] = cs;
        readAirfoil(el, n);
        readFinTabs(el, n);
        readFinRotation(el, n);
        return n;
      }
      case 'freeformfinset': {
        const n = base('freeformfinset', true);
        n['finCount'] = Math.round(num(el, 'fincount', 3));
        n['thickness'] = num(el, 'thickness', 0.003);
        const cantDegF = num(el, 'cant', 0);
        if (cantDegF !== 0) n['cant'] = (cantDegF * Math.PI) / 180;
        const csF = text(el, ':scope > crosssection');
        if (csF && csF !== 'square') n['crossSection'] = csF;
        readAirfoil(el, n);
        readFinTabs(el, n);
        readFinRotation(el, n);
        const ptEls = Array.from(el.querySelectorAll(':scope > finpoints > point'));
        // A missing x/y attribute must SKIP the point (Number(null) is 0,
        // which would silently drop a vertex onto the origin).
        const pts = ptEls
          .filter((pt) => pt.getAttribute('x') !== null && pt.getAttribute('y') !== null)
          .map((pt) => [Number(pt.getAttribute('x')), Number(pt.getAttribute('y'))] as [number, number])
          .filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
        if (pts.length >= 3) n['points'] = pts;
        return n;
      }
      case 'ellipticalfinset': {
        const n = base('ellipticalfinset', true);
        n['finCount'] = Math.round(num(el, 'fincount', 3));
        n['rootChord'] = num(el, 'rootchord', 0.05);
        n['height'] = num(el, 'height', 0.03);
        n['thickness'] = num(el, 'thickness', 0.003);
        const cantDegE = num(el, 'cant', 0);
        if (cantDegE !== 0) n['cant'] = (cantDegE * Math.PI) / 180;
        const csE = text(el, ':scope > crosssection');
        if (csE && csE !== 'square') n['crossSection'] = csE;
        readAirfoil(el, n);
        readFinTabs(el, n);
        readFinRotation(el, n);
        return n;
      }
      case 'tubefinset': {
        const n = base('tubefinset', true);
        n['finCount'] = Math.round(num(el, 'fincount', 6));
        n['length'] = num(el, 'length', 0.1);
        const r = num(el, 'radius', NaN);
        if (!Number.isNaN(r)) n['outerRadius'] = r;
        const th = num(el, 'thickness', NaN);
        if (!Number.isNaN(th)) n['thickness'] = th;
        readFinRotation(el, n);
        return n;
      }
      case 'innertube': {
        const n = base('innertube', true);
        n['length'] = num(el, 'length', 0.07);
        n['outerRadius'] = num(el, 'outerradius', 0.0095);
        n['thickness'] = num(el, 'thickness', 0.0005);
        // Cluster (desktop stores rotation in DEGREES; we keep radians).
        const cluster = text(el, ':scope > clusterconfiguration');
        if (cluster && cluster !== 'single') {
          n['cluster'] = cluster;
          n['clusterScale'] = num(el, 'clusterscale', 1);
          n['clusterRotation'] = (num(el, 'clusterrotation', 0) * Math.PI) / 180;
        }
        // Off-axis / split-cluster offset: desktop splits a cluster into single
        // tubes, each carrying its position as <radialposition> (metres) +
        // <radialdirection> (DEGREES). We keep the direction in radians (like
        // angleOffset) and only carry non-zero values so a centred tube stays
        // clean. Previously neither was read and the writer hard-wrote 0.0, so
        // every off-centre tube collapsed onto the centreline and the next save
        // made it permanent.
        const radPos = num(el, 'radialposition', 0);
        if (radPos !== 0) n['radialPosition'] = radPos;
        const radDir = num(el, 'radialdirection', 0);
        if (radDir !== 0) n['radialDirection'] = (radDir * Math.PI) / 180;
        // Our extension tag: the mount's physical motor-length limit.
        const mml = num(el, 'maxmotorlength', 0);
        if (mml > 0) n['maxMotorLength'] = mml;
        readMotor(el, n);
        return n;
      }
      case 'tubecoupler': {
        const n = base('tubecoupler', true);
        n['length'] = num(el, 'length', 0.05);
        n['thickness'] = num(el, 'thickness', 0.0005);
        return n;
      }
      case 'centeringring': {
        const n = base('centeringring', true);
        n['length'] = num(el, 'length', 0.002);
        readInstances(el, n);
        return n;
      }
      case 'bulkhead': {
        const n = base('bulkhead', true);
        n['length'] = num(el, 'length', 0.003);
        readInstances(el, n);
        return n;
      }
      case 'engineblock': {
        const n = base('engineblock', true);
        n['length'] = num(el, 'length', 0.005);
        n['thickness'] = num(el, 'thickness', 0.001);
        return n;
      }
      case 'launchlug': {
        const n = base('launchlug', true);
        n['length'] = num(el, 'length', 0.05);
        n['outerRadius'] = num(el, 'radius', 0.0022);
        n['thickness'] = num(el, 'thickness', 0.0003);
        n['angleOffset'] = readAngleAroundBody(el);
        readInstances(el, n);
        return n;
      }
      case 'railbutton': {
        const n = base('railbutton', true);
        n['outerDiameter'] = num(el, 'outerdiameter', 0.0097);
        n['angleOffset'] = readAngleAroundBody(el);
        readInstances(el, n);
        return n;
      }
      // Our extension component (2026-08-05b #18) — the desktop warns about
      // the unknown element and skips it.
      case 'fairing': {
        const n = base('fairing', true);
        n['length'] = num(el, 'length', 0.08);
        n['width'] = num(el, 'width', 0.025);
        n['height'] = num(el, 'height', 0.02);
        const fs = text(el, ':scope > fairingshape');
        if (fs) n['fairingShape'] = fs;
        n['mass'] = num(el, 'mass', 0.03);
        return n;
      }
      case 'parachute': {
        const n = base('parachute', true);
        n['diameter'] = num(el, 'diameter', 0.3);
        const cdText = text(el, ':scope > cd');
        if (cdText && cdText !== 'auto') n['cd'] = Number(cdText);
        n['lineCount'] = Math.round(num(el, 'linecount', 6));
        n['lineLength'] = num(el, 'linelength', 0.3);
        readSoftMaterial(el, n, 'surface', 'surfaceDensity', 'surfaceMaterialName');
        readSoftMaterial(el, n, 'line', 'lineDensity', 'lineMaterialName', ':scope > linematerial');
        // <deploymentconfiguration> only overrides when a config was chosen —
        // with no declarations the bare tags stay the whole story (a stray
        // block in an undeclared file was never read, keep it that way).
        readDeployment(el, n, chosenConfigId === null ? null : configScoped(el, 'deploymentconfiguration'));
        captureDeployments(el, n);
        // Our extension tag (desktop warns-and-ignores) — spill hole diameter.
        const spill = num(el, 'spillholediameter', 0);
        if (spill > 0) n['spillHoleDiameter'] = spill;
        return n;
      }
      case 'streamer': {
        const n = base('streamer', true);
        n['stripLength'] = num(el, 'striplength', 0.5);
        n['stripWidth'] = num(el, 'stripwidth', 0.05);
        const cdText = text(el, ':scope > cd');
        if (cdText && cdText !== 'auto') n['cd'] = Number(cdText);
        readSoftMaterial(el, n, 'surface', 'surfaceDensity', 'surfaceMaterialName');
        readDeployment(el, n, chosenConfigId === null ? null : configScoped(el, 'deploymentconfiguration'));
        captureDeployments(el, n);
        return n;
      }
      case 'shockcord': {
        const n = base('shockcord', true);
        n['cordLength'] = num(el, 'cordlength', 0.3);
        readSoftMaterial(el, n, 'line', 'lineDensity', 'lineMaterialName');
        return n;
      }
      case 'masscomponent': {
        const n = base('masscomponent', true);
        n['mass'] = num(el, 'mass', 0.01);
        n['length'] = num(el, 'packedlength', 0.02);
        n['radius'] = num(el, 'packedradius', 0.005);
        // Preserve-through: what KIND of mass this is (altimeter, payload…).
        // No mass/CG effect, but the desktop shows it and users set it there.
        const mct = text(el, ':scope > masscomponenttype');
        if (mct && mct !== 'masscomponent') n['massComponentType'] = mct;
        return n;
      }
      // <podset> (external pods) never reaches here — a file containing one is
      // rejected up front (see the guard near the top of importOrk), because pods
      // can't yet be added or edited. Parallel boosters (<parallelstage> / legacy
      // <boosterset>) remain fully supported.
      case 'parallelstage':
      case 'boosterset': {
        // <boosterset> is the legacy alias for <parallelstage>. The nested
        // nose/body/fin chain imports via convertChildren (the caller recurses).
        const asmType: ComponentType = 'parallelstage';
        const n = base(asmType, true); // name + overrides + axialoffset/position
        n['instanceCount'] = Math.round(num(el, 'instancecount', 2));
        const radEl = el.querySelector(':scope > radiusoffset');
        if (radEl) {
          const rv = Number(radEl.textContent?.trim());
          n['radiusOffset'] = Number.isFinite(rv) ? rv : 0; // metres, no conversion
          n['radiusMethod'] = (radEl.getAttribute('method') ?? 'relative').toLowerCase() === 'free'
            ? 'free' : 'relative';
        }
        const angEl = el.querySelector(':scope > angleoffset');
        if (angEl) {
          const av = Number(angEl.textContent?.trim());
          n['angleOffset'] = (Number.isFinite(av) ? av : 0) * Math.PI / 180; // deg → rad, like cant
          if (asmType === 'parallelstage') {
            n['angleMethod'] = (angEl.getAttribute('method') ?? 'relative').toLowerCase() === 'fixed'
              ? 'fixed' : 'relative';
          }
        }
        if (asmType === 'parallelstage') {
          // Same separation read as a booster <stage> — the chosen config's
          // block wins over the bare defaults.
          const sepEl = configScoped(el, 'separationconfiguration') ?? el;
          const ev = text(sepEl, ':scope > separationevent');
          if (ev && ev !== 'ejection') n['separationEvent'] = ev;
          const delay = num(sepEl, 'separationdelay', 0);
          if (delay !== 0) n['separationDelay'] = delay;
          const alt = num(sepEl, 'separationaltitude', NaN);
          if (!Number.isNaN(alt) && alt !== 200) n['separationAltitude'] = alt;
        }
        return n;
      }
      default:
        return null;
    }
  };

  const convertChildren = (parentEl: Element): ComponentNode[] => {
    const out: ComponentNode[] = [];
    const wrap = parentEl.querySelector(':scope > subcomponents');
    if (!wrap) return out;
    for (const el of Array.from(wrap.children)) {
      const node = convertElement(el);
      if (node === null) {
        ignored.add(el.tagName);
        continue;
      }
      const kids = convertChildren(el);
      if (kids.length > 0) node.children = kids;
      out.push(node);
    }
    return out;
  };

  // EVERY stage imports (Release C) — each becomes a stage node carrying its
  // separation config (desktop writes defaults bare under <stage>).
  const components: ComponentNode[] = stages.map((stageEl, i) => {
    const stage: ComponentNode = {
      type: 'stage',
      id: freshId(),
      name: text(stageEl, ':scope > name') ?? (i === 0 ? 'Sustainer' : `Booster ${i}`),
    };
    // RASAero power-on base-drag input (metres) — every stage, incl. sustainer.
    const nozzle = num(stageEl, 'nozzleexitdiameter', NaN);
    if (!Number.isNaN(nozzle) && nozzle > 0) stage['nozzleExitDiameter'] = nozzle;
    if (i > 0) {
      // Like ignition: the chosen config's block overrides the bare defaults
      // (24.12 writes a <separationconfiguration> for EVERY config id).
      const sepEl = configScoped(stageEl, 'separationconfiguration') ?? stageEl;
      const ev = text(sepEl, ':scope > separationevent');
      if (ev && ev !== 'ejection') stage['separationEvent'] = ev;
      const delay = num(sepEl, 'separationdelay', 0);
      if (delay !== 0) stage['separationDelay'] = delay;
      const alt = num(sepEl, 'separationaltitude', NaN);
      if (!Number.isNaN(alt) && alt !== 200) stage['separationAltitude'] = alt;
    }
    const kids = convertChildren(stageEl);
    if (kids.length > 0) stage.children = kids;
    return stage;
  });
  if (components.every((s) => (s.children ?? []).length === 0)) {
    throw new Error('No supported components found in this design.');
  }
  if (ignored.size) {
    notes.push(`Ignored unsupported components: ${[...ignored].join(', ')}.`);
  }

  // Honesty notes for the two things this reader now PRESERVES but the
  // simulation does not yet act on. Saying so beats a silent discrepancy —
  // both change mass, and mass changes the stability the user is designing to.
  const allNodes: ComponentNode[] = [];
  const collect = (ns: ComponentNode[]) => {
    for (const nd of ns) { allNodes.push(nd); collect(nd.children ?? []); }
  };
  collect(components);
  if (allNodes.some((nd) => typeof nd['filletRadius'] === 'number' && (nd['filletRadius'] as number) > 0)) {
    notes.push(
      'Fin fillets are kept in the file but are not yet counted in mass or CG, '
        + 'so masses read slightly light against desktop OpenRocket.',
    );
  }
  const instanced = allNodes.filter(
    (nd) => typeof nd['instanceCount'] === 'number' && (nd['instanceCount'] as number) > 1
      && nd.type !== 'parallelstage' && nd.type !== 'podset');
  if (instanced.length > 0) {
    notes.push(
      `${instanced.length} component${instanced.length === 1 ? '' : 's'} in this design `
        + `(${[...new Set(instanced.map((nd) => nd.name ?? nd.type))].join(', ')}) `
        + 'repeat as multiple instances. The file keeps every instance, but the '
        + 'drawing and the simulation currently show one.',
    );
  }

  // Multi-config notes: the chosen configuration's values were applied by
  // the config-scoped reads above — say which one, and how to get another.
  if (configs.length > 1) {
    const mountMotorEls = Array.from(rocketEl.querySelectorAll('motormount > motor'));
    if (mountMotorEls.length === 0) {
      // Declared configs but no <motor> in any mount: worth flagging that the
      // mounts came in empty (nothing to simulate until a motor is picked).
      notes.push(
        `File declares ${configs.length} flight configurations but carried no motors to import.`);
    }
    // Which configuration was opened (and that there are others) is shown in the
    // Simulations panel now, so it's no longer a load note.
    // Stage activeness (<stage active="false">) is not applied (Stage C) —
    // warn when the chosen configuration would actually ground a stage. Name it
    // (never the UUID — that appears nowhere in our UI or OpenRocket's).
    const chosenEl = configEls.find((c) => c.getAttribute('configid') === chosenConfigId);
    if (chosenEl && Array.from(chosenEl.querySelectorAll(':scope > stage'))
        .some((s) => s.getAttribute('active') === 'false')) {
      const name = configs.find((c) => c.id === chosenConfigId)?.name;
      notes.push(
        `${name ? `Configuration “${name}”` : 'The opened configuration'} deactivates one or more stages — stage activeness isn’t applied here, so all stages fly in the simulation.`);
    }
  } else if (configs.length === 0) {
    // Hand-rolled files may key <motor configid>s without declaring the configs,
    // so those configurations have no names at all. We read the first motor and
    // drop the rest — say how many, but never a UUID (it means nothing to anyone).
    const strayIds = new Set<string>();
    for (const m of Array.from(rocketEl.getElementsByTagName('motor'))) {
      const id = m.getAttribute('configid');
      if (id) strayIds.add(id);
    }
    if (strayIds.size > 1) {
      notes.push(
        `File has ${strayIds.size} flight configurations — only the first was imported; the other ${strayIds.size - 1} ${strayIds.size - 1 === 1 ? 'was' : 'were'} not.`);
    }
  }

  const launch = readLaunchConditions(doc);

  return {
    name, tree: { name, components }, motor, motors, configs, chosenConfigId,
    ignored: [...ignored], notes, ...(launch ? { launch } : {}),
  };
}

/**
 * Launch conditions from the FIRST <simulation>'s <conditions> (the desktop
 * saves one block per simulation; the app has a single launch panel). Units
 * per the desktop OpenRocketSaver: rod angle in DEGREES, wind speeds m/s,
 * altitude m, temperature KELVIN, pressure PASCAL. <wind model="average"> is
 * the modern form; the bare windaverage/windturbulence pair — turbulence
 * stored as the INTENSITY ratio stddev/average — is the ≤23.09 legacy form
 * the desktop still writes alongside it.
 */
function readLaunchConditions(doc: Document): Partial<LaunchConditions> | undefined {
  const simEl = doc.querySelector('openrocket > simulations > simulation');
  const condEl = simEl?.querySelector(':scope > conditions');
  if (!condEl) return undefined;
  const launch: Partial<LaunchConditions> = {};

  const rodLen = num(condEl, 'launchrodlength', NaN);
  if (!Number.isNaN(rodLen)) launch.launchRodLengthM = rodLen;
  const rodAngle = num(condEl, 'launchrodangle', NaN);
  if (!Number.isNaN(rodAngle)) launch.launchRodAngleDeg = rodAngle;

  const windEls = Array.from(condEl.querySelectorAll(':scope > wind'));
  const windModelType = (text(condEl, ':scope > windmodeltype') ?? '').toLowerCase();

  // Average wind: modern <wind model="average"> (speed/direction/standarddeviation)
  // or the ≤23.09 legacy <windaverage>/<windturbulence>/<winddirection> trio.
  const avgEl = windEls.find((w) => w.getAttribute('model') === 'average');
  let avg = avgEl ? num(avgEl, 'speed', NaN) : NaN;
  if (Number.isNaN(avg)) avg = num(condEl, 'windaverage', NaN);
  if (!Number.isNaN(avg)) launch.windAverage = avg;
  let sd = avgEl ? num(avgEl, 'standarddeviation', NaN) : NaN;
  if (Number.isNaN(sd)) {
    const turb = num(condEl, 'windturbulence', NaN);
    if (!Number.isNaN(turb) && !Number.isNaN(avg)) sd = turb * avg;
  }
  if (!Number.isNaN(sd)) launch.windStdDev = sd;
  let dirRad = avgEl ? num(avgEl, 'direction', NaN) : NaN;
  if (Number.isNaN(dirRad)) dirRad = num(condEl, 'winddirection', NaN);
  if (!Number.isNaN(dirRad)) launch.windDirectionDeg = (dirRad * 180) / Math.PI;

  // Multilevel wind (24.x): <wind model="multilevel"><windlevel altitude speed
  // direction standarddeviation/>…>. Honored when windmodeltype selects it.
  const mlEl = windEls.find((w) => (w.getAttribute('model') ?? '').toLowerCase() === 'multilevel');
  if (mlEl && windModelType.includes('multilevel')) {
    const levels = Array.from(mlEl.querySelectorAll(':scope > windlevel')).map((w) => ({
      altitudeM: parseFloat(w.getAttribute('altitude') ?? '0') || 0,
      speed: parseFloat(w.getAttribute('speed') ?? '0') || 0,
      directionDeg: ((parseFloat(w.getAttribute('direction') ?? '0') || 0) * 180) / Math.PI,
      stddev: parseFloat(w.getAttribute('standarddeviation') ?? '0') || 0,
    }));
    if (levels.length) launch.windLevels = levels;
  }

  const alt = num(condEl, 'launchaltitude', NaN);
  if (!Number.isNaN(alt)) launch.launchAltitudeM = alt;
  const lat = num(condEl, 'launchlatitude', NaN);
  if (!Number.isNaN(lat)) launch.latitudeDeg = lat;

  const atmEl = condEl.querySelector(':scope > atmosphere');
  if (atmEl) {
    if (atmEl.getAttribute('model') === 'isa') {
      // ISA standard: null means "blank = standard" in LaunchConditions.
      launch.temperatureC = null;
      launch.pressureHPa = null;
    } else {
      const tK = num(atmEl, 'basetemperature', NaN);
      if (!Number.isNaN(tK)) launch.temperatureC = tK - 273.15;
      const pPa = num(atmEl, 'basepressure', NaN);
      if (!Number.isNaN(pPa)) launch.pressureHPa = pPa / 100;
    }
  }

  const gm = (text(condEl, ':scope > geodeticmethod') ?? '').toLowerCase();
  if (gm) launch.geodetic = gm === 'flat' ? 'flat' : gm === 'wgs84' ? 'wgs84' : 'spherical';

  return Object.keys(launch).length > 0 ? launch : undefined;
}

// ============================ helpers ============================

function num(el: Element, tag: string, fallback: number): number {
  const t = text(el, `:scope > ${tag}`);
  // Values like "auto 0.012" carry an automatic flag + last value.
  const v = t ? Number(t.split(/\s+/).pop()) : NaN;
  return Number.isFinite(v) ? v : fallback;
}

function matDensity(el: Element): number | undefined {
  const m = el.querySelector(':scope > material');
  if (!m || m.getAttribute('type') !== 'bulk') return undefined;
  const d = Number(m.getAttribute('density'));
  return Number.isFinite(d) && d > 0 ? d : undefined;
}

/** Material NAME if it's a real name (not the "custom" placeholder). */
function matName_(el: Element, type: string, selector = ':scope > material'): string | undefined {
  const m = el.querySelector(selector);
  if (!m || m.getAttribute('type') !== type) return undefined;
  const name = m.textContent?.trim();
  return name && name.toLowerCase() !== 'custom' ? name : undefined;
}

/** Surface/line material density+name for recovery devices and cords. */
function readSoftMaterial(el: Element, node: ComponentNode, kind: 'surface' | 'line',
    densityKey: string, nameKey: string, selector = ':scope > material'): void {
  const m = el.querySelector(selector);
  if (!m || m.getAttribute('type') !== kind) return;
  const d = Number(m.getAttribute('density'));
  if (Number.isFinite(d) && d > 0) node[densityKey] = d;
  const name = matName_(el, kind, selector);
  if (name) node[nameKey] = name;
}

/**
 * Fin tabs: <tabheight>, <tablength>, <tabposition relativeto="...">. Desktop
 * files carry TWO tabposition elements (legacy front/center/end + modern
 * top/middle/bottom) — like the desktop reader, the last one wins.
 */
/**
 * RASAero feature #4: supersonic airfoil section (our extension tags — the
 * desktop loader warns on unknown elements and continues, so files stay
 * openable there). Absent tags leave the classic cross-section behavior.
 */
/**
 * <instancecount>/<instanceseparation>, PASS-THROUGH only.
 *
 * CenteringRing and Bulkhead are LineInstanceable and LaunchLug/RailButton are
 * Instanceable, so OpenRocket writes these for all four. Neither was read, and
 * export hard-wrote 1 / 0.0 — so a motor mount declared as one CenteringRing
 * with instancecount 3 came back from a save as a single ring, permanently
 * losing two-thirds of that structural mass from the user's own file. The app
 * still simulates and draws ONE; the file keeps all N, and the import note
 * says so rather than letting the difference stay silent.
 */
function readInstances(el: Element, node: ComponentNode): void {
  const count = Math.round(num(el, 'instancecount', 1));
  if (count > 1) node['instanceCount'] = count;
  const sep = num(el, 'instanceseparation', 0);
  if (sep !== 0) node['instanceSeparation'] = sep;
}

/** Radial mounting angle (LaunchLug / RailButton) in RADIANS. OpenRocket writes
 *  it as <angleoffset> (degrees), older files as <radialdirection>; the kernel
 *  default is 180°. Stored in radians to match the tree/renderers. */
function readAngleAroundBody(el: Element): number {
  const a = num(el, 'angleoffset', NaN);
  const deg = Number.isFinite(a) ? a : num(el, 'radialdirection', 180);
  return (deg * Math.PI) / 180;
}

function readAirfoil(el: Element, node: ComponentNode): void {
  const section = text(el, ':scope > airfoilsection');
  if (section) node['airfoilSection'] = section;
  const led = num(el, 'airfoillediamond', 0);
  if (led > 0) node['airfoilLeDiamond'] = led;
  const ted = num(el, 'airfoiltediamond', 0);
  if (ted > 0) node['airfoilTeDiamond'] = ted;
  const ler = num(el, 'finleradius', 0);
  if (ler > 0) node['finLeRadius'] = ler;
  readFillet(el, node);
}

/**
 * Fin fillets, PASS-THROUGH only.
 *
 * OpenRocket's FinSetSaver writes <filletradius>/<filletmaterial> for every fin
 * set and counts the fillet volume toward fin mass. This app's kernel bridge
 * does not model fillets yet — but the exporter used to hard-write
 * `<filletradius>0.0</filletradius>` and a Cardboard material, so opening a
 * desktop design with 6 mm epoxy fillets and saving it DELETED them from the
 * user's own file. Preserving the values costs nothing and stops the
 * destruction; the mass still is not counted, which the import note says.
 */
function readFillet(el: Element, node: ComponentNode): void {
  const r = num(el, 'filletradius', 0);
  if (!(r > 0)) return;
  node['filletRadius'] = r;
  const m = el.querySelector(':scope > filletmaterial');
  if (!m) return;
  const d = Number(m.getAttribute('density'));
  if (Number.isFinite(d) && d > 0) node['filletDensity'] = d;
  const group = m.getAttribute('group');
  if (group) node['filletMaterialGroup'] = group;
  const name = (m.textContent ?? '').trim();
  if (name) node['filletMaterialName'] = name;
}

/** Fin-set rotation about the body axis (.ork stores DEGREES; we keep rad). */
function readFinRotation(el: Element, node: ComponentNode): void {
  const deg = num(el, 'rotation', 0);
  if (deg !== 0) node['rotation'] = (deg * Math.PI) / 180;
}

function readFinTabs(el: Element, node: ComponentNode): void {
  const h = num(el, 'tabheight', 0);
  const len = num(el, 'tablength', 0);
  if (h <= 0 || len <= 0) return;
  node['tabHeight'] = h;
  node['tabLength'] = len;
  const positions = Array.from(el.querySelectorAll(':scope > tabposition'));
  const last = positions[positions.length - 1];
  if (last) {
    const rel = (last.getAttribute('relativeto') ?? 'middle').toLowerCase();
    const method = rel.includes('front') || rel === 'top' ? 'top'
      : rel.includes('end') || rel === 'bottom' ? 'bottom'
      : 'middle';
    node['tabOffsetMethod'] = method;
    const v = Number(last.textContent?.trim());
    node['tabOffset'] = Number.isFinite(v) ? v : 0;
  }
}

/**
 * Recovery-device deployment: the bare tags are the defaults; the chosen
 * config's <deploymentconfiguration> block (same child tag names) overrides
 * them PER FIELD — the desktop handler clones the default and applies only
 * the fields the block carries.
 */
function readDeployment(el: Element, node: ComponentNode, configEl: Element | null = null): void {
  for (const src of configEl ? [el, configEl] : [el]) {
    const event = text(src, ':scope > deployevent');
    if (event) node['deployEvent'] = event;
    if (text(src, ':scope > deployaltitude') !== null) {
      node['deployAltitude'] = num(src, 'deployaltitude', 200);
    }
    if (text(src, ':scope > deploydelay') !== null) {
      node['deployDelay'] = num(src, 'deploydelay', 0);
    }
  }
}

function readPosition(el: Element): ComponentPosition | undefined {
  // Modern files write <axialoffset method="...">; OpenRocket ≤ 15.03 wrote
  // only <position type="..."> — fall back to it or old files lose every
  // fin/lug/inner-tube offset.
  const off = el.querySelector(':scope > axialoffset') ?? el.querySelector(':scope > position');
  if (!off) return undefined;
  const method = (off.getAttribute('method') ?? off.getAttribute('type') ?? 'top') as ComponentPosition['method'];
  const offset = Number(off.textContent ?? '0');
  if (!['top', 'middle', 'bottom', 'absolute'].includes(method)) return undefined;
  return { method, offset: Number.isFinite(offset) ? offset : 0 };
}
