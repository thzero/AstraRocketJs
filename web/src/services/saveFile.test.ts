// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { saveBlob, safeFilename } from './saveFile';

// The share sheet is used ONLY where `<a download>` is known to fail: iOS or
// iPadOS running the app as an installed PWA. Everywhere else the anchor wins,
// because it puts the file straight in the downloads folder with no extra tap.

const clicks: { download: string; href: string }[] = [];

function trackAnchorClicks() {
  clicks.length = 0;
  const realCreate = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
    const el = realCreate(tag) as HTMLElement;
    if (tag === 'a') {
      el.click = () =>
        clicks.push({ download: (el as HTMLAnchorElement).download, href: (el as HTMLAnchorElement).href });
    }
    return el;
  });
}

/** Pose as a platform: apple = iOS/iPadOS, standalone = installed PWA. */
function pose({ apple, standalone, canShare = true }: { apple: boolean; standalone: boolean; canShare?: boolean }) {
  vi.stubGlobal('navigator', {
    userAgent: apple ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' : 'Mozilla/5.0 (Windows NT 10.0)',
    platform: apple ? 'iPhone' : 'Win32',
    maxTouchPoints: apple ? 5 : 0,
    standalone,
    canShare: vi.fn(() => canShare),
    share: vi.fn(() => Promise.resolve()),
  });
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: standalone })),
  );
  return navigator as unknown as { canShare: ReturnType<typeof vi.fn>; share: ReturnType<typeof vi.fn> };
}

beforeEach(() => {
  vi.stubGlobal('URL', { ...URL, createObjectURL: () => 'blob:x', revokeObjectURL: () => {} });
  trackAnchorClicks();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const blob = () => new Blob(['<xml/>'], { type: 'application/xml' });

describe('saveBlob', () => {
  it('downloads via an anchor on desktop', async () => {
    const nav = pose({ apple: false, standalone: false });
    await saveBlob(blob(), 'rocket.ork');
    expect(clicks).toHaveLength(1);
    expect(clicks[0]!.download).toBe('rocket.ork');
    expect(nav.share).not.toHaveBeenCalled();
  });

  it('downloads via an anchor on iOS in a browser TAB', async () => {
    // Not installed → the anchor works, so do not hijack it with a share sheet.
    const nav = pose({ apple: true, standalone: false });
    await saveBlob(blob(), 'rocket.ork');
    expect(clicks).toHaveLength(1);
    expect(nav.share).not.toHaveBeenCalled();
  });

  it('shares on iOS INSTALLED, where the anchor silently does nothing', async () => {
    const nav = pose({ apple: true, standalone: true });
    await saveBlob(blob(), 'rocket.ork');
    expect(nav.share).toHaveBeenCalledOnce();
    expect(clicks).toHaveLength(0);
    const shared = nav.share.mock.calls[0]![0] as { files: File[] };
    expect(shared.files[0]!.name).toBe('rocket.ork');
  });

  it('downloads via an anchor on an installed NON-Apple PWA', async () => {
    const nav = pose({ apple: false, standalone: true });
    await saveBlob(blob(), 'rocket.ork');
    expect(clicks).toHaveLength(1);
    expect(nav.share).not.toHaveBeenCalled();
  });

  it('falls back to the anchor when files cannot be shared', async () => {
    const nav = pose({ apple: true, standalone: true, canShare: false });
    await saveBlob(blob(), 'rocket.ork');
    expect(nav.share).not.toHaveBeenCalled();
    expect(clicks).toHaveLength(1); // better a probably-dead anchor than nothing
  });

  it('does NOT re-download when the user cancels the share sheet', async () => {
    const nav = pose({ apple: true, standalone: true });
    nav.share.mockRejectedValueOnce(new DOMException('cancelled', 'AbortError'));
    await saveBlob(blob(), 'rocket.ork');
    // Cancelling is a decision, not a failure — a surprise download would ignore it.
    expect(clicks).toHaveLength(0);
  });

  it('falls back to the anchor when sharing genuinely fails', async () => {
    const nav = pose({ apple: true, standalone: true });
    nav.share.mockRejectedValueOnce(new Error('share transport died'));
    await saveBlob(blob(), 'rocket.ork');
    expect(clicks).toHaveLength(1);
  });

  it('never rejects, so an export button cannot throw at the user', async () => {
    const nav = pose({ apple: true, standalone: true });
    nav.canShare.mockImplementation(() => {
      throw new Error('canShare exploded');
    });
    await expect(saveBlob(blob(), 'rocket.ork')).resolves.toBeUndefined();
  });
});

describe('safeFilename', () => {
  it('strips characters a filesystem will not take', () => {
    expect(safeFilename('My Rocket: v2/final')).toBe('My_Rocket_v2_final');
  });

  it('falls back when a name reduces to nothing', () => {
    expect(safeFilename('///')).toBe('rocket');
    expect(safeFilename('')).toBe('rocket');
  });
});
