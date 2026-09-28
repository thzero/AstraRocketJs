// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../testing/renderWithProviders';
import { UPSTREAM } from '../../../src/services/appInfo';
import { AboutDialog } from '../../../src/components/layout/AboutDialog';

/**
 * About's answer to "which OpenRocket is this?".
 *
 * The dialog is where a reader who wants to compare a number against the
 * desktop app, or to ask whether a feature from some release is in here, finds
 * the commit. The value is injected from engine-java/extract/UPSTREAM at build
 * time (a stand-in under Vitest, see vitest.config.ts), so what is worth
 * holding still is that it REACHES the dialog: the line is an i18n string with
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
