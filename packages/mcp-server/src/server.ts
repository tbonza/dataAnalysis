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
import { ChartSpec, SemanticTypeMap } from "./schemas.js";
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
          .array(z.record(z.string(), z.unknown()))
          .min(1)
          .describe("Array of row objects, all sharing the same keys."),
        name: z.string().optional().describe("A label for the dataset, used only in messages."),
      }),
      outputSchema: z.object({
        dataset_id: z.string(),
        columns: z.array(z.object({ name: z.string(), type: z.string() })),
        row_count: z.number(),
        summary: z.array(z.string()),
      }),
    },
    async ({ rows, name }) => {
      const dataset = await loadDataset(rows, name ?? "data");
      const summary = await summarizeDataset(dataset.id);
      return result(
        `Loaded ${dataset.rowCount} rows as ${dataset.id}.\n${summary.join("\n")}`,
        {
          dataset_id: dataset.id,
          columns: dataset.columns,
          row_count: dataset.rowCount,
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
      inputSchema: z.object({ dataset_id: z.string() }),
      outputSchema: z.object({
        dataset_id: z.string(),
        row_count: z.number(),
        columns: z.array(z.object({ name: z.string(), type: z.string() })),
        summary: z.array(z.string()),
        sample_rows: z.array(z.record(z.string(), z.unknown())),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ dataset_id }) => {
      const dataset = getDataset(dataset_id);
      const [summary, samples] = await Promise.all([
        summarizeDataset(dataset_id),
        sampleRows(dataset_id),
      ]);
      return result(`${dataset.name} (${dataset.rowCount} rows)\n${summary.join("\n")}`, {
        dataset_id: dataset.id,
        row_count: dataset.rowCount,
        columns: dataset.columns,
        summary,
        sample_rows: samples,
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
        dataset_id: z.string(),
        spec: QuerySpec,
      }),
      outputSchema: z.object({
        dataset_id: z.string(),
        source_dataset_id: z.string(),
        columns: z.array(z.object({ name: z.string(), type: z.string() })),
        row_count: z.number(),
        preview_rows: z.array(z.record(z.string(), z.unknown())),
        sql: z.string(),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ dataset_id, spec }) => {
      const source = getDataset(dataset_id);
      const { sql } = compileQuery(source, spec);
      const { rows, columns } = await execSql(sql);
      if (rows.length === 0) {
        // An empty result is nearly always a filter mistake, and charting it produces
        // a blank plot rather than an error, so say so here.
        return result(`Query returned 0 rows.\nSQL: ${sql}`, {
          dataset_id,
          source_dataset_id: dataset_id,
          columns,
          row_count: 0,
          preview_rows: [],
          sql,
        });
      }
      const derived = await registerResult(rows, columns, `${source.name}_q`);
      return result(
        `${derived.rowCount} rows as ${derived.id} (${columns.map((c) => c.name).join(", ")}).\nSQL: ${sql}`,
        {
          dataset_id: derived.id,
          source_dataset_id: dataset_id,
          columns,
          row_count: derived.rowCount,
          preview_rows: rows.slice(0, 10),
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
        "Compile a chart spec into a Vega-Lite spec for the client to render. Returns a chart_id " +
        "usable by inspect_chart, prepare_restyle and create_report. See the chart-author skill.",
      inputSchema: z.object({
        dataset_id: z.string(),
        chart_spec: ChartSpec,
        semantic_types: SemanticTypeMap.optional().describe(
          'Field to semantic type, e.g. { revenue: "Amount" }. Drives formatting and colour choices.'
        ),
        theme_spec: z
          .union([z.string(), z.record(z.string(), z.unknown())])
          .optional()
          .describe(
            'A visual theme: a preset id from list_themes (e.g. "economist"), or an object with ' +
              "`extends` plus overrides. See the theme-author skill."
          ),
      }),
      outputSchema: z.object({
        chart_id: z.string(),
        chart_type: z.string(),
        vl_spec: z.record(z.string(), z.unknown()),
        chart_spec: ChartSpec,
        valid: z.boolean(),
        errors: z.array(z.string()),
        warnings: z.array(z.record(z.string(), z.unknown())),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ dataset_id, chart_spec, semantic_types, theme_spec }) => {
      const dataset = getDataset(dataset_id);
      const rows = await execSql(`SELECT * FROM "${dataset.table}"`);
      const columns = dataset.columns.map((c) => c.name);

      // Assemble first, then validate what was actually built. Validating the raw
      // spec would reject the short chart-type names the alias table exists to
      // accept, and would fire before the encoding fallback had a chance to fill in
      // omitted channels.
      let chart;
      try {
        chart = buildChart({
          datasetId: dataset_id,
          rows: rows.rows,
          chartSpec: chart_spec,
          ...(semantic_types === undefined ? {} : { semanticTypes: semantic_types }),
          ...(theme_spec === undefined ? {} : { themeSpec: theme_spec }),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const errors = [
          `${message} Available columns: ${columns.join(", ")}. Call list_chart_types for valid chart types.`,
        ];
        return {
          content: [{ type: "text" as const, text: errors[0]! }],
          structuredContent: {
            chart_id: "",
            chart_type: chart_spec.chartType,
            vl_spec: {},
            chart_spec,
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
          chart_id: chart.id,
          chart_type: chart.chartType,
          vl_spec: chart.vlSpec,
          chart_spec: chart.chartSpec,
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
      inputSchema: z.object({ chart_id: z.string() }),
      outputSchema: z.object({
        chart_id: z.string(),
        chart_type: z.string(),
        chart_spec: ChartSpec,
        dataset_id: z.string(),
        vl_spec: z.record(z.string(), z.unknown()),
        warnings: z.array(z.record(z.string(), z.unknown())),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ chart_id }) => {
      const chart = getChart(chart_id);
      return result(`${chart.chartType} (${chart.id})`, {
        chart_id: chart.id,
        chart_type: chart.chartType,
        chart_spec: chart.chartSpec,
        dataset_id: chart.datasetId,
        vl_spec: chart.vlSpec,
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
        chart_types: z.array(z.object({ chartType: z.string(), channels: z.array(z.string()) })),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async () => {
      const types = listChartTypes();
      return result(types.map((t) => `${t.chartType}: ${t.channels.join(", ")}`).join("\n"), {
        chart_types: types,
      });
    }
  );

  server.registerTool(
    "list_themes",
    {
      title: "List Themes",
      description:
        "Visual theme presets for create_chart's theme_spec. Prefer a preset id; extend one only " +
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
      inputSchema: z.object({ chart_id: z.string() }),
      outputSchema: z.object({
        chart_id: z.string(),
        chart_type: z.string(),
        spec_without_data: z.record(z.string(), z.unknown()),
        data_sample: z.array(z.record(z.string(), z.unknown())),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ chart_id }) => {
      const prepared = prepareRestyle(chart_id);
      return result(
        `${prepared.chartType} (${prepared.chartId}); do not include a data block in your edit.`,
        {
          chart_id: prepared.chartId,
          chart_type: prepared.chartType,
          spec_without_data: prepared.specWithoutData,
          data_sample: prepared.dataSample,
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
        chart_id: z.string(),
        vl_spec: z.record(z.string(), z.unknown()).describe("Your edited spec, with no data block."),
        config_ui: z
          .array(z.record(z.string(), z.unknown()))
          .optional()
          .describe("2-4 follow-up controls; each is a path into the spec plus allowed values."),
      }),
      outputSchema: z.object({
        chart_id: z.string(),
        vl_spec: z.record(z.string(), z.unknown()),
        config_ui: z.array(z.record(z.string(), z.unknown())),
        warnings: z.array(z.string()),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ chart_id, vl_spec, config_ui }) => {
      const restyled = applyRestyle({
        chartId: chart_id,
        vlSpec: vl_spec,
        ...(config_ui === undefined ? {} : { configUI: config_ui }),
      });
      return result(
        `Restyled as ${restyled.chartId}` +
          (restyled.warnings.length ? `\n${restyled.warnings.join("\n")}` : ""),
        {
          chart_id: restyled.chartId,
          vl_spec: restyled.vlSpec,
          config_ui: restyled.configUI,
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
        "chart_id rather than recreated. See the report skill.",
      inputSchema: ReportRequest,
      outputSchema: z.object({
        title: z.string(),
        markdown: z.string(),
        charts: z.array(
          z.object({
            chartId: z.string(),
            chartType: z.string(),
            vlSpec: z.record(z.string(), z.unknown()),
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
