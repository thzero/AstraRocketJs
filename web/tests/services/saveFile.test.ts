// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { download, exportFilename, saveBlob, safeFilename } from '../../src/services/saveFile';

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
    nav.share.mockRejectedValueOnce(new DOMException('canceled', 'AbortError'));
    await saveBlob(blob(), 'rocket.ork');
    // Canceling is a decision, not a failure — a surprise download would ignore it.
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
    // "///" sanitizes to "_", which is truthy but a useless filename — the
    // trap that two of the three deleted copies fell into.
    expect(safeFilename('///')).toBe('rocket');
    expect(safeFilename('')).toBe('rocket');
  });

  it("takes the caller's own fallback", () => {
    // The part exporter wants "part", the flight-path exporter "flight".
    expect(safeFilename('My Fin!', 'part')).toBe('My_Fin_');
    expect(safeFilename('', 'part')).toBe('part');
    expect(safeFilename('!!!', 'flight')).toBe('flight');
  });

  it('keeps dots, so an extension a caller already added survives', () => {
    expect(safeFilename('v1.2 draft')).toBe('v1.2_draft');
  });
});

/** `download` is fire-and-forget, so let its inner save settle. */
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('download', () => {
  /**
   * There were three of these, one per module, disagreeing about argument
   * order — `downloadText(filename, text, mime)`, `downloadBlob(blob,
   * filename)`, `downloadFile(data, filename, mime)`. Two put the filename
   * where the third put the payload, and because a text payload is also a
   * `string` the compiler accepted either: importing the wrong one downloaded
   * a file NAMED after its own contents. One signature now, filename first,
   * pinned here.
   */
  it('takes the filename first and the payload second', async () => {
    pose({ apple: false, standalone: false });
    download('aero-table.csv', 'Mach,Cd\r\n0.05,0.41\r\n', 'text/csv;charset=utf-8');
    await flush();
    expect(clicks).toHaveLength(1);
    expect(clicks[0]!.download).toBe('aero-table.csv');
  });

  it('passes a Blob straight through instead of re-wrapping it', async () => {
    // The image exporters hand it an already-typed Blob; re-wrapping would
    // replace its MIME type with the text default.
    pose({ apple: false, standalone: false });
    download('rocket-3d.png', new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }));
    await flush();
    expect(clicks).toHaveLength(1);
    expect(clicks[0]!.download).toBe('rocket-3d.png');
  });
});

/**
 * The one naming rule every export follows. It exists because a downloads
 * folder is flat and shared: a file has to say which rocket it came from, and
 * a second design must not overwrite the first.
 */
describe('exportFilename', () => {
  it('adds what the file IS for a rocket-level export, design documents included', () => {
    expect(exportFilename(['Big Bertha', 'design'], 'ork')).toBe('Big_Bertha-design.ork');
    expect(exportFilename(['Big Bertha', 'aero-table'], 'csv')).toBe('Big_Bertha-aero-table.csv');
    expect(exportFilename(['Big Bertha', 'report'], 'pdf')).toBe('Big_Bertha-report.pdf');
  });

  it('puts rocket, then run, then kind for a simulation export', () => {
    expect(exportFilename(['Big Bertha', 'C6 flight', 'flight-events'], 'csv')).toBe(
      'Big_Bertha-C6_flight-flight-events.csv',
    );
  });

  it('puts rocket then component for a printable part', () => {
    expect(exportFilename(['Big Bertha', 'Nose cone'], 'stl')).toBe('Big_Bertha-Nose_cone.stl');
  });

  it('drops empty parts rather than leaving a double separator', () => {
    // A caller can pass an optional part without guarding it - an unnamed
    // stage, a sim with no name yet.
    expect(exportFilename(['Bertha', '', undefined, 'flight-data'], 'csv')).toBe('Bertha-flight-data.csv');
    expect(exportFilename([null, 'Bertha', 'design'], 'ork')).toBe('Bertha-design.ork');
  });

  it('drops a part that survives cleaning as separators only', () => {
    // safeFilename turns "///" into "_", which is truthy but says nothing.
    expect(exportFilename(['///', 'report'], 'pdf')).toBe('report.pdf');
  });

  it('falls back when nothing usable is left, rather than naming a file ".csv"', () => {
    expect(exportFilename(['', '///'], 'csv')).toBe('rocket.csv');
    expect(exportFilename([], 'kml', 'flight')).toBe('flight.kml');
  });
});
