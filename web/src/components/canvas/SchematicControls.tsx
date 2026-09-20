import type { Dispatch, RefObject, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import {
  SVG_MIME,
  IMAGE_FORMAT_EXT,
  schematicSvg,
  svgToImage,
  type ExportData,
} from '../../services/schematicExport.js';
import { download, safeFilename } from '../../services/saveFile.js';
import { ImageExportMenu } from './ImageExportMenu.js';
import { ZOOM_IDENTITY, type ZoomState } from './schematicGeometry';

/**
 * The TreeSchematic control strip: SVG / image export, the two caliper
 * toggles, fit-to-view and the zoom steps. The schematic decides WHERE the
 * strip renders (over the drawing or portaled into the pane header) and owns
 * the state the buttons change; this file is the buttons.
 */

/** A caliper's two ends, in model meters. */
type Caliper = { a: number; b: number } | null;

export function SchematicControls({
  svgRef,
  exportData,
  onError,
  scale,
  w,
  h,
  vHalf,
  totalLen,
  maxR,
  caliperH,
  caliperV,
  setCaliperH,
  setCaliperV,
  zoom,
  setZoom,
  zoomBy,
}: {
  /** The drawing the export buttons serialize. Read only inside the click
   *  handlers, never during render. */
  svgRef: RefObject<SVGSVGElement | null>;
  /** When set, the SVG / image export buttons appear. */
  exportData?: Omit<ExportData, 'spanM'>;
  onError?: (message: string) => void;
  scale: number;
  w: number;
  h: number;
  vHalf: number;
  totalLen: number;
  maxR: number;
  caliperH: Caliper;
  caliperV: Caliper;
  setCaliperH: Dispatch<SetStateAction<Caliper>>;
  setCaliperV: Dispatch<SetStateAction<Caliper>>;
  zoom: ZoomState;
  setZoom: Dispatch<SetStateAction<ZoomState>>;
  zoomBy: (f: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      {exportData && (
        <>
          <button
            className="file-btn"
            title={t('export.svgTitle')}
            onClick={() => {
              if (!svgRef.current) return;
              try {
                const data = { ...exportData, spanM: 2 * vHalf };
                download(
                  `${safeFilename(data.name)}-2d.svg`,
                  schematicSvg(svgRef.current, scale, w, h, data),
                  SVG_MIME,
                );
              } catch (e) {
                onError?.(`SVG export failed: ${e instanceof Error ? e.message : String(e)}`);
              }
            }}
          >
            ⬇ SVG
          </button>
          <ImageExportMenu
            label={`⬇ ${t('export.image')}`}
            title={t('export.imageTitle2d')}
            onPick={async (format, widthPx) => {
              if (!svgRef.current) return;
              try {
                const data = { ...exportData, spanM: 2 * vHalf };
                const svg = schematicSvg(svgRef.current, scale, w, h, data);
                download(
                  `${safeFilename(data.name)}-2d.${IMAGE_FORMAT_EXT[format]}`,
                  await svgToImage(svg, widthPx, format),
                );
              } catch (e) {
                onError?.(t('export.imageFailed', { message: e instanceof Error ? e.message : String(e) }));
              }
            }}
          />
        </>
      )}
      <button
        className="file-btn"
        title={t('schematic.calipersH')}
        aria-label={t('schematic.calipersH')}
        aria-pressed={!!caliperH}
        style={caliperH ? { background: 'var(--accent)', color: '#fff' } : undefined}
        onClick={() => setCaliperH((c) => (c ? null : { a: totalLen * 0.2, b: totalLen * 0.8 }))}
      >
        ⟺
      </button>
      <button
        className="file-btn"
        title={t('schematic.calipersV')}
        aria-label={t('schematic.calipersV')}
        aria-pressed={!!caliperV}
        style={caliperV ? { background: 'var(--accent)', color: '#fff' } : undefined}
        onClick={() => setCaliperV((c) => (c ? null : { a: maxR, b: -maxR }))}
      >
        ⇕
      </button>
      {(zoom.k > 1 || zoom.x !== 0 || zoom.y !== 0) && (
        <button className="file-btn" title={t('schematic.fit')} onClick={() => setZoom(ZOOM_IDENTITY)}>
          ⤢ {t('schematic.fit')}
        </button>
      )}
      <button
        className="file-btn"
        title={t('schematic.zoomIn')}
        aria-label={t('schematic.zoomIn')}
        onClick={() => zoomBy(1.5)}
        disabled={zoom.k >= 12}
      >
        +
      </button>
      <button
        className="file-btn"
        title={t('schematic.zoomOut')}
        aria-label={t('schematic.zoomOut')}
        onClick={() => zoomBy(1 / 1.5)}
        disabled={zoom.k <= 1}
      >
        −
      </button>
    </>
  );
}
