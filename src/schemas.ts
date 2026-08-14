import * as z from "zod/v4";

// Define the data schema for input fields
export const DataSchemaField = z.object({
  field: z.string(),
  type: z.enum(["quantitative", "categorical", "temporal", "ordinal", "geojson"]),
  description: z.string().optional(),
  unit: z.string().optional(),
});

// Define the request schema for generating a chart spec
export const GenerateSpecRequest = z.object({
  prompt: z.string(),
  data_schema: z.array(DataSchemaField),
  stream: z.boolean().default(false),
  skip_validation: z.boolean().default(false),
});

// Define the Vega-Lite spec schema
export const VegaLiteSpec = z.object({
  $schema: z.string().default("https://vega.github.io/schema/vega-lite/v5.json"),
  data: z.object({ values: z.array(z.record(z.string(), z.unknown())) }),
  mark: z.string(),
  encoding: z.record(z.string(), z.unknown()),
});

// Result of validating a spec against a data schema
export const ValidationResult = z.object({
  valid: z.boolean(),
  warnings: z.array(z.string()),
});

// Define the types for TypeScript
export type GenerateSpecRequest = z.infer<typeof GenerateSpecRequest>;
export type VegaLiteSpec = z.infer<typeof VegaLiteSpec>;
export type DataSchemaField = z.infer<typeof DataSchemaField>;
export type ValidationResult = z.infer<typeof ValidationResult>;

// The *input* side of the request: `stream` and `skip_validation` have
// defaults, so they are required in `z.infer` (the output type) but optional
// for callers constructing a request.
export type GenerateSpecInput = z.input<typeof GenerateSpecRequest>;
