import type { ComponentNode } from '../../../engine/openRocketEngine';
import { FT, IN, fmt, type Cdx1Writer } from './units';
import { num, str } from '../../../tree/nodeProps';
import { walkNodes } from '../../../tree/treeWalk';
import { KERNEL_DEFAULTS, KERNEL_DEPLOYMENT } from '../../../tree/kernelDefaults';
import { KeyedError } from '../../../i18n/keyedError';

/**
 * Recovery: RASAero's two slots, from the parachutes desktop's exporter reads
 * (RecoveryDTO.getParachutesFromRocket): the first two found under a body tube
 * that sits directly in one of the first three stages, the tube's whole
 * subtree in order. A chute in a nose cone, a transition or a pod is not read.
 */
export function writeRecovery(w: Cdx1Writer, stagesIn: ComponentNode[]): void {
  const { emit } = w;
  const tubes = stagesIn.slice(0, 3).flatMap((s) => (s.children ?? []).filter((c) => c.type === 'bodytube'));
  const chutes = [...walkNodes(tubes)].filter((n) => n.type === 'parachute').slice(0, 2);
  const slotVals = ([1, 2] as const).map((slot) => {
    const c = chutes[slot - 1];
    // A key the part does not carry is the kernel's default, as it flies. The
    // caller passes the selected configuration's tree, so an override of the
    // deployment is the event read here.
    const ev = c ? str(c, 'deployEvent', KERNEL_DEPLOYMENT.deployEvent) : 'none';
    // RASAero deploys at apogee or at an altitude and nothing else. Desktop
    // refuses any other event (RASAeroExport.error21) rather than write a chute
    // that never opens.
    if (c && ev !== 'apogee' && ev !== 'altitude') {
      throw new KeyedError('errors.rasaero.chuteEvent', {
        name: c.name || { key: 'part.parachute' },
        event: { key: `deployEvent.${ev}` },
      });
    }
    const evType = ev === 'apogee' ? 'Apogee' : ev === 'altitude' ? 'Altitude' : 'None';
    return {
      altitude: fmt(c && evType === 'Altitude' ? num(c, 'deployAltitude', KERNEL_DEPLOYMENT.deployAltitude) * FT : 0),
      deviceType: c ? 'Parachute' : 'None',
      event: c && evType !== 'None' ? 'True' : 'False',
      size: fmt(c ? num(c, 'diameter', KERNEL_DEFAULTS.parachute.diameter) * IN : 0),
      eventType: c ? evType : 'None',
      cd: fmt(c ? num(c, 'cd', KERNEL_DEFAULTS.parachute.cd) : 0),
    };
  });
  emit('<Recovery>');
  for (const slot of [1, 2] as const) emit(`<Altitude${slot}>${slotVals[slot - 1]!.altitude}</Altitude${slot}>`);
  for (const slot of [1, 2] as const) emit(`<DeviceType${slot}>${slotVals[slot - 1]!.deviceType}</DeviceType${slot}>`);
  for (const slot of [1, 2] as const) emit(`<Event${slot}>${slotVals[slot - 1]!.event}</Event${slot}>`);
  for (const slot of [1, 2] as const) emit(`<Size${slot}>${slotVals[slot - 1]!.size}</Size${slot}>`);
  for (const slot of [1, 2] as const) emit(`<EventType${slot}>${slotVals[slot - 1]!.eventType}</EventType${slot}>`);
  for (const slot of [1, 2] as const) emit(`<CD${slot}>${slotVals[slot - 1]!.cd}</CD${slot}>`);
  emit('</Recovery>');
}
