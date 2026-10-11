// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/engine/simClient', async (orig) => ({
  ...(await orig<typeof import('../../src/engine/simClient')>()),
  simulateInWorker: vi.fn(),
}));

import i18n from '../../src/i18n';
import es from '../../src/i18n/locales/es.json';
import { useWorkspaceStore } from '../../src/state/store';
import { importOrk } from '../../src/services/files/orkImport';
import { importRkt } from '../../src/services/files/rktImport';
import { exportRkt } from '../../src/services/files/rktExport';
import type { ComponentNode, RocketTree } from '../../src/engine/openRocketEngine';

/**
 * A name the app gives a part, a simulation or a rocket the user never named is
 * in the UI language on every path that makes one, as Add Simulation's is.
 */

const simName = (n: number) => es.sims.untitled.replace('{{n}}', String(n));

beforeEach(async () => {
  await i18n.changeLanguage('es');
});
afterEach(async () => {
  await i18n.changeLanguage('en');
});

describe('default names follow the UI language', () => {
  it('names the first simulation of a new design', () => {
    useWorkspaceStore.getState().resetWorkspace();
    expect(useWorkspaceStore.getState().sims.map((s) => s.name)).toEqual([simName(1)]);
  });

  it('names the simulation a repaired workspace with none gets', () => {
    const s = useWorkspaceStore.getState();
    s.hydrate({ tree: s.tree, sims: [], configs: s.configs, activeId: s.activeId, loadedMeta: null } as never);
    expect(useWorkspaceStore.getState().sims.map((x) => x.name)).toEqual([simName(1)]);
  });

  it('names an unnamed rocket and an unnamed simulation from a .ork', () => {
    const res = importOrk(
      `<?xml version="1.0"?><openrocket version="1.8"><rocket><subcomponents><stage><name>S</name><subcomponents>
         <bodytube><name>B</name><length>0.3</length><radius>0.012</radius></bodytube>
       </subcomponents></stage></subcomponents></rocket>
       <simulations><simulation status="notsimulated"><conditions/></simulation><simulation status="notsimulated"><conditions/></simulation></simulations></openrocket>`,
    );
    expect(res.name).toBe(es.library.untitled);
    expect(res.simulations?.map((x) => x.name)).toEqual([simName(1), simName(2)]);
  });

  it('names an unnamed rocket from a .rkt', () => {
    const rkt = `<RockSimDocument><DesignInformation><RocketDesign><StageCount>1</StageCount><Stage3Parts>
      <BodyTube><Name>B</Name><Len>300</Len><OD>24</OD><ID>23</ID></BodyTube>
    </Stage3Parts></RocketDesign></DesignInformation></RockSimDocument>`;
    expect(importRkt(new TextEncoder().encode(rkt).buffer as ArrayBuffer).name).toBe(es.library.untitled);
  });

  it('names the members of an unnamed cluster mount in a .rkt', () => {
    const mount = {
      id: 'm',
      type: 'innertube',
      length: 0.07,
      outerRadius: 0.0095,
      innerRadius: 0.009,
      cluster: 'double',
      motorMount: true,
    } as unknown as ComponentNode;
    const tree: RocketTree = {
      name: 'R',
      components: [
        {
          id: 's',
          type: 'stage',
          name: 'S',
          children: [{ id: 'b', type: 'bodytube', name: 'B', length: 0.3, outerRadius: 0.03, children: [mount] }],
        } as unknown as ComponentNode,
      ],
    };
    const { xml } = exportRkt('R', tree);
    expect(xml).toContain(`<Name>${es.part.innertube} #1</Name>`);
    expect(xml).toContain(`<Name>${es.part.innertube} #2</Name>`);
  });
});
