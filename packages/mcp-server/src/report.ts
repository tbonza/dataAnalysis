import * as z from "zod/v4";
import { getChart } from "./chart.js";

/**
 * Assemble a report from prose the agent wrote and charts it already made.
 *
 * The prose is the agent's job — this server has no LLM. What it contributes is
 * resolving `chartId` references into renderable specs, which is what lets a report
 * embed existing charts by id instead of recreating them (data-formulator's report
 * skill works the same way).
 */

export const ReportSection = z.object({
  markdown: z.string().describe("Prose for this section."),
  chartId: z
    .string()
    .optional()
    .describe("A chart to embed after the prose, from a previous create_chart call."),
});

export const ReportRequest = z.object({
  title: z.string(),
  sections: z.array(ReportSection).min(1),
});

export type ReportRequest = z.infer<typeof ReportRequest>;

export interface ReportResult {
  title: string;
  /** The full document. Chart placeholders are `![](chart://<id>)`. */
  markdown: string;
  /** Every chart the document references, in order of first appearance. */
  charts: Array<{ chartId: string; chartType: string; vlSpec: Record<string, unknown> }>;
}

export function createReport({ title, sections }: ReportRequest): ReportResult {
  const charts: ReportResult["charts"] = [];
  const seen = new Set<string>();
  const parts = [`# ${title}`];

  for (const section of sections) {
    parts.push(section.markdown.trim());
    if (section.chartId === undefined) continue;

    // getChart throws with the list of known ids, which is what an agent needs to
    // repair a stale or invented reference.
    const chart = getChart(section.chartId);
    parts.push(`![${chart.chartSpec.title ?? chart.chartType}](chart://${chart.id})`);
    if (!seen.has(chart.id)) {
      seen.add(chart.id);
      charts.push({ chartId: chart.id, chartType: chart.chartType, vlSpec: chart.vlSpec });
    }
  }

  return { title, markdown: parts.join("\n\n") + "\n", charts };
}
