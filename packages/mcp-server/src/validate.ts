import { vlGetTemplateChannels, vlGetTemplateDef } from "flint-chart";
import { encodedFields } from "./chart.js";
import type { ChartSpec, ChartWarning, ValidationResult } from "./schemas.js";

export interface ValidateArgs {
  chartSpec: ChartSpec;
  /** Columns the chart's dataset actually has. */
  columns: readonly string[];
  /** Warnings flint produced while assembling, if it got that far. */
  warnings?: ChartWarning[];
}

/**
 * Check a chart spec against flint's template registry and the dataset's real
 * columns.
 *
 * There is no repair loop here: the caller is somebody else's agent, so the error
 * text *is* the repair mechanism. Every message names what was wrong and what was
 * available, following data-formulator's `agent.fieldsNotFound`
 * (analyst/agent.py:1060-1074).
 */
export function validateChart({ chartSpec, columns, warnings = [] }: ValidateArgs): ValidationResult {
  const errors: string[] = [];

  const template = vlGetTemplateDef(chartSpec.chartType);
  if (!template) {
    // assembleVegaLite throws outright on an unknown type (flint assemble.ts:145),
    // so catching it here gives a better message than the exception would.
    errors.push(
      `Unknown chartType "${chartSpec.chartType}". Call list_chart_types for the available names.`
    );
    return { valid: false, errors, warnings };
  }

  const channels = vlGetTemplateChannels(chartSpec.chartType);
  const used = Object.keys(chartSpec.encodings);
  const badChannels = used.filter((channel) => !channels.includes(channel));
  if (badChannels.length > 0) {
    errors.push(
      `Chart type "${chartSpec.chartType}" has no channel ${badChannels
        .map((c) => `"${c}"`)
        .join(", ")}. Its channels are: ${channels.join(", ")}.`
    );
  }

  const missing = [...new Set(encodedFields(chartSpec.encodings))].filter(
    (field) => !columns.includes(field)
  );
  if (missing.length > 0) {
    errors.push(
      `Encoding fields not found in the dataset: ${missing
        .map((f) => `"${f}"`)
        .join(", ")}. Available columns: ${columns.join(", ")}.`
    );
  }

  if (used.length === 0) {
    errors.push(`Chart type "${chartSpec.chartType}" needs at least one encoding.`);
  }

  // flint distinguishes advisory warnings from real failures; only the latter
  // should make a chart invalid.
  for (const warning of warnings) {
    if (warning.severity === "error") errors.push(`${warning.code}: ${warning.message}`);
  }

  return { valid: errors.length === 0, errors, warnings };
}
