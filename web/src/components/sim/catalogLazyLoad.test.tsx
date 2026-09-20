// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderWithProviders } from '../../testing/renderWithProviders';

/**
 * The motor catalog is a ~1.6 MB runtime download, and both dialogs that need
 * it say in their own comments that it is fetched lazily: "fetched only when
 * something first needs it", "the first open pays a fetch".
 *
 * Neither was. Both components were mounted unconditionally (`AppHeader`
 * mounted MotorDashboard, every `MotorRow` mounted a MotorDialog) and only
 * `return null` when closed, which does not stop an effect from running, so
 * the catalog was fetched on app start. `fetchCatalog` memoizes, so it was one
 * download rather than many, but it was an unconditional 1.6 MB on first
 * paint - on a phone at a launch site, exactly what the deferral exists to
 * avoid.
 *
 * The deferral is now the mounting convention itself: a dialog is mounted
 * only while open (`{open && <Dialog />}`) and loads on mount. These tests
 * pin both halves: nothing is fetched while a dialog is closed, and one
 * opening pays exactly one fetch.
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
    const open = false;
    renderWithProviders(<>{open && <MotorDashboard onClose={() => {}} />}</>);
    expect(loadCatalog).not.toHaveBeenCalled();
  });

  it('MotorDashboard fetches once it is opened', () => {
    renderWithProviders(<MotorDashboard onClose={() => {}} />);
    expect(loadCatalog).toHaveBeenCalledTimes(1);
  });

  it('MotorDialog does not fetch while closed', () => {
    const open = false;
    renderWithProviders(
      <>{open && <MotorDialog onClose={() => {}} onSelect={() => {}} onError={() => {}} mountDiameter={18} />}</>,
    );
    expect(loadCatalog).not.toHaveBeenCalled();
  });

  it('MotorDialog fetches once it is opened', () => {
    // 18 mm: the prop is the mount bore in millimeters, as MotorRow passes it.
    renderWithProviders(<MotorDialog onClose={() => {}} onSelect={() => {}} onError={() => {}} mountDiameter={18} />);
    expect(loadCatalog).toHaveBeenCalledTimes(1);
  });
});
