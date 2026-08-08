/**
 * Template registry (PLAN.md section 10).
 *
 * Exposes the built-in `Template` values backing the `list_templates`
 * MCP tool (PLAN.md section 6.7) and `create_visual_session({ template })`
 * (section 6.1). Each template is a concrete example (real D2 / HTML+
 * Tailwind v4 source) rather than a programmatic builder API — see
 * PLAN.md section 13's explicit "no VisualKit SDK" constraint.
 */

import type { Template, TemplateKind } from "../types.js";
import { architectureOverviewTemplate } from "./architecture-overview.js";
import { browserAppScreenTemplate } from "./browser-app-screen.js";
import { chartReportTemplate } from "./chart-report.js";
import { dashboardOverviewTemplate } from "./dashboard-overview.js";
import { mobileAppScreenTemplate } from "./mobile-app-screen.js";
import { multipageReportTemplate } from "./multipage-report.js";
import { onePageInfographicTemplate } from "./one-page-infographic.js";
import { phoneFrameScreenTemplate } from "./phone-frame-screen.js";
import { sequenceFlowTemplate } from "./sequence-flow.js";

/**
 * All built-in templates, in the order listed in PLAN.md section 10.
 * Ids match `TEMPLATE_IDS` from src/types.ts exactly.
 */
export const TEMPLATES: readonly Template[] = [
  architectureOverviewTemplate,
  sequenceFlowTemplate,
  mobileAppScreenTemplate,
  phoneFrameScreenTemplate,
  browserAppScreenTemplate,
  dashboardOverviewTemplate,
  onePageInfographicTemplate,
  multipageReportTemplate,
  chartReportTemplate,
];

/**
 * list_templates({ kind? }) (PLAN.md section 6.7).
 *
 * Returns all templates, or only those matching `kind` when provided.
 */
export function listTemplates(kind?: TemplateKind): Template[] {
  if (kind === undefined) {
    return [...TEMPLATES];
  }
  return TEMPLATES.filter((template) => template.kind === kind);
}

/**
 * Looks up a single template by id. Returns `undefined` for unknown ids
 * (e.g. a stale or mistyped `create_visual_session({ template })` value).
 */
export function getTemplate(id: string): Template | undefined {
  return TEMPLATES.find((template) => template.id === id);
}

export {
  architectureOverviewTemplate,
  browserAppScreenTemplate,
  chartReportTemplate,
  dashboardOverviewTemplate,
  mobileAppScreenTemplate,
  multipageReportTemplate,
  onePageInfographicTemplate,
  phoneFrameScreenTemplate,
  sequenceFlowTemplate,
};
