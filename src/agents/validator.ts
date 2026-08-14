import { VegaLiteSpec } from "../schemas.js";
import type { DataSchemaField, ValidationResult } from "../schemas.js";

export interface ValidateSpecArgs {
  spec: unknown;
  data_schema: DataSchemaField[];
}

// Validate a Vega-Lite spec against a data schema.
export function validateSpec({ spec, data_schema }: ValidateSpecArgs): ValidationResult {
  // Validate the spec's shape. Reuses the schema in schemas.ts rather than
  // pulling in vega-lite, which has no `validate` export anyway.
  const parsed = VegaLiteSpec.safeParse(spec);
  if (!parsed.success) {
    return {
      valid: false,
      warnings: parsed.error.issues.map(
        (issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`
      ),
    };
  }

  // Check that every field referenced by an encoding exists in the data schema.
  const fieldsInSpec = new Set(
    Object.values(parsed.data.encoding)
      .filter((enc) => typeof enc === "object" && enc !== null && "field" in enc)
      .map((enc) => (enc as { field: string }).field)
  );
  const fieldsInSchema = new Set(data_schema.map((f) => f.field));
  const warnings = [...fieldsInSpec]
    .filter((field) => !fieldsInSchema.has(field))
    .map((field) => `Encoding references unknown field "${field}"`);

  return { valid: warnings.length === 0, warnings };
}
