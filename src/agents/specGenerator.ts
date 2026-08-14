import { ChatAnthropic } from "@langchain/anthropic";
import { PromptTemplate } from "@langchain/core/prompts";
import { VegaLiteSpec } from "../schemas";
import { MCPTool, MCPToolContext } from "@microsoft/modelcontextprotocol";

// Initialize the LLM (Anthropic) with structured output for Vega-Lite specs
const llm = new ChatAnthropic({
  model: "claude-3-5-sonnet-20240620",
  temperature: 0,
}).withStructuredOutput(VegaLiteSpec);

// Define the prompt template for spec generation
const prompt = PromptTemplate.fromTemplate(
  "Generate a Vega-Lite spec for: {prompt}\nData schema: {data_schema}"
);

// Define the MCP tool for spec generation
export const specGeneratorTool: MCPTool = {
  name: "generate_spec",
  description: "Generate a Vega-Lite spec from a prompt and data schema.",
  async execute(ctx: MCPToolContext): Promise<VegaLiteSpec> {
    const { prompt: userPrompt, data_schema } = ctx.input as {
      prompt: string;
      data_schema: Array<{ field: string; type: string }>;
    };
    const formattedPrompt = await prompt.format({
      prompt: userPrompt,
      data_schema: JSON.stringify(data_schema),
    });
    return llm.invoke(formattedPrompt);
  },
};