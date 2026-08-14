import { z } from "zod";

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
  data: z.object({ values: z.array(z.record(z.unknown())) }),
  mark: z.string(),
  encoding: z.record(z.unknown()),
});

// Define the types for TypeScript
export type GenerateSpecRequest = z.infer<typeof GenerateSpecRequest>;
export type VegaLiteSpec = z.infer<typeof VegaLiteSpec>;
export type DataSchemaField = z.infer<typeof DataSchemaField>;