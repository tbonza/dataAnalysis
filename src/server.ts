import { createServer } from "node:http";
import {
  localhostHostValidation,
  localhostOriginValidation,
  toNodeHandler,
} from "@modelcontextprotocol/node";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import { classifyIntent } from "./agents/intentRouter.js";
import { generateSpec } from "./agents/specGenerator.js";
import { validateSpec } from "./agents/validator.js";
import { DataSchemaField, ValidationResult, VegaLiteSpec } from "./schemas.js";
import { MODEL_ID, REGION } from "./model.js";

const PORT = Number(process.env.PORT ?? 3000);
const HOST = "127.0.0.1";

// Build the MCP server. `createMcpHandler` calls this per request, so keep it
// cheap and side-effect-free.
function buildServer(): McpServer {
  const server = new McpServer({ name: "chart", version: "1.0.0" });

  server.registerTool(
    "classify_intent",
    {
      title: "Classify Intent",
      description:
        "Classify a chart prompt as 'data' (full spec generation) or 'style' (restyle an existing chart).",
      inputSchema: z.object({
        prompt: z.string().describe("The user's chart request"),
      }),
      outputSchema: z.object({ intent: z.enum(["data", "style"]) }),
      annotations: { readOnlyHint: true },
    },
    async ({ prompt }) => {
      const intent = await classifyIntent(prompt);
      return { content: [{ type: "text", text: intent }], structuredContent: { intent } };
    }
  );

  server.registerTool(
    "generate_spec",
    {
      title: "Generate Vega-Lite Spec",
      description: "Generate a Vega-Lite spec from a prompt and data schema.",
      inputSchema: z.object({
        prompt: z.string().describe("The user's chart request"),
        data_schema: z.array(DataSchemaField).describe("Available fields and their types"),
      }),
      outputSchema: VegaLiteSpec,
      annotations: { readOnlyHint: true },
    },
    async ({ prompt, data_schema }) => {
      const spec = await generateSpec({ prompt, data_schema });
      return {
        content: [{ type: "text", text: JSON.stringify(spec, null, 2) }],
        structuredContent: spec,
      };
    }
  );

  server.registerTool(
    "validate_spec",
    {
      title: "Validate Vega-Lite Spec",
      description: "Validate a Vega-Lite spec's shape and check its encodings against a data schema.",
      inputSchema: z.object({
        spec: z.unknown().describe("The Vega-Lite spec to validate"),
        data_schema: z.array(DataSchemaField).describe("Fields the spec is allowed to reference"),
      }),
      outputSchema: ValidationResult,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ spec, data_schema }) => {
      const result = validateSpec({ spec, data_schema });
      return {
        content: [
          {
            type: "text",
            text: result.valid ? "Spec is valid." : `Invalid:\n${result.warnings.join("\n")}`,
          },
        ],
        structuredContent: result,
      };
    }
  );

  return server;
}

const handler = createMcpHandler(buildServer);
const nodeHandler = toNodeHandler(handler);

// The Hono and Express adapters arm these DNS-rebinding guards automatically;
// on plain node:http they have to be wired in by hand.
const validateHost = localhostHostValidation();
const validateOrigin = localhostOriginValidation();

const httpServer = createServer((req, res) => {
  if (!validateHost(req, res) || !validateOrigin(req, res)) return;

  const path = new URL(req.url ?? "/", `http://${HOST}:${PORT}`).pathname;

  if (path === "/mcp") {
    // The adapter duck-types the request as `{ method?: string; url?: string }`,
    // which `exactOptionalPropertyTypes` rejects against Node's
    // `string | undefined`. Structurally compatible at runtime.
    void nodeHandler(req as Parameters<typeof nodeHandler>[0], res);
    return;
  }
  if (path === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

httpServer.listen(PORT, HOST, () => {
  console.error(`Chart MCP server on http://${HOST}:${PORT}/mcp`);
  console.error(`Model: ${MODEL_ID} (${REGION})`);
});

process.on("SIGINT", () => {
  void (async () => {
    await handler.close();
    httpServer.close();
    process.exit(0);
  })();
});
