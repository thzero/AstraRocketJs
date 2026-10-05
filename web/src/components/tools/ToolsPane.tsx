import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useTabs } from '../common/useTabs';
import { LandingEstimator } from './LandingEstimator';
import { OffTheRail } from './OffTheRail';
import { ParachuteTool } from './ParachuteTool';

const TOOLS = ['landing', 'rail', 'chute'] as const;
type Tool = (typeof TOOLS)[number];

/** The open tool, kept for the page's life like each tool's own inputs. */
let rememberedTool: Tool = 'landing';

/** Back to the first tool, so each test starts from it. */
export function forgetToolsPane(): void {
  rememberedTool = 'landing';
}

/**
 * The Tools tab: quick answers that need no design, one tool at a time. Only
 * the open tool is mounted, so no two tools put the same field in the document.
 */
export function ToolsPane() {
  const { t } = useTranslation();
  const [tool, setToolState] = useState<Tool>(rememberedTool);
  const setTool = (next: Tool) => {
    rememberedTool = next;
    setToolState(next);
  };
  const tabs = useTabs(TOOLS, tool, setTool);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        role="tablist"
        aria-label={t('tools.label')}
        className="flex shrink-0 gap-1 overflow-x-auto border-b border-white/10 px-3 pt-2"
      >
        {TOOLS.map((k) => (
          <button
            key={k}
            type="button"
            {...tabs.tab(k)}
            className={`-mb-px whitespace-nowrap border-b-2 px-3 py-1.5 text-xs font-semibold ${
              tool === k ? 'border-sky-400 text-sky-300' : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            {t(`tools.tool_${k}`)}
          </button>
        ))}
      </div>
      <div {...tabs.panel} className="min-h-0 flex-1 overflow-auto p-3">
        {tool === 'landing' && <LandingEstimator />}
        {tool === 'rail' && <OffTheRail />}
        {tool === 'chute' && <ParachuteTool />}
      </div>
    </div>
  );
}
