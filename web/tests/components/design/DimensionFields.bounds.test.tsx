// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { FieldRow } from '../../../src/components/design/DimensionFields';
import { FIELDS } from '../../../src/services/design/componentFields';
import { useWorkspaceStore } from '../../../src/state/store';
import { renderWithProviders } from '../../testing/renderWithProviders';
import type { ComponentNode, RocketTree } from '../../../src/engine/openRocketEngine';

/**
 * The fields whose kernel setter clamps them against the rest of the part, or
 * against the part it sits on. Each expected value is the clamp written out
 * from the Java setter named beside it. Lengths are typed in centimeters, the
 * panel's default length unit.
 */

const field = (type: string, key: string) => {
  const f = FIELDS[type]!.find((x) => x.key === key);
  if (!f) throw new Error(`${type} has no ${key} field`);
  return f;
};

/** Type `text` into one field of `node` and return the number it stores. */
const typeInto = (node: Record<string, unknown>, key: string, label: string, text: string): unknown => {
  const onChange = vi.fn();
  renderWithProviders(
    <FieldRow node={node as unknown as ComponentNode} field={field(node['type'] as string, key)} onChange={onChange} />,
  );
  fireEvent.change(screen.getByLabelText(label), { target: { value: text } });
  return (onChange.mock.calls.at(-1)![0] as Record<string, unknown>)[key];
};

describe('a wall is at most the radius it is cut from', () => {
  it.each([
    // SymmetricComponent.setThickness: clamp(t, 0, getMaxRadius()), the outer radius on a tube.
    [{ type: 'bodytube', outerRadius: 0.013, thickness: 0.001 }, 0.013],
    // ThicknessRingComponent.setThickness: clamp(t, 0, getOuterRadius()).
    [{ type: 'tubecoupler', outerRadius: 0.012, thickness: 0.001 }, 0.012],
    [{ type: 'innertube', outerRadius: 0.009, thickness: 0.001 }, 0.009],
    // LaunchLug.setThickness: clamp(t, 0, radius).
    [{ type: 'launchlug', outerRadius: 0.003, thickness: 0.0005 }, 0.003],
    // TubeFinSet.setThickness: clamp(t, 0, getOuterRadius()).
    [{ type: 'tubefinset', outerRadius: 0.01, thickness: 0.001 }, 0.01],
    // SymmetricComponent.setThickness on a nose cone: getMaxRadius() is the base.
    [{ type: 'nosecone', aftRadius: 0.02, thickness: 0.002 }, 0.02],
    // On a transition, the wider of the two ends.
    [{ type: 'transition', foreRadius: 0.02, aftRadius: 0.03, thickness: 0.002 }, 0.03],
  ])('%o', (node, max) => {
    expect(typeInto(node, 'thickness', 'Thickness', '9')).toBeCloseTo(max, 12);
  });

  it('leaves a fin wall alone: a fin has no radius to clamp it to', () => {
    expect(typeInto({ type: 'trapezoidfinset', thickness: 0.003 }, 'thickness', 'Thickness', '9')).toBeCloseTo(
      0.09,
      12,
    );
  });
});

describe('a shoulder is at most the end it plugs into', () => {
  it('nose cone: NoseCone.setShoulderRadius clamps to the base', () => {
    const nose = { type: 'nosecone', aftRadius: 0.02, shoulderRadius: 0.019 };
    expect(typeInto(nose, 'shoulderRadius', 'Shoulder diameter', '9')).toBeCloseTo(0.02, 12);
  });

  it('transition: Transition.setForeShoulderRadius clamps to the fore radius', () => {
    const t = { type: 'transition', foreRadius: 0.02, aftRadius: 0.03, foreShoulderRadius: 0.019 };
    expect(typeInto(t, 'foreShoulderRadius', 'Fore shoulder diameter', '9')).toBeCloseTo(0.02, 12);
  });

  it('transition: Transition.setAftShoulderRadius clamps to the aft radius', () => {
    const t = { type: 'transition', foreRadius: 0.02, aftRadius: 0.03, aftShoulderRadius: 0.029 };
    expect(typeInto(t, 'aftShoulderRadius', 'Aft shoulder diameter', '9')).toBeCloseTo(0.03, 12);
  });
});

describe('a fin tab is at most as deep as the body it goes into', () => {
  it('FinSet.setTabHeight clamps to getMaxTabHeight(), the body tube radius', () => {
    const fin = {
      id: 'fin',
      type: 'trapezoidfinset',
      finCount: 3,
      rootChord: 0.05,
      tipChord: 0.03,
      height: 0.04,
      tabLength: 0.02,
      tabHeight: 0.005,
    };
    useWorkspaceStore.setState({
      tree: {
        name: 'R',
        components: [
          {
            id: 'st',
            type: 'stage',
            children: [
              { id: 'tube', type: 'bodytube', length: 0.3, outerRadius: 0.012, thickness: 0.001, children: [fin] },
            ],
          },
        ],
      } as unknown as RocketTree,
    });
    expect(typeInto(fin, 'tabHeight', 'Fin tab height', '5')).toBeCloseTo(0.012, 12);
  });
});
