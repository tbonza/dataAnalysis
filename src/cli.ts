import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import type { GenerateSpecInput } from "./schemas.js";

const URL_ = process.env.MCP_URL ?? "http://127.0.0.1:3000/mcp";

// Define a sample request
const request: GenerateSpecInput = {
  prompt: "Show sales by region as a bar chart",
  data_schema: [
    { field: "region", type: "categorical" },
    { field: "sales", type: "quantitative" },
  ],
};

// Pull the structured payload out of a tool result, falling back to the text
// blocks when a tool didn't declare an outputSchema.
function resultOf(result: { structuredContent?: unknown; content: unknown[] }): unknown {
  if (result.structuredContent !== undefined) return result.structuredContent;
  return result.content
    .filter((b): b is { type: "text"; text: string } => (b as { type?: string }).type === "text")
    .map((b) => b.text)
    .join("\n");
}

async function main(): Promise<void> {
  const client = new Client({ name: "chart-cli", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(URL_)));

  try {
    const { tools } = await client.listTools();
    console.log("Connected. tools:", tools.map((t) => t.name).join(", "));

    // Drive the pipeline: classify -> generate -> validate.
    const intent = await client.callTool({
      name: "classify_intent",
      arguments: { prompt: request.prompt },
    });
    console.log("intent:", resultOf(intent));

    const spec = await client.callTool({
      name: "generate_spec",
      arguments: { prompt: request.prompt, data_schema: request.data_schema },
    });
    console.log("spec:  ", JSON.stringify(resultOf(spec)));

    if (!request.skip_validation) {
      const validation = await client.callTool({
        name: "validate_spec",
        arguments: { spec: resultOf(spec), data_schema: request.data_schema },
      });
      console.log("valid: ", JSON.stringify(resultOf(validation)));
    }
  } finally {
    await client.close();
  }
}

// An unknown or disabled tool rejects rather than resolving `{ isError: true }`,
// so failures land here.
main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
