import { getChart, putChart, warningsOf, type Chart } from "./chart.js";
import { sanitizeConfigUI } from "./configUI.js";
import { RESTYLE_SAMPLE_ROWS } from "./constants.js";
import type { ConfigControl } from "./schemas.js";

/**
 * The deterministic halves of data-formulator's chart-restyle flow. The LLM half —
 * deciding what to change — belongs to the calling agent, guided by the
 * `chart-restyle` skill; what stays here is the part that is fiddly and easy to get
 * wrong.
 */

/** flint annotates its output with private keys; they are noise to a restyling agent. */
function stripPrivateKeys(spec: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(spec).filter(([key]) => !key.startsWith("_")));
}

export interface PreparedRestyle {
  chartId: string;
  chartType: string;
  /** The compiled spec with `data` removed — the caller re-attaches rows on the way back. */
  specWithoutData: Record<string, unknown>;
  /** A sample of the rows flint actually embedded. See below for why this matters. */
  dataSample: Array<Record<string, unknown>>;
}

export function prepareRestyle(chartId: string, sampleSize = RESTYLE_SAMPLE_ROWS): PreparedRestyle {
  const chart = getChart(chartId);
  const spec = stripPrivateKeys(structuredClone(chart.vlSpec));
  delete spec["data"];

  return {
    chartId: chart.id,
    chartType: chart.chartType,
    specWithoutData: spec,
    dataSample: embeddedRows(chart).slice(0, sampleSize),
  };
}

/**
 * The rows flint embedded, not the rows the caller loaded.
 *
 * flint runs `convertTemporalData` over the data during assembly, so a Year of
 * 1980 is embedded as the string "1980". Sampling the pre-conversion rows is what
 * data-formulator's `buildEmbeddedDataForChart` (src/app/restyle.ts:19-54) exists
 * to prevent: an agent shown raw values picks axis formats that then mismatch what
 * actually renders.
 */
function embeddedRows(chart: Chart): Array<Record<string, unknown>> {
  const data = chart.vlSpec["data"];
  if (data && typeof data === "object") {
    const values = (data as { values?: unknown }).values;
    if (Array.isArray(values)) return values as Array<Record<string, unknown>>;
  }
  return [];
}

export interface ApplyRestyleArgs {
  /** The chart being restyled — its embedded rows are reused verbatim. */
  chartId: string;
  /** The agent's edited spec, without a `data` block. */
  vlSpec: Record<string, unknown>;
  configUI?: unknown;
}

export interface RestyleResult {
  chartId: string;
  vlSpec: Record<string, unknown>;
  configUI: ConfigControl[];
  warnings: string[];
}

/**
 * Re-attach the original rows to an edited spec and register it as a new chart.
 *
 * A restyle produces a *variant* rather than overwriting the original, which is how
 * upstream models it (`makeVariant`, src/app/restyle.ts:180) — the original stays
 * addressable, so a report can still embed it.
 */
export function applyRestyle({ chartId, vlSpec, configUI }: ApplyRestyleArgs): RestyleResult {
  const original = getChart(chartId);
  const warnings: string[] = [];

  const restyled = stripPrivateKeys(structuredClone(vlSpec));
  if ("data" in restyled) {
    // Hard rule 1 of upstream's restyle prompt: the agent must not supply data.
    // Rather than fail, drop it — the live rows are authoritative.
    warnings.push("Ignored the `data` block in the supplied spec; the chart's own rows were reused.");
    delete restyled["data"];
  }
  restyled["data"] = { values: embeddedRows(original) };

  const controls = sanitizeConfigUI(configUI);
  if (Array.isArray(configUI) && controls.length < configUI.length) {
    warnings.push(
      `Dropped ${configUI.length - controls.length} of ${configUI.length} configUI controls as malformed or unsafe.`
    );
  }

  const chart = putChart({
    ...original,
    id: `${original.id}-v${Date.now().toString(36)}`,
    vlSpec: restyled,
    warnings: warningsOf(restyled),
  });

  return { chartId: chart.id, vlSpec: restyled, configUI: controls, warnings };
}
