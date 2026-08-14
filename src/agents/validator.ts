import { validate } from "vega-lite";
import { VegaLiteSpec, DataSchemaField } from "../schemas";
import { MCPTool, MCPToolContext } from "@microsoft/modelcontextprotocol";

// Define the MCP tool for spec validation
export const validatorTool: MCPTool = {
  name: "validate_spec",
  description: "Validate a Vega-Lite spec against a data schema.",
  async execute(ctx: MCPToolContext): Promise<{ valid: boolean; warnings: string[] }> {
    const { spec, data_schema } = ctx.input as {
      spec: VegaLiteSpec;
      data_schema: DataSchemaField[];
    };
    try {
      // Validate against Vega-Lite schema
      validate(spec);
      
      // Check if all fields in the spec exist in the data schema
      const fieldsInSpec = new Set(
        Object.values(spec.encoding)
          .filter((enc) => typeof enc === "object" && enc !== null && "field" in enc)
          .map((enc) => (enc as { field: string }).field)
      );
      const fieldsInSchema = new Set(data_schema.map((f) => f.field));
      const warnings = [...fieldsInSpec].filter((field) => !fieldsInSchema.has(field));
      
      return { valid: warnings.length === 0, warnings };
    } catch (error) {
      return {
        valid: false,
        warnings: [error instanceof Error ? error.message : "Validation failed"],
      };
    }
  },
};