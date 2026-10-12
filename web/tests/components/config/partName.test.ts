import { describe, it, expect } from 'vitest';
import { partName } from '../../../src/components/config/ConfigsTable';
import type { ComponentNode } from '../../../src/engine/openRocketEngine';

/** A stand-in translator that shows which key and values it was asked for. */
const t = (key: string, opts?: Record<string, unknown>) =>
  key === 'configs.partNumbered' ? `#${String(opts?.['n'])} ${String(opts?.['part'])}` : `[${key}]`;

describe('partName', () => {
  it('keeps a part’s own name', () => {
    expect(partName({ type: 'innertube', name: 'Motor tube' } as ComponentNode, 1, t)).toBe('Motor tube');
  });

  it('numbers an unnamed part through one key, so a language can put the number first', () => {
    expect(partName({ type: 'innertube' } as ComponentNode, 1, t)).toBe('#2 [part.innertube]');
  });
});
