import type { Dispatch, RefObject, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import {
  SVG_MIME,
  IMAGE_FORMAT_EXT,
  schematicSvg,
  svgToImage,
  type ExportData,
} from '../../services/exports/schematicExport.js';
import { download, exportFilename } from '../../services/files/saveFile.js';
import { ImageExportMenu } from './ImageExportMenu.js';
import type { ZoomState } from '../../tree/schematicGeometry';
import { ZoomButtons } from './ZoomButtons';
import { errorText } from '../../i18n/keyedError';
import { token } from '../common/colorTokens';

/**
 * The TreeSchematic control strip: SVG / image export, the two caliper
 * toggles, and the shared zoom buttons (`ZoomButtons`). The schematic decides where the
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
                  exportFilename([data.name, '2d'], 'svg'),
                  schematicSvg(svgRef.current, scale, w, h, data),
                  SVG_MIME,
                );
              } catch (e) {
                onError?.(t('export.svgFailed', { message: errorText(e, t) }));
              }
            }}
          >
            <span aria-hidden>⬇</span> SVG
          </button>
          <ImageExportMenu
            icon="⬇"
            label={t('export.image')}
            title={t('export.imageTitle2d')}
            onPick={async (format, widthPx) => {
              if (!svgRef.current) return;
              try {
                const data = { ...exportData, spanM: 2 * vHalf };
                const svg = schematicSvg(svgRef.current, scale, w, h, data);
                download(
                  exportFilename([data.name, '2d'], IMAGE_FORMAT_EXT[format]),
                  await svgToImage(svg, widthPx, format),
                );
              } catch (e) {
                onError?.(t('export.imageFailed', { message: errorText(e, t) }));
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
        style={caliperH ? { background: 'var(--accent)', color: token('on-accent') } : undefined}
        onClick={() => setCaliperH((c) => (c ? null : { a: totalLen * 0.2, b: totalLen * 0.8 }))}
      >
        ⟺
      </button>
      <button
        className="file-btn"
        title={t('schematic.calipersV')}
        aria-label={t('schematic.calipersV')}
        aria-pressed={!!caliperV}
        style={caliperV ? { background: 'var(--accent)', color: token('on-accent') } : undefined}
        onClick={() => setCaliperV((c) => (c ? null : { a: maxR, b: -maxR }))}
      >
        ⇕
      </button>
      <ZoomButtons zoom={zoom} setZoom={setZoom} zoomBy={zoomBy} />
    </>
  );
}
