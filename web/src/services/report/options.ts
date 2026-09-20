/**
 * What the export dialog asks the PDF report for: which sections and stages
 * to include, the paper, and the template colors.
 */

/** Per-stage include flags, mirrored by the export dialog's tree. */
export interface StageOption {
  include: boolean;
  parts: boolean;
  finTemplates: boolean;
}

export interface ReportOptions {
  designReport: boolean;
  includeMotors: boolean;
  showByStage: boolean;
  noseTemplates: boolean;
  transitionTemplates: boolean;
  stages: StageOption[];
  paper: 'letter' | 'a4';
  orientation: 'portrait' | 'landscape';
  /** Template fill color (hex), or '' for outline only. */
  templateFill: string;
  templateStroke: string;
}
