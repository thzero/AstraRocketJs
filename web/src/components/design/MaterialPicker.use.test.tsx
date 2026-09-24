// @vitest-environment jsdom
import { beforeAll, describe, it, expect } from 'vitest';
import { cleanup, waitFor } from '@testing-library/react';
import { serveData } from '../../testing/serveData';
import { MaterialPicker } from './MaterialPicker';
import { renderWithProviders } from '../../testing/renderWithProviders';
import { addCustom } from '../../services/materials';
import { ADHESIVE_GROUP } from '../../services/materialTypes';

/**
 * Which materials a component is offered.
 *
 * Only ONE group is filtered, and only in one direction. Every upstream bulk
 * material is something a part can legitimately be made of — people build fins
 * from aluminum and nose cones from printed PLA — so guessing which suit which
 * component would block real builds to save a little scrolling, and OpenRocket
 * does not do it either.
 *
 * Adhesives are the exception, and they cut both ways: nothing is built out of
 * glue, and a fin fillet is made of nothing else. So a structural part's list
 * has no adhesives in it and a fillet's list has only adhesives. A bead of
 * something unusual is not shut out by that — a thickened mix or a putty is a
 * custom material, and the add form asks which group it goes in.
 */

/**
 * The material select, not the unit chip beside it: with a material chosen the
 * header renders a UnitChip, which is a second combobox, so `getByRole` alone
 * is ambiguous exactly when a part HAS a material.
 */
const materialSelect = () =>
  [...document.querySelectorAll('select')].find((s) => s.querySelector('optgroup')) as HTMLSelectElement | undefined;

const groupsOf = async () => {
  await waitFor(() => {
    if (!materialSelect()) throw new Error('not loaded');
  });
  return [...materialSelect()!.querySelectorAll('optgroup')].map((g) => g.getAttribute('label'));
};

const optionNames = () =>
  [...(materialSelect()?.querySelectorAll('option') ?? [])].map((o) => (o.textContent ?? '').split(' · ')[0]!.trim());

describe('MaterialPicker, by use', () => {
  // The catalog is a runtime file now, so the picker fetches it; serve the real
  // one off disk rather than a fixture, since which materials are adhesives is
  // exactly what is under test.
  beforeAll(serveData);

  it('leaves the adhesives out of a structural part', async () => {
    renderWithProviders(<MaterialPicker value={undefined} onChange={() => {}} />);
    expect(await groupsOf()).not.toContain(ADHESIVE_GROUP);
    expect(optionNames().some((n) => n.startsWith('Epoxy -'))).toBe(false);
    // and still offers what a part IS made of
    expect(optionNames()).toContain('Plywood (birch)');
  });

  it('offers a fillet the adhesives and nothing else', async () => {
    renderWithProviders(<MaterialPicker value={undefined} onChange={() => {}} use="fillet" />);
    expect(await groupsOf()).toEqual([ADHESIVE_GROUP]);
    expect(optionNames()).toContain('Epoxy - RocketPoxy G5000');
    expect(optionNames()).not.toContain('Plywood (birch)');
    expect(optionNames()).not.toContain('Aluminum');
  });

  it('still shows a non-adhesive a fillet already uses', async () => {
    // The mirror of the structural case: an imported design can name anything,
    // and the row has to keep saying what the bead is.
    renderWithProviders(<MaterialPicker value="Plywood (birch)" onChange={() => {}} use="fillet" />);
    await waitFor(() => expect(optionNames()).toContain('Plywood (birch)'));
    expect(materialSelect()!.value).toBe('Plywood (birch)');
  });

  it('still shows a material the part already uses, even when it would be filtered', async () => {
    // A `.ork` can name an epoxy on a body tube. Dropping it from the list
    // would leave the select with no option for the value it holds, which reads
    // as "no material": the design described wrongly by the control meant
    // to describe it.
    renderWithProviders(<MaterialPicker value="Epoxy - RocketPoxy G5000" onChange={() => {}} />);
    await waitFor(() => expect(optionNames()).toContain('Epoxy - RocketPoxy G5000'));
    expect(materialSelect()!.value).toBe('Epoxy - RocketPoxy G5000');
  });

  it('shows a custom material filed under Adhesives on a fillet, not on a tube', async () => {
    await addCustom('My thickened mix', 'bulk', 1050, ADHESIVE_GROUP);

    renderWithProviders(<MaterialPicker value={undefined} onChange={() => {}} use="fillet" />);
    await waitFor(() => expect(optionNames()).toContain('★ My thickened mix'));
    cleanup();

    renderWithProviders(<MaterialPicker value={undefined} onChange={() => {}} />);
    await groupsOf();
    expect(optionNames()).not.toContain('★ My thickened mix');
  });
});
