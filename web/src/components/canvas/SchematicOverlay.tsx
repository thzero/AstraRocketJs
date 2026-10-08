import { useTranslation } from 'react-i18next';
import type { StaticInfo } from '../../engine/openRocketEngine';
import { useUnits } from '../../prefs/useUnits';
import type { StabilityState } from '../../services/flight/simReport.js';
import {
  calloutLayout,
  hoverTagFor,
  marginText,
  MARKER_R,
  type Ctx,
  type HoverBox,
} from '../../tree/schematicGeometry';
import { token } from '../common/colorTokens';

/**
 * The decoration drawn OVER the TreeSchematic's part outlines, inside the
 * pan/zoom group: the CG/CP station markers with their leader-line callouts
 * and the stability margin text (`StabilityOverlay`), and the accent wash +
 * name tag on the hovered part (`HoverOverlay`). Every group here is
 * `pointerEvents="none"`: the markers sit on the centerline, precisely where
 * you click to select a nose cone or body tube, and an opaque disc with no
 * handler of its own silently ate the click.
 */

const STABILITY_VAR: Record<StabilityState, string> = {
  under: 'var(--status-serious)',
  over: 'var(--status-warn)',
  ok: 'var(--status-good)',
};

export function StabilityOverlay({
  info,
  showMarkers,
  ctx,
  scale,
  vHalf,
  w,
  h,
}: {
  info: StaticInfo | null;
  showMarkers: boolean;
  ctx: Ctx;
  scale: number;
  vHalf: number;
  w: number;
  h: number;
}) {
  const { t } = useTranslation();
  const u = useUnits();
  // When markers are toggled off, null out the stations: this disables the
  // on-axis symbols AND the leader-line callouts (all gated on cgX/cpX below).
  const cgX = info && showMarkers ? ctx.x0 + info.cg * scale : null;
  const cpX = info && showMarkers ? ctx.x0 + info.cp * scale : null;
  // The engine's own percentage, not ours: see StaticInfo.stabilityPercent. A
  // zero-length design has none, so it gets no margin text either.
  const margin = info ? marginText(info.stabilityCalibers, info.stabilityPercent, t) : null;
  const stab = margin?.state ?? null;
  const cgLabel = info ? `${t('schematic.cg')} · ${u.fmtSym('length', info.cg)}` : t('schematic.cg');
  const cpLabel = info ? `${t('schematic.cp')} · ${u.fmtSym('length', info.cp)}` : t('schematic.cp');
  const callouts = calloutLayout(cgX, cpX, ctx.cy, vHalf * scale, w, h, margin?.text ?? null);

  return (
    <>
      {cgX !== null && (
        <g pointerEvents="none">
          <circle
            cx={cgX}
            cy={ctx.cy}
            r={MARKER_R}
            fill="var(--surface-1)"
            stroke="var(--text-primary)"
            strokeWidth="1.5"
          />
          <path
            d={`M ${cgX} ${ctx.cy} L ${cgX + MARKER_R} ${ctx.cy} A ${MARKER_R} ${MARKER_R} 0 0 1 ${cgX} ${ctx.cy + MARKER_R} Z`}
            fill="var(--text-primary)"
          />
          <path
            d={`M ${cgX} ${ctx.cy} L ${cgX - MARKER_R} ${ctx.cy} A ${MARKER_R} ${MARKER_R} 0 0 1 ${cgX} ${ctx.cy - MARKER_R} Z`}
            fill="var(--text-primary)"
          />
        </g>
      )}
      {cpX !== null && (
        <g pointerEvents="none">
          <circle cx={cpX} cy={ctx.cy} r={MARKER_R} fill="none" stroke="var(--status-serious)" strokeWidth="2" />
          <circle cx={cpX} cy={ctx.cy} r={3.5} fill="var(--status-serious)" />
        </g>
      )}
      {(callouts.cg || callouts.cp) && (
        <g pointerEvents="none">
          {callouts.cg && (
            <>
              <line
                x1={callouts.cg.x}
                y1={callouts.cg.leaderY1}
                x2={callouts.cg.x}
                y2={callouts.cg.leaderY2}
                stroke="var(--text-primary)"
                strokeWidth="1"
                strokeDasharray="4 3"
              />
              <circle cx={callouts.cg.x} cy={callouts.cg.leaderY2} r={4} fill="var(--text-primary)" />
              <text
                x={callouts.cg.x + 8}
                y={callouts.cg.leaderY2}
                dominantBaseline="central"
                fontSize="11"
                fontWeight="bold"
                fill="var(--text-primary)"
              >
                {cgLabel}
              </text>
            </>
          )}
          {callouts.cp && (
            <>
              <line
                x1={callouts.cp.x}
                y1={callouts.cp.leaderY1}
                x2={callouts.cp.x}
                y2={callouts.cp.leaderY2}
                stroke="var(--status-serious)"
                strokeWidth="1"
                strokeDasharray="4 3"
              />
              <circle cx={callouts.cp.x} cy={callouts.cp.leaderY2} r={4} fill="var(--status-serious)" />
              <text
                x={callouts.cp.x + 8}
                y={callouts.cp.leaderY2}
                dominantBaseline="central"
                fontSize="11"
                fontWeight="bold"
                fill="var(--status-serious)"
              >
                {cpLabel}
              </text>
            </>
          )}
          {callouts.margin && stab && (
            <text
              x={callouts.margin.x}
              y={callouts.margin.y}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize="11"
              fontWeight="bold"
              fill={STABILITY_VAR[stab]}
            >
              {margin?.text}
            </text>
          )}
        </g>
      )}
    </>
  );
}

/**
 * Hover overlay (S5): a light accent wash over the hovered component's extent
 * plus a name tag, deliberately fainter than the solid width-2 selection
 * outline so the two stay distinguishable.
 */
export function HoverOverlay({ box, name, w, h }: { box: HoverBox | null; name: string; w: number; h: number }) {
  const tag = box ? hoverTagFor(box, name, w, h) : null;
  if (!box || !tag) return null;
  return (
    <g pointerEvents="none">
      <rect
        x={box.x0 - 2}
        y={box.y0 - 2}
        width={box.x1 - box.x0 + 4}
        height={box.y1 - box.y0 + 4}
        rx="3"
        fill="var(--accent)"
        fillOpacity="0.14"
        stroke="var(--accent)"
        strokeWidth="1"
        strokeOpacity="0.6"
      />
      <g>
        <rect
          x={tag.x - tag.tw / 2}
          y={tag.y - 9}
          width={tag.tw}
          height={18}
          rx="4"
          fill="rgba(13,14,18,0.9)"
          stroke="var(--border)"
          strokeWidth="1"
        />
        <text
          x={tag.x}
          y={tag.y}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize="11"
          fill={token('sch-label')}
        >
          {name}
        </text>
      </g>
    </g>
  );
}
