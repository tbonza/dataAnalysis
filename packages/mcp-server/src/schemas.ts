import * as z from "zod/v4";

/**
 * Mirrors flint's `ChartAssemblyInput.chart_spec` (flint-chart core/types.ts:1091).
 * flint is the source of truth for this shape — we validate rather than redefine.
 */

/**
 * A column as DuckDB reports it back through Arrow — the zod twin of `DatasetColumn`
 * in duckdb.ts. Declared once here because three tools return it, and two tools
 * returning "columns" in different shapes is exactly the drift this prevents.
 */
export const DatasetColumnSchema = z.object({
  name: z.string(),
  type: z.string().describe('Arrow type name, e.g. "Utf8", "Int32", "Double".'),
});

/**
 * One row of tabular data. Keys are the caller's column names, so the contents are
 * open by nature; naming it keeps the four places that pass rows around from each
 * describing the same thing differently.
 */
export const DataRow = z.record(z.string(), z.unknown());

/**
 * A compiled Vega-Lite specification. Deliberately unvalidated as to contents —
 * flint owns that vocabulary — but named, so a consuming agent reading the tool
 * schemas sees what the object is rather than an anonymous record.
 */
export const VegaLiteSpec = z
  .record(z.string(), z.unknown())
  .describe("A Vega-Lite spec, ready to render. The client rasterizes; no server does.");

/** A channel encoding. A bare string is flint's shorthand for `{ field: "name" }`. */
const ChartEncoding = z.object({
  field: z.string().optional(),
  type: z.enum(["quantitative", "nominal", "ordinal", "temporal"]).optional(),
  aggregate: z.enum(["count", "sum", "average", "mean"]).optional(),
  sortOrder: z.enum(["ascending", "descending"]).optional(),
  sortBy: z.string().optional(),
  scheme: z.string().optional(),
});

/**
 * flint accepts a string shorthand, a full encoding, or an array of either. The
 * array form is "static series" — several measure columns folded into one long-form
 * series, which is how a wide table gets charted without a reshaping step.
 */
export const RawEncoding = z.union([
  z.string(),
  ChartEncoding,
  z.array(z.union([z.string(), ChartEncoding])),
]);

/**
 * A semantic type annotation. Note the camelCase `semanticType`
 * (flint-chart core/field-semantics.ts:50) — data-formulator's Python side uses
 * snake_case and needs a bridge, but calling flint from TypeScript does not.
 */
const SemanticAnnotation = z.object({
  semanticType: z.string(),
  unit: z.string().optional(),
  intrinsicDomain: z.tuple([z.number(), z.number()]).optional(),
  divergingPivot: z.number().optional(),
});

export const SemanticTypeMap = z.record(z.string(), z.union([z.string(), SemanticAnnotation]));

export const ChartSpec = z.object({
  chartType: z.string().describe('Chart template name, e.g. "Bar Chart". See list_chart_types.'),
  title: z.string().optional().describe("The finding, as a sentence."),
  subtitle: z
    .string()
    .optional()
    .describe("What is measured, of whom, when, and in what units."),
  encodings: z
    .record(z.string(), RawEncoding)
    .describe('Channel to field, e.g. { x: "region", y: "revenue" }.'),
  chartProperties: z.record(z.string(), z.unknown()).optional(),
});

export type ChartSpec = z.infer<typeof ChartSpec>;
export type SemanticTypeMap = z.infer<typeof SemanticTypeMap>;

/** flint's assembly warning (flint-chart core/types.ts:1027). */
export const ChartWarning = z.object({
  severity: z.enum(["info", "warning", "error"]),
  code: z.string(),
  message: z.string(),
  channel: z.string().optional(),
  field: z.string().optional(),
});

export type ChartWarning = z.infer<typeof ChartWarning>;

/**
 * A `configUI` control: a path into the Vega-Lite spec plus the values that may be
 * written there. Ported from data-formulator's `VariantConfigControl`. There is no
 * code in a control — see configUI.ts.
 */
const ControlPath = z.array(z.union([z.string(), z.number().int().nonnegative()]));

export const ConfigControl = z.discriminatedUnion("type", [
  z.object({
    key: z.string(),
    label: z.string(),
    path: ControlPath,
    type: z.literal("continuous"),
    min: z.number(),
    max: z.number(),
    step: z.number().optional(),
    defaultValue: z.number(),
  }),
  z.object({
    key: z.string(),
    label: z.string(),
    path: ControlPath,
    type: z.literal("binary"),
    defaultValue: z.boolean(),
  }),
  z.object({
    key: z.string(),
    label: z.string(),
    path: ControlPath,
    type: z.literal("discrete"),
    options: z.array(z.object({ value: z.unknown(), label: z.string() })).min(1),
    defaultValue: z.unknown(),
  }),
]);

export type ConfigControl = z.infer<typeof ConfigControl>;

export const ValidationResult = z.object({
  valid: z.boolean(),
  errors: z.array(z.string()),
  warnings: z.array(ChartWarning),
});

export type ValidationResult = z.infer<typeof ValidationResult>;
