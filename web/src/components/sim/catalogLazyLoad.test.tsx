// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderWithProviders } from '../../testing/renderWithProviders';

/**
 * The motor catalog is a ~1.6 MB runtime download, and both dialogs that need
 * it say in their own comments that it is fetched lazily: "fetched only when
 * something first needs it", "the first open pays a fetch".
 *
 * Neither was. Both components are mounted unconditionally (`AppHeader` mounts
 * MotorDashboard, every `MotorRow` mounts a MotorDialog) and only `return
 * null` when closed, which does not stop an effect from running. The load
 * effect was keyed on `[attempt]` with no `open` guard, so the catalog was
 * fetched on app start. `fetchCatalog` memoizes, so it was one download rather
 * than many, but it was an unconditional 1.6 MB on first paint - on a phone at
 * a launch site, exactly what the deferral exists to avoid.
 */

const loadCatalog = vi.fn(() => Promise.resolve([]));
vi.mock('../../services/motorDb', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  loadCatalog: () => loadCatalog(),
}));

const { MotorDashboard } = await import('./MotorDashboard');
const { MotorDialog } = await import('./MotorDialog');

describe('the 1.6 MB motor catalog is only fetched when a dialog opens', () => {
  beforeEach(() => loadCatalog.mockClear());

  it('MotorDashboard does not fetch while closed', () => {
    renderWithProviders(<MotorDashboard open={false} onClose={() => {}} />);
    expect(loadCatalog).not.toHaveBeenCalled();
  });

  it('MotorDashboard fetches once it is opened', () => {
    renderWithProviders(<MotorDashboard open onClose={() => {}} />);
    expect(loadCatalog).toHaveBeenCalled();
  });

  it('MotorDialog does not fetch while closed', () => {
    renderWithProviders(
      <MotorDialog open={false} onClose={() => {}} onSelect={() => {}} onError={() => {}} mountDiameter={0.018} />,
    );
    expect(loadCatalog).not.toHaveBeenCalled();
  });

  it('MotorDialog fetches once it is opened', () => {
    renderWithProviders(
      <MotorDialog open onClose={() => {}} onSelect={() => {}} onError={() => {}} mountDiameter={0.018} />,
    );
    expect(loadCatalog).toHaveBeenCalled();
  });
});
