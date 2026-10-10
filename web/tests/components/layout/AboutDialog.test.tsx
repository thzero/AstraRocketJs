// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../testing/renderWithProviders';
import { UPSTREAM } from '../../../src/services/app/appInfo';
import { AboutDialog } from '../../../src/components/layout/AboutDialog';

// The contributors file stands in for the served catalog; fetchCatalog's shape
// check runs against it exactly as the real loader does.
let contributorsFile: unknown = { contributors: [] };
vi.mock('../../../src/services/app/remoteData', () => ({
  fetchCatalog: (_name: string, valid?: (v: unknown) => boolean) =>
    !valid || valid(contributorsFile) ? Promise.resolve(contributorsFile) : Promise.reject(new Error('shape')),
}));
beforeEach(() => {
  contributorsFile = { contributors: [] };
});

/**
 * About's answer to "which OpenRocket is this?".
 *
 * The dialog is where a reader who wants to compare a number against the
 * desktop app, or to ask whether a feature from some release is in here, finds
 * the commit. The value is injected from engine-java/extract/UPSTREAM at build
 * time (a stand-in under Vitest, see vitest.config.ts), so what is worth
 * holding still is that it reaches the dialog: the line is an i18n string with
 * an interpolated link in it, and a mistyped placeholder or a renamed component
 * key renders the sentence with the commit missing and nothing else wrong.
 */
describe('AboutDialog', () => {
  it('names the pinned OpenRocket commit and links to it', () => {
    renderWithProviders(<AboutDialog onClose={() => {}} />);
    const link = screen.getByRole('link', { name: UPSTREAM.shortRef });
    expect(link.getAttribute('href')).toBe(UPSTREAM.commitUrl);
  });

  it('dates the commit beside it', () => {
    renderWithProviders(<AboutDialog onClose={() => {}} />);
    expect(document.body.textContent).toContain(UPSTREAM.date);
  });
});

describe('AboutDialog contributors', () => {
  it('links a contributor whose url is https', async () => {
    contributorsFile = { contributors: [{ login: 'octo', url: 'https://github.com/octo' }] };
    renderWithProviders(<AboutDialog onClose={() => {}} />);
    const link = await screen.findByRole('link', { name: /octo/ });
    expect(link.getAttribute('href')).toBe('https://github.com/octo');
  });

  it('draws no link from a contributors file carrying a non-https url', async () => {
    contributorsFile = {
      contributors: [
        { login: 'octo', url: 'https://github.com/octo' },
        { login: 'evil', url: 'javascript:alert(1)' },
      ],
    };
    renderWithProviders(<AboutDialog onClose={() => {}} />);
    await waitFor(() => expect(document.body.textContent).toContain(UPSTREAM.date));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole('link', { name: /evil/ })).toBeNull();
    for (const a of document.querySelectorAll('a')) expect(a.getAttribute('href') ?? '').not.toMatch(/^javascript:/i);
  });

  it('keeps the decorative rocket out of the accessible name', () => {
    renderWithProviders(<AboutDialog onClose={() => {}} />);
    const rocket = [...document.querySelectorAll('span')].find((s) => s.textContent === '🚀');
    expect(rocket?.getAttribute('aria-hidden')).toBe('true');
  });
});
