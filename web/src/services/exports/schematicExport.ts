import type { StaticInfo } from '../../engine/openRocketEngine';
import { siToUi, type UnitSelection } from '../../prefs/units.js';
import { appName } from '../app/appInfo.js';
import { escapeXml } from '../files/xmlUtil.js';
import { KeyedError } from '../../i18n/keyedError';
import { fmtList, fmtNum, fmtUpTo, ladderDigits, withUnit } from '../../i18n/format';
import { staticInfoRows } from '../report/designInfo';

/**
 * 2D/3D image export with a data header, the drawings an L3 / Tripoli
 * Class 3 certification packet includes. The SVG is true scale (its
 * width/height are physical millimeters, so it prints 1:1 and still scales
 * freely on screen); raster output is PNG or JPEG.
 */

export interface ExportData {
  name: string;
  info: StaticInfo | null;
  units: UnitSelection;
  /** Full span diameter incl. fins/pods (m), from the 2D view's measure. */
  spanM?: number;
  withMotors: boolean;
  appVersion: string;
  /** The UI's translator: the header is written in the language the user reads. */
  t: (key: string, options?: Record<string, unknown>) => string;
}

/** RockSim-style header block: the numbers a cert reviewer wants on the page. */
export function dataHeaderLines(d: ExportData): string[] {
  const { t, units: u } = d;
  // In the UI language's number format, as the margin beside them is.
  const length = (si: number) => withUnit(fmtUpTo(siToUi('length', u.length, si), 3), u.length);
  const mass = (si: number) => {
    const v = siToUi('mass', u.mass, si);
    return withUnit(fmtNum(v, ladderDigits(v)), u.mass);
  };
  const lines: string[] = [d.name];
  if (d.info) {
    const i = d.info;
    const dims = [
      t('export.headerLength', { value: length(i.length) }),
      t('export.headerMaxDiameter', { value: length(i.refDiameter) }),
      ...(d.spanM ? [t('export.headerSpan', { value: length(d.spanM) })] : []),
    ];
    lines.push(fmtList(dims));
    lines.push(
      d.withMotors
        ? t('export.headerLaunchMass', { mass: mass(i.mass), dry: mass(i.massEmpty) })
        : t('export.headerDryMass', { dry: mass(i.massEmpty) }),
    );
    // CP and margin only when the design has them, by the same test as every
    // other design-info table: with no normal force there is no CP to state.
    const hasCp = staticInfoRows(i).some((r) => r.key === 'cp');
    lines.push(
      hasCp
        ? t('export.headerBalance', { cg: length(i.cg), cp: length(i.cp), margin: fmtNum(i.stabilityCalibers, 2) })
        : t('export.headerCg', { cg: length(i.cg) }),
    );
  }
  lines.push(`${appName()} v${d.appVersion}, ${new Date().toISOString().slice(0, 10)}`);
  return lines;
}

/** Light-theme values for the CSS variables the schematic markup uses
 *  (--accent = the selection outline when a component is selected;
 *  --status-* = the CP/stability-margin callout inks;
 *  --launch = the loaded-motor case tint). */
const EXPORT_VARS: [string, string][] = [
  ['var(--surface-1)', '#ffffff'],
  ['var(--text-primary)', '#20242c'],
  ['var(--accent)', '#b8511d'],
  ['var(--launch)', '#c65420'],
  ['var(--status-good)', '#008300'],
  ['var(--status-warn)', '#a06b00'],
  ['var(--status-serious)', '#e34948'],
];

/**
 * The print colors of the schematic's own tokens (`var(--c-sch-*)`, index.css).
 * A downloaded SVG has no stylesheet to resolve a variable against, and a page
 * prints on white whatever theme the screen is in, so each token has a print
 * value of its own here rather than whatever it reads on screen.
 */
export const PRINT_COLORS: Record<string, string> = {
  'sch-line': '#7a786f',
  'sch-part': '#b9b7b0',
  'sch-part-light': '#c8c5be',
  'sch-shell': '#d5d2cb',
  'sch-shell-light': '#e7e5e0',
  'sch-ink': '#9a978f',
  'sch-label': '#ffffff',
  'sch-motor': '#8b5a2b',
  'sch-motor-edge': '#6b4520',
  'sch-motor-outline': '#e0764a',
  'sch-shoulder': '#4f8fa0',
  'sch-hatch': '#66748c',
  'sch-parachute': '#b06a35',
  'sch-streamer': '#a08c2e',
  'sch-shockcord': '#8f7a8d',
  'sch-masscomponent': '#a85f5c',
  'sch-centeringring': '#6f8a5c',
  'sch-bulkhead': '#66748c',
  'sch-engineblock': '#7d7050',
  'sch-tubecoupler': '#7f6ea8',
  'sch-innertube': '#3f8f6f',
};

/**
 * Every `var(--c-*)` in the markup as a plain color: its print value when it
 * has one, else what it reads on screen now, so no variable reaches the file.
 */
export function bakeTokens(markup: string): string {
  const root = typeof document === 'undefined' ? null : getComputedStyle(document.documentElement);
  return markup.replace(/var\(--c-([\w-]+)\)/g, (_whole, name: string) => {
    return PRINT_COLORS[name] ?? (root?.getPropertyValue(`--c-${name}`).trim() || '#000000');
  });
}

/**
 * Standalone SVG from the live schematic <svg>: identity view transform,
 * CSS variables baked to light-theme values, white background, data header
 * on top, physical size in mm so it prints at 100 % scale.
 *
 * @param svgEl      the live schematic svg element
 * @param pxPerM     the drawing's scale (viewBox px per meter)
 * @param viewW/viewH the drawing's viewBox size
 */
export function schematicSvg(
  svgEl: SVGSVGElement,
  pxPerM: number,
  viewW: number,
  viewH: number,
  d: ExportData,
): string {
  const clone = svgEl.cloneNode(true) as SVGSVGElement;
  // Identity view: exports always show the whole rocket, whatever the
  // on-screen zoom/pan state.
  const zoomG = clone.querySelector(':scope > g');
  zoomG?.setAttribute('transform', 'translate(0 0) scale(1)');

  let inner = new XMLSerializer().serializeToString(clone);
  // The wrapper svg re-declares size/viewBox; keep only the content.
  inner = inner.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  for (const [v, val] of EXPORT_VARS) {
    inner = inner.split(v).join(val);
  }
  inner = bakeTokens(inner);

  // Header band: proportional to drawing width so it stays readable at any
  // physical size (a 4 m rocket printed 1:1 gets 4 m of banner).
  const fs = Math.max(11, Math.round(viewW * 0.016));
  const lineH = Math.round(fs * 1.45);
  const lines = dataHeaderLines(d);
  const headerH = lineH * (lines.length + 1);
  const totalH = viewH + headerH;

  const mm = (px: number) => (px / pxPerM) * 1000;
  const header = lines
    .map(
      (l, i) =>
        `<text x="${Math.round(fs * 0.8)}" y="${lineH * (i + 1)}" font-size="${i === 0 ? Math.round(fs * 1.25) : fs}"` +
        `${i === 0 ? ' font-weight="bold"' : ''}>${escapeXml(l)}</text>`,
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewW} ${totalH}"
  width="${mm(viewW).toFixed(2)}mm" height="${mm(totalH).toFixed(2)}mm"
  font-family="Arial, Helvetica, sans-serif" fill="#20242c">
  <rect x="0" y="0" width="${viewW}" height="${totalH}" fill="#ffffff"/>
  <g>${header}</g>
  <g transform="translate(0 ${headerH})">${inner}</g>
</svg>`;
}

/** Raster formats for the image exports. Both encode from the same
 *  white-composited canvas, so JPEG's missing alpha never shows. */
export type ImageFormat = 'png' | 'jpeg';
export const IMAGE_FORMAT_EXT: Record<ImageFormat, string> = { png: 'png', jpeg: 'jpg' };
/** Width presets for the resolution picker. */
export const IMAGE_WIDTHS = [1920, 3840, 7680] as const;
const JPEG_QUALITY = 0.92;

const encodeCanvas = (canvas: HTMLCanvasElement, format: ImageFormat): Promise<Blob> =>
  new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new KeyedError('errors.export.imageEncode'))),
      `image/${format}`,
      format === 'jpeg' ? JPEG_QUALITY : undefined,
    );
  });

/**
 * Rasterize an SVG string at the given pixel width.
 *
 * A canvas past the browser's size limit (Safari stops near 16.7 Mpx, and the
 * widest preset on a short, wide-finned rocket passes it) has no 2D context, and
 * a browser may also throw while allocating it. Either way the promise rejects
 * with a keyed error the caller shows, and the object URL is released on every
 * path.
 */
export function svgToImage(svgString: string, widthPx = 3840, format: ImageFormat = 'png'): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([svgString], { type: 'image/svg+xml' }));
    const img = new Image();
    img.onload = () => {
      try {
        const ratio = img.naturalHeight / Math.max(1, img.naturalWidth);
        const canvas = document.createElement('canvas');
        canvas.width = widthPx;
        canvas.height = Math.round(widthPx * ratio);
        const c = canvas.getContext('2d');
        if (!c) {
          reject(new KeyedError('errors.export.imageTooLarge'));
          return;
        }
        c.fillStyle = '#ffffff';
        c.fillRect(0, 0, canvas.width, canvas.height);
        c.drawImage(img, 0, 0, canvas.width, canvas.height);
        encodeCanvas(canvas, format).then(resolve, reject);
      } catch {
        reject(new KeyedError('errors.export.imageTooLarge'));
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new KeyedError('errors.export.svgRasterize'));
    };
    img.src = url;
  });
}

/**
 * Compose a 3D-view snapshot with the data header band above it.
 * `glCanvas` is any canvas holding the rendered frame at export size: the
 * offscreen 2D canvas the render-target capture produces, or, on the
 * fallback path, the live WebGL canvas (which then needs
 * preserveDrawingBuffer for drawImage to see the frame). A composed canvas past
 * the browser's size limit rejects with the same keyed error `svgToImage` gives.
 */
export function snapshotWithHeader(
  glCanvas: HTMLCanvasElement,
  d: ExportData,
  format: ImageFormat = 'png',
): Promise<Blob> {
  const w = glCanvas.width;
  const fs = Math.max(12, Math.round(w * 0.016));
  const lineH = Math.round(fs * 1.45);
  const lines = dataHeaderLines(d);
  const headerH = lineH * (lines.length + 1);

  const canvas = document.createElement('canvas');
  let c: CanvasRenderingContext2D | null;
  try {
    canvas.width = w;
    canvas.height = headerH + glCanvas.height;
    c = canvas.getContext('2d');
  } catch {
    c = null;
  }
  if (!c) return Promise.reject(new KeyedError('errors.export.imageTooLarge'));
  c.fillStyle = '#ffffff';
  c.fillRect(0, 0, canvas.width, canvas.height);
  c.fillStyle = '#20242c';
  lines.forEach((l, i) => {
    c.font = `${i === 0 ? 'bold ' : ''}${i === 0 ? Math.round(fs * 1.25) : fs}px Arial, Helvetica, sans-serif`;
    c.fillText(l, Math.round(fs * 0.8), lineH * (i + 1));
  });
  c.drawImage(glCanvas, 0, headerH);
  return encodeCanvas(canvas, format);
}

/** The MIME type a schematic SVG string is served under. */
export const SVG_MIME = 'image/svg+xml';
