import { describe, expect, it } from 'vitest';
import { groupSavedParts } from '../../../src/components/design/savedPartGroups';
import type { SavedPartEntry } from '../../../src/services/parts/customParts';

const entry = (type: string, partNo: string) => ({ part: { type, partNo }, row: null }) as unknown as SavedPartEntry;

/**
 * The saved-parts library keeps its groups in one order whatever order the
 * parts were saved in, every catalog type included.
 */
describe('groupSavedParts', () => {
  it('orders every catalog type the same way, whichever was saved first', () => {
    const types = ['railbutton', 'launchlug', 'streamer', 'engineblock', 'transition', 'parachute', 'nosecone'];
    const a = groupSavedParts(types.map((t) => entry(t, 'x'))).map((g) => g.type);
    const b = groupSavedParts([...types].reverse().map((t) => entry(t, 'x'))).map((g) => g.type);
    expect(a).toEqual(b);
    expect(a).toEqual(['nosecone', 'transition', 'engineblock', 'parachute', 'streamer', 'launchlug', 'railbutton']);
  });

  it('sorts a group by part number and puts an unknown type last', () => {
    const groups = groupSavedParts([entry('retired', 'r'), entry('bodytube', 'B2'), entry('bodytube', 'B1')]);
    expect(groups.map((g) => g.type)).toEqual(['bodytube', 'retired']);
    expect(groups[0]!.list.map((e) => e.part.partNo)).toEqual(['B1', 'B2']);
  });
});
