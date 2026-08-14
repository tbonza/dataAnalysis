import { ModelContextProtocol } from "../modelcontextprotocol/typescript-sdk";
import { intentRouterTool } from "./agents/intentRouter";
import { specGeneratorTool } from "./agents/specGenerator";
import { validatorTool } from "./agents/validator";
import { GenerateSpecRequest } from "./schemas";

// Initialize the MCP server with the tools
const mcp = new ModelContextProtocol({
  tools: [intentRouterTool, specGeneratorTool, validatorTool],
});

// Register the `/api/chart/generate` route
mcp.registerRoute("/api/chart/generate", async (req, res) => {
  try {
    const request = GenerateSpecRequest.parse(req.body);
    const intent = await mcp.execute("classify_intent", { prompt: request.prompt });
    const spec = await mcp.execute("generate_spec", {
      prompt: request.prompt,
      data_schema: request.data_schema,
    });

    if (!request.skip_validation) {
      const validation = await mcp.execute("validate_spec", {
        spec,
        data_schema: request.data_schema,
      });
      if (!validation.valid) {
        return res.status(400).json({ error: "Spec validation failed", details: validation.warnings });
      }
    }

    res.json({ spec, intent });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error? error.message : "Bad request" });
  }
});

// Start the MCP server
mcp.start(3000);
console.log("MCP server running on http://localhost:3000");