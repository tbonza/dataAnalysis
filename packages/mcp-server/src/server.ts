import { createServer } from "node:http";
import {
  localhostHostValidation,
  localhostOriginValidation,
  toNodeHandler,
} from "@modelcontextprotocol/node";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import { buildChart, getChart, listChartTypes, listThemes } from "./chart.js";
import {
  execSql,
  getDataset,
  loadDataset,
  registerResult,
  sampleRows,
  summarizeDataset,
} from "./duckdb.js";
import { QuerySpec, compileQuery } from "./query.js";
import { ReportRequest, createReport } from "./report.js";
import { applyRestyle, prepareRestyle } from "./restyle.js";
import {
  ChartSpec,
  ChartWarning,
  ConfigControl,
  DataRow,
  DatasetColumnSchema,
  SemanticTypeMap,
  ValidationResult,
  VegaLiteSpec,
} from "./schemas.js";
import { loadSkills } from "./skills.js";
import { validateChart } from "./validate.js";

const PORT = Number(process.env.PORT ?? 3000);
const HOST = "127.0.0.1";

// Read once: `createMcpHandler` builds a server per request.
const SKILLS = loadSkills();

const INSTRUCTIONS = [
  "Data analysis and charting over tabular data. Deterministic: this server has no model of its own —",
  "you author the specs, it executes and validates them.",
  "",
  "Flow: load_data -> inspect_dataset -> query -> create_chart. Each query result becomes a dataset of",
  "its own, so multi-step work is a sequence of queries. create_chart returns a Vega-Lite spec as JSON;",
  "rendering is the client's job, not this server's.",
  "",
  "Read the relevant skill resource before authoring anything: " +
    (SKILLS.length ? SKILLS.map((s) => s.uri).join(", ") : "(no skills installed)") +
    ".",
].join("\n");

/** Tool results carry structured output; the text block is what a human reads in a log. */
function result(text: string, structured: Record<string, unknown>) {
  return { content: [{ type: "text" as const, text }], structuredContent: structured };
}

function buildServer(): McpServer {
  const server = new McpServer({ name: "chart", version: "1.0.0" }, { instructions: INSTRUCTIONS });

  // --- skills, as resources plus a prompt each ---------------------------------
  for (const skill of SKILLS) {
    server.registerResource(
      `skill-${skill.name}`,
      skill.uri,
      {
        title: `Skill: ${skill.name}`,
        description: skill.description,
        mimeType: "text/markdown",
        annotations: { audience: ["assistant"], priority: 1 },
      },
      async (uri) => ({
        contents: [{ uri: uri.href, mimeType: "text/markdown", text: skill.text }],
      })
    );

    // The spec's third disclosure tier: detail an agent loads only when it needs it.
    for (const reference of skill.references) {
      server.registerResource(
        `skill-${skill.name}-${reference.relativePath.replace(/[^a-z0-9]+/gi, "-")}`,
        reference.uri,
        {
          title: `${skill.name}: ${reference.relativePath}`,
          description: `Reference material for the ${skill.name} skill.`,
          mimeType: "text/markdown",
          // `priority` is a 0-1 importance, not a rank: references matter less than
          // the skill body that points at them.
          annotations: { audience: ["assistant"], priority: 0.5 },
        },
        async (uri) => ({
          contents: [{ uri: uri.href, mimeType: "text/markdown", text: reference.text }],
        })
      );
    }

    server.registerPrompt(
      `load_${skill.name.replace(/-/g, "_")}_skill`,
      { title: `Load the ${skill.name} skill`, description: skill.description },
      async () => ({
        description: `Instructions for ${skill.name}.`,
        messages: [
          { role: "user" as const, content: { type: "text" as const, text: skill.text } },
        ],
      })
    );
  }

  // --- data --------------------------------------------------------------------
  server.registerTool(
    "load_data",
    {
      title: "Load Data",
      description:
        "Load inline rows as a queryable dataset and return its id, columns, and a per-field summary.",
      inputSchema: z.object({
        rows: z
          .array(DataRow)
          .min(1)
          .describe("Array of row objects, all sharing the same keys."),
        name: z.string().optional().describe("A label for the dataset, used only in messages."),
      }),
      outputSchema: z.object({
        datasetId: z.string(),
        columns: z.array(DatasetColumnSchema),
        rowCount: z.number(),
        summary: z.array(z.string()),
      }),
    },
    async ({ rows, name }) => {
      const dataset = await loadDataset(rows, name ?? "data");
      const summary = await summarizeDataset(dataset.id);
      return result(
        `Loaded ${dataset.rowCount} rows as ${dataset.id}.\n${summary.join("\n")}`,
        {
          datasetId: dataset.id,
          columns: dataset.columns,
          rowCount: dataset.rowCount,
          summary,
        }
      );
    }
  );

  server.registerTool(
    "inspect_dataset",
    {
      title: "Inspect Dataset",
      description:
        "Field types, distinct-value samples, and example rows. Read the values before charting — " +
        "column names alone hide embedded totals, percent-vs-fraction units, and single-value breakdowns.",
      inputSchema: z.object({ datasetId: z.string() }),
      outputSchema: z.object({
        datasetId: z.string(),
        rowCount: z.number(),
        columns: z.array(DatasetColumnSchema),
        summary: z.array(z.string()),
        sampleRows: z.array(DataRow),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ datasetId }) => {
      const dataset = getDataset(datasetId);
      const [summary, samples] = await Promise.all([
        summarizeDataset(datasetId),
        sampleRows(datasetId),
      ]);
      return result(`${dataset.name} (${dataset.rowCount} rows)\n${summary.join("\n")}`, {
        datasetId: dataset.id,
        rowCount: dataset.rowCount,
        columns: dataset.columns,
        summary,
        sampleRows: samples,
      });
    }
  );

  server.registerTool(
    "query",
    {
      title: "Query Dataset",
      description:
        "Filter, group, aggregate, compute and sort a dataset with a structured spec — no SQL text. " +
        "The result is registered as a new dataset, so chain queries for multi-step work. " +
        "See the data-query skill for the grammar.",
      inputSchema: z.object({
        datasetId: z.string(),
        spec: QuerySpec,
      }),
      outputSchema: z.object({
        datasetId: z.string(),
        sourceDatasetId: z.string(),
        columns: z.array(DatasetColumnSchema),
        rowCount: z.number(),
        previewRows: z.array(DataRow),
        sql: z.string(),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ datasetId, spec }) => {
      const source = getDataset(datasetId);
      const { sql } = compileQuery(source, spec);
      const { rows, columns } = await execSql(sql);
      if (rows.length === 0) {
        // An empty result is nearly always a filter mistake, and charting it produces
        // a blank plot rather than an error, so say so here.
        return result(`Query returned 0 rows.\nSQL: ${sql}`, {
          datasetId,
          sourceDatasetId: datasetId,
          columns,
          rowCount: 0,
          previewRows: [],
          sql,
        });
      }
      const derived = await registerResult(rows, columns, `${source.name}_q`);
      return result(
        `${derived.rowCount} rows as ${derived.id} (${columns.map((c) => c.name).join(", ")}).\nSQL: ${sql}`,
        {
          datasetId: derived.id,
          sourceDatasetId: datasetId,
          columns,
          rowCount: derived.rowCount,
          previewRows: rows.slice(0, 10),
          sql,
        }
      );
    }
  );

  // --- charts ------------------------------------------------------------------
  server.registerTool(
    "create_chart",
    {
      title: "Create Chart",
      description:
        "Compile a chart spec into a Vega-Lite spec for the client to render. Returns a chartId " +
        "usable by inspect_chart, prepare_restyle and create_report. See the chart-author skill.",
      inputSchema: z.object({
        datasetId: z.string(),
        chartSpec: ChartSpec,
        semanticTypes: SemanticTypeMap.optional().describe(
          'Field to semantic type, e.g. { revenue: "Amount" }. Drives formatting and colour choices.'
        ),
        themeSpec: z
          .union([z.string(), z.record(z.string(), z.unknown())])
          .optional()
          .describe(
            'A visual theme: a preset id from list_themes (e.g. "economist"), or an object with ' +
              "`extends` plus overrides. See the theme-author skill."
          ),
      }),
      outputSchema: z.object({
        chartId: z.string(),
        chartType: z.string(),
        vlSpec: VegaLiteSpec,
        chartSpec: ChartSpec,
        // Spread rather than nest: validation's three fields are returned flat here,
        // and ValidationResult is the schema that defines them.
        ...ValidationResult.shape,
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ datasetId, chartSpec, semanticTypes, themeSpec }) => {
      const dataset = getDataset(datasetId);
      const rows = await execSql(`SELECT * FROM "${dataset.table}"`);
      const columns = dataset.columns.map((c) => c.name);

      // Assemble first, then validate what was actually built. Validating the raw
      // spec would reject the short chart-type names the alias table exists to
      // accept, and would fire before the encoding fallback had a chance to fill in
      // omitted channels.
      let chart;
      try {
        chart = buildChart({
          datasetId,
          rows: rows.rows,
          chartSpec,
          // Spread rather than pass `undefined`: `exactOptionalPropertyTypes` treats an
          // explicit undefined as a different type from an absent key.
          ...(semanticTypes === undefined ? {} : { semanticTypes }),
          ...(themeSpec === undefined ? {} : { themeSpec }),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const errors = [
          `${message} Available columns: ${columns.join(", ")}. Call list_chart_types for valid chart types.`,
        ];
        return {
          content: [{ type: "text" as const, text: errors[0]! }],
          structuredContent: {
            chartId: "",
            chartType: chartSpec.chartType,
            vlSpec: {},
            chartSpec,
            valid: false,
            errors,
            warnings: [],
          },
          isError: true,
        };
      }

      const validation = validateChart({
        chartSpec: chart.chartSpec,
        columns,
        warnings: chart.warnings,
      });

      return result(
        `${chart.chartType} as ${chart.id}` +
          (validation.errors.length ? `\n${validation.errors.join("\n")}` : ""),
        {
          chartId: chart.id,
          chartType: chart.chartType,
          vlSpec: chart.vlSpec,
          chartSpec: chart.chartSpec,
          valid: validation.valid,
          errors: validation.errors,
          warnings: chart.warnings,
        }
      );
    }
  );

  server.registerTool(
    "inspect_chart",
    {
      title: "Inspect Chart",
      description: "The spec, chart type and warnings of a chart you already created.",
      inputSchema: z.object({ chartId: z.string() }),
      outputSchema: z.object({
        chartId: z.string(),
        chartType: z.string(),
        chartSpec: ChartSpec,
        datasetId: z.string(),
        vlSpec: VegaLiteSpec,
        warnings: z.array(ChartWarning),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ chartId }) => {
      const chart = getChart(chartId);
      return result(`${chart.chartType} (${chart.id})`, {
        chartId: chart.id,
        chartType: chart.chartType,
        chartSpec: chart.chartSpec,
        datasetId: chart.datasetId,
        vlSpec: chart.vlSpec,
        warnings: chart.warnings,
      });
    }
  );

  server.registerTool(
    "list_chart_types",
    {
      title: "List Chart Types",
      description: "Every chart type and its encoding channels.",
      inputSchema: z.object({}),
      outputSchema: z.object({
        chartTypes: z.array(z.object({ chartType: z.string(), channels: z.array(z.string()) })),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async () => {
      const types = listChartTypes();
      return result(types.map((t) => `${t.chartType}: ${t.channels.join(", ")}`).join("\n"), {
        chartTypes: types,
      });
    }
  );

  server.registerTool(
    "list_themes",
    {
      title: "List Themes",
      description:
        "Visual theme presets for create_chart's themeSpec. Prefer a preset id; extend one only " +
        "when the user asks for a specific look. See the theme-author skill.",
      inputSchema: z.object({}),
      outputSchema: z.object({
        themes: z.array(
          z.object({ id: z.string(), label: z.string(), description: z.string().optional() })
        ),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async () => {
      const themes = listThemes();
      return result(themes.map((t) => `${t.id} — ${t.label}`).join("\n"), { themes });
    }
  );

  // --- restyle -----------------------------------------------------------------
  server.registerTool(
    "prepare_restyle",
    {
      title: "Prepare Restyle",
      description:
        "The chart's Vega-Lite spec with its data removed, plus a sample of the rows it embeds. " +
        "Edit the spec and pass it to apply_restyle. See the chart-restyle skill.",
      inputSchema: z.object({ chartId: z.string() }),
      outputSchema: z.object({
        chartId: z.string(),
        chartType: z.string(),
        specWithoutData: VegaLiteSpec,
        dataSample: z.array(DataRow),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ chartId }) => {
      const prepared = prepareRestyle(chartId);
      return result(
        `${prepared.chartType} (${prepared.chartId}); do not include a data block in your edit.`,
        {
          chartId: prepared.chartId,
          chartType: prepared.chartType,
          specWithoutData: prepared.specWithoutData,
          dataSample: prepared.dataSample,
        }
      );
    }
  );

  server.registerTool(
    "apply_restyle",
    {
      title: "Apply Restyle",
      description:
        "Re-attach the chart's rows to your edited spec and register it as a new chart variant. " +
        "Optionally supply configUI controls for follow-up tweaks without another model call.",
      inputSchema: z.object({
        chartId: z.string(),
        vlSpec: VegaLiteSpec.describe("Your edited spec, with no data block."),
        // Validated against the real control shape rather than accepted as opaque
        // records: a malformed control is then a schema error the agent can repair,
        // instead of being silently dropped by sanitizeConfigUI. That sanitizer still
        // runs — it enforces the path-traversal rules zod cannot express.
        configUI: z
          .array(ConfigControl)
          .optional()
          .describe("2-4 follow-up controls; each is a path into the spec plus allowed values."),
      }),
      outputSchema: z.object({
        chartId: z.string(),
        vlSpec: VegaLiteSpec,
        configUI: z.array(ConfigControl),
        warnings: z.array(z.string()),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ chartId, vlSpec, configUI }) => {
      const restyled = applyRestyle({
        chartId,
        vlSpec,
        ...(configUI === undefined ? {} : { configUI }),
      });
      return result(
        `Restyled as ${restyled.chartId}` +
          (restyled.warnings.length ? `\n${restyled.warnings.join("\n")}` : ""),
        {
          chartId: restyled.chartId,
          vlSpec: restyled.vlSpec,
          configUI: restyled.configUI,
          warnings: restyled.warnings,
        }
      );
    }
  );

  // --- report ------------------------------------------------------------------
  server.registerTool(
    "create_report",
    {
      title: "Create Report",
      description:
        "Assemble your prose and existing charts into one Markdown document. Charts are embedded by " +
        "chartId rather than recreated. See the report skill.",
      inputSchema: ReportRequest,
      outputSchema: z.object({
        title: z.string(),
        markdown: z.string(),
        charts: z.array(
          z.object({
            chartId: z.string(),
            chartType: z.string(),
            vlSpec: VegaLiteSpec,
          })
        ),
      }),
      annotations: { readOnlyHint: true },
    },
    async (request) => {
      const report = createReport(request);
      return result(report.markdown, { ...report });
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
    res.end(JSON.stringify({ status: "ok", skills: SKILLS.map((s) => s.name) }));
    return;
  }
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

httpServer.listen(PORT, HOST, () => {
  console.error(`Chart MCP server on http://${HOST}:${PORT}/mcp`);
  console.error(
    SKILLS.length ? `Skills: ${SKILLS.map((s) => s.name).join(", ")}` : "No skills found."
  );
});

process.on("SIGINT", () => {
  void (async () => {
    await handler.close();
    httpServer.close();
    process.exit(0);
  })();
});
