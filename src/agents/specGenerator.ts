import { PromptTemplate } from "@langchain/core/prompts";
import { VegaLiteSpec } from "../schemas.js";
import type { DataSchemaField } from "../schemas.js";
import { createChatModel } from "../model.js";

// The structured-output schema constrains the response to a Vega-Lite spec.
// `$schema` is omitted from what the model sees: Bedrock requires tool-schema
// property names to match ^[a-zA-Z0-9_.-]{1,64}$, and the leading `$` is
// rejected. It is restored from the schema default when parsing the result.
const llm = createChatModel().withStructuredOutput(VegaLiteSpec.omit({ $schema: true }));

// Define the prompt template for spec generation
const prompt = PromptTemplate.fromTemplate(
  "Generate a Vega-Lite spec for: {prompt}\nData schema: {data_schema}"
);

export interface GenerateSpecArgs {
  prompt: string;
  data_schema: DataSchemaField[];
}

// Generate a Vega-Lite spec from a prompt and data schema.
export async function generateSpec({
  prompt: userPrompt,
  data_schema,
}: GenerateSpecArgs): Promise<VegaLiteSpec> {
  const formattedPrompt = await prompt.format({
    prompt: userPrompt,
    data_schema: JSON.stringify(data_schema),
  });
  // `withStructuredOutput` yields the schema's *input* type, so `$schema` may be
  // absent. Parse to apply the default and validate what the model returned.
  return VegaLiteSpec.parse(await llm.invoke(formattedPrompt));
}
