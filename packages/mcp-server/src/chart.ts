import { randomUUID } from "node:crypto";
import {
  assembleVegaLite,
  listThemePresets,
  vlAllTemplateDefs,
  vlGetTemplateChannels,
  vlGetTemplateDef,
  vlRecommendCharts,
  vlRecommendEncodings,
} from "flint-chart";
import { CHART_ID_LENGTH, CHART_ID_PREFIX, FALLBACK_CHART_TYPE } from "./constants.js";
import type { ChartSpec, ChartWarning, SemanticTypeMap } from "./schemas.js";

/**
 * Short names an agent may use for a chart type, mapped to flint's template
 * names. Ported from data-formulator's `AGENT_CHART_TYPE_MAP`
 * (src/app/chartRecommendation.ts:17-38), including its legacy aliases.
 */
const CHART_TYPE_ALIASES: Record<string, string> = {
  scatter: "Scatter Plot",
  regression: "Regression",
  bar: "Bar Chart",
  grouped_bar: "Grouped Bar Chart",
  histogram: "Histogram",
  line: "Line Chart",
  area: "Area Chart",
  heatmap: "Heatmap",
  boxplot: "Boxplot",
  pie: "Pie Chart",
  lollipop: "Lollipop Chart",
  waterfall: "Waterfall Chart",
  candlestick: "Candlestick Chart",
  // flint has one bubble-map template, `Map`; whether it draws the US or the world is
  // its `region` property, not a separate template. These four used to point at
  // "World Map"/"US Map", which no template has ever been called.
  map: "Map",
  world_map: "Map",
  us_map: "Map",
  choropleth: "Choropleth",
  // Legacy aliases, kept for the same reason upstream keeps them.
  point: "Scatter Plot",
  group_bar: "Grouped Bar Chart",
  worldmap: "Map",
  usmap: "Map",
};

/**
 * Resolve whatever an agent called the chart type into a real flint template,
 * following upstream's precedence (chartRecommendation.ts:61-63): the alias table,
 * then an already-valid template name, then a safe default.
 */
export function resolveChartType(raw: string | undefined): string {
  if (!raw) return FALLBACK_CHART_TYPE;
  const alias = CHART_TYPE_ALIASES[raw] ?? CHART_TYPE_ALIASES[raw.toLowerCase()];
  // An alias is only worth following if it names a template flint actually has. Four of
  // these once pointed at templates that never existed, and because the alias was
  // returned unchecked, every call using them failed downstream instead of falling back.
  if (alias && vlGetTemplateDef(alias)) return alias;
  if (vlGetTemplateDef(raw)) return raw;
  return FALLBACK_CHART_TYPE;
}

/** flint's catalog, generated rather than hardcoded so it can't drift. */
export function listChartTypes(): Array<{ chartType: string; channels: string[] }> {
  return vlAllTemplateDefs.map((def) => ({
    chartType: def.chart,
    channels: vlGetTemplateChannels(def.chart),
  }));
}

export interface Chart {
  id: string;
  chartType: string;
  chartSpec: ChartSpec;
  semanticTypes: SemanticTypeMap;
  /** The compiled Vega-Lite spec, with data embedded. */
  vlSpec: Record<string, unknown>;
  warnings: ChartWarning[];
  /** Which dataset the chart was built from. */
  datasetId: string;
}

const charts = new Map<string, Chart>();

export function getChart(id: string): Chart {
  const found = charts.get(id);
  if (found) return found;
  const known = [...charts.keys()];
  throw new Error(
    `Unknown chartId "${id}". ` +
      (known.length ? `Known charts: ${known.join(", ")}.` : "No charts have been created yet.")
  );
}

export function putChart(chart: Chart): Chart {
  charts.set(chart.id, chart);
  return chart;
}

/** Upstream mints `chart-<uuid>` (analyst/agent.py:1109); charts are referenced by id in reports. */
function mintChartId(): string {
  return `${CHART_ID_PREFIX}${randomUUID().replace(/-/g, "").slice(0, CHART_ID_LENGTH)}`;
}

export interface BuildChartArgs {
  datasetId: string;
  rows: Array<Record<string, unknown>>;
  chartSpec: ChartSpec;
  semanticTypes?: SemanticTypeMap;
  /** A preset id, or a ThemeSpec object, optionally with `extends`. */
  themeSpec?: string | Record<string, unknown>;
}

/** flint's shipped visual systems, for the `themeSpec` argument. */
export function listThemes(): Array<{ id: string; label: string; description?: string }> {
  return listThemePresets() as Array<{ id: string; label: string; description?: string }>;
}

/**
 * Compile a chart spec with flint and register the result.
 *
 * flint fills gaps rather than failing: an omitted `encodings` is recommended from
 * the data, and an unrecognised chart type falls back. Both paths are flint's own
 * exported heuristics (`vlRecommendEncodings`, `vlRecommendCharts`), never
 * hand-rolled rules.
 */
export function buildChart({
  datasetId,
  rows,
  chartSpec,
  semanticTypes = {},
  themeSpec,
}: BuildChartArgs): Chart {
  let chartType = resolveChartType(chartSpec.chartType);
  let encodings = normalizeEncodings(chartSpec.encodings);

  if (Object.keys(encodings).length === 0) {
    if (!chartSpec.chartType) {
      // Nothing to go on: let flint rank chart types for this data and take the best.
      const [best] = vlRecommendCharts(rows, semanticTypes as Record<string, string>, { max: 1 });
      if (best) {
        chartType = best.chartType;
        encodings = best.encodings;
      }
    }
    if (Object.keys(encodings).length === 0) {
      encodings = vlRecommendEncodings(chartType, rows, semanticTypes as Record<string, string>);
    }
  }

  const resolvedSpec: ChartSpec = { ...chartSpec, chartType, encodings };

  // flint declares its optional fields as `prop?: T`, while zod infers
  // `prop?: T | undefined`; under `exactOptionalPropertyTypes` those are distinct
  // types for an identical runtime shape, so the boundary is cast rather than
  // widened on either side.
  const input = {
    data: { values: rows },
    semantic_types: semanticTypes,
    ...(themeSpec === undefined ? {} : { theme_spec: themeSpec }),
    chart_spec: {
      chartType,
      encodings,
      ...(chartSpec.title === undefined ? {} : { title: chartSpec.title }),
      ...(chartSpec.subtitle === undefined ? {} : { subtitle: chartSpec.subtitle }),
      ...(chartSpec.chartProperties === undefined
        ? {}
        : { chartProperties: chartSpec.chartProperties }),
    },
  } as Parameters<typeof assembleVegaLite>[0];

  const vlSpec = assembleVegaLite(input) as Record<string, unknown>;

  return putChart({
    id: mintChartId(),
    chartType,
    chartSpec: resolvedSpec,
    semanticTypes,
    vlSpec,
    warnings: warningsOf(vlSpec),
    datasetId,
  });
}

/**
 * flint reports assembly warnings on the private `_warnings` key of the returned
 * spec, not as a second return value — see flint-mcp/src/render/assemble.ts:204.
 */
export function warningsOf(vlSpec: Record<string, unknown>): ChartWarning[] {
  const raw = vlSpec["_warnings"];
  return Array.isArray(raw) ? (raw as ChartWarning[]) : [];
}

/**
 * data-formulator renames the agent-facing `facet` channel to flint's `column`
 * (chartRecommendation.ts:90,101). Agents reach for "facet" because that is the
 * Vega-Lite word, so accept it.
 */
function normalizeEncodings(encodings: ChartSpec["encodings"]): ChartSpec["encodings"] {
  const out: ChartSpec["encodings"] = {};
  for (const [channel, value] of Object.entries(encodings)) {
    out[channel === "facet" ? "column" : channel] = value;
  }
  return out;
}

/** Field names an encoding refers to, across flint's shorthand, object, and array forms. */
export function encodedFields(encodings: ChartSpec["encodings"]): string[] {
  const fields: string[] = [];
  const collect = (value: unknown): void => {
    if (typeof value === "string") {
      fields.push(value);
    } else if (Array.isArray(value)) {
      for (const entry of value) collect(entry);
    } else if (value && typeof value === "object") {
      const field = (value as { field?: unknown }).field;
      if (typeof field === "string") fields.push(field);
    }
  };
  for (const value of Object.values(encodings)) collect(value);
  return fields;
}
