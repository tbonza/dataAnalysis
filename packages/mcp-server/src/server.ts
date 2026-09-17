import { createServer } from "node:http";
import { hostHeaderValidation, originValidation, toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import { buildChart, getChart, listChartTypes, listThemes } from "./chart.js";
import {
  ALLOWED_HOSTS,
  ALLOWED_ORIGINS,
  HEALTH_PATH,
  HOST,
  MCP_PATH,
  MCP_SERVER_NAME,
  MCP_SERVER_VERSION,
  PORT,
  QUERY_PREVIEW_ROWS,
} from "./constants.js";
import { buildCatalog, datasetsSkill } from "./datasets.js";
import {
  closeEngine,
  execSql,
  getDataset,
  loadCatalogDataset,
  loadDataset,
  registerResult,
  sampleRows,
  summarizeDataset,
  tableSql,
} from "./duckdb.js";
import { buildPromptLibrary, jobRoles, promptMetaFor, promptNameFor } from "./prompts.js";
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

/** Tool results carry structured output; the text block is what a human reads in a log. */
function result(text: string, structured: Record<string, unknown>) {
  return { content: [{ type: "text" as const, text }], structuredContent: structured };
}

/**
 * Startup is async now: building the catalog means introspecting the tables actually
 * present in the attached, read-only catalog database (see datasets.ts), which needs
 * the DuckDB engine up first. This is intentional — "load a DuckDBInstance ... upon
 * MCP server startup" is exactly what a prebuilt-catalog architecture asks for.
 */
async function main(): Promise<void> {
  // Read once: `createMcpHandler` builds a server per request.
  const SKILLS = loadSkills();
  const CATALOG = await buildCatalog(datasetsSkill(SKILLS));
  const DATASET_NAMES = CATALOG.map((entry) => entry.name);

  // `load_available_dataset` mints a fresh table on every call unless memoized here —
  // this map lives outside `buildServer` so it survives across the per-request server
  // instances `createMcpHandler` builds.
  const loadedDatasetIds = new Map<string, string>();

  const PROMPT_LIBRARY = buildPromptLibrary(jobRoles(SKILLS));

  // Two prompts minting the same MCP prompt name would silently overwrite one another
  // in the registry, so this is a startup failure rather than a runtime surprise.
  {
    const seen = new Map<string, string>();
    for (const prompt of PROMPT_LIBRARY) {
      const name = promptNameFor(prompt);
      const label = `${prompt.role} / ${prompt.dataset} / ${prompt.title}`;
      const clash = seen.get(name);
      if (clash) throw new Error(`Prompt name "${name}" collides: "${clash}" and "${label}".`);
      seen.set(name, label);
    }
  }

  const INSTRUCTIONS = [
    "Data analysis and charting over tabular data. Deterministic: this server has no model of its own —",
    "you author the specs, it executes and validates them.",
    "",
    "Flow: load_data -> inspect_dataset -> query -> create_chart. Each query result becomes a dataset of",
    "its own, so multi-step work is a sequence of queries. create_chart returns a Vega-Lite spec as JSON;",
    "rendering is the client's job, not this server's.",
    "",
    ...(DATASET_NAMES.length
      ? [
          "Before asking the user for data, check list_available_datasets -> load_available_dataset for a",
          "packaged dataset that already covers the question.",
          "",
        ]
      : []),
    ...(PROMPT_LIBRARY.length
      ? [
          "If the user identifies as a role (CEO, CFO, CRO, CPO, COO, ...), the job-roles skill has that",
          "role's framing — read it before answering.",
          "",
        ]
      : []),
    "Read the relevant skill resource before authoring anything: " +
      (SKILLS.length ? SKILLS.map((s) => s.uri).join(", ") : "(no skills installed)") +
      ".",
  ].join("\n");

  function buildServer(): McpServer {
    const server = new McpServer(
      { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
      { instructions: INSTRUCTIONS }
    );

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

    // --- the executive prompt library, one MCP prompt per recommended prompt -----
    for (const prompt of PROMPT_LIBRARY) {
      server.registerPrompt(
        promptNameFor(prompt),
        {
          title: prompt.title,
          description: `${prompt.role}, over ${prompt.dataset}: ${prompt.title}.`,
          _meta: promptMetaFor(prompt),
        },
        async () => ({
          description: prompt.title,
          messages: [{ role: "user" as const, content: { type: "text" as const, text: prompt.text } }],
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

    // Both tools are skipped when there are no packaged datasets: zod rejects an empty
    // `z.enum([])`, and there would be nothing for either tool to do.
    if (DATASET_NAMES.length > 0) {
      server.registerTool(
        "list_available_datasets",
        {
          title: "List Available Datasets",
          description:
            "Packaged datasets available to load — proprietary data this server ships, not yet loaded " +
            "as a dataset. Each entry's referenceUri is a resource documenting its columns; a catalog " +
            "`name` is not a datasetId. Call load_available_dataset to mint one.",
          inputSchema: z.object({}),
          outputSchema: z.object({
            datasets: z.array(
              z.object({ name: z.string(), description: z.string(), referenceUri: z.string() })
            ),
          }),
          annotations: { readOnlyHint: true, idempotentHint: true },
        },
        async () => {
          return result(
            CATALOG.map((entry) => `${entry.name} — ${entry.description}`).join("\n"),
            {
              datasets: CATALOG.map(({ name, description, referenceUri }) => ({
                name,
                description,
                referenceUri,
              })),
            }
          );
        }
      );

      server.registerTool(
        "load_available_dataset",
        {
          title: "Load Available Dataset",
          description:
            "Load a packaged dataset by its catalog name and return its id, columns, and a per-field " +
            "summary — the same shape load_data returns. Loading the same name twice reuses the same " +
            "datasetId rather than duplicating the table.",
          inputSchema: z.object({
            name: z.enum(DATASET_NAMES as [string, ...string[]]),
          }),
          outputSchema: z.object({
            datasetId: z.string(),
            columns: z.array(DatasetColumnSchema),
            rowCount: z.number(),
            summary: z.array(z.string()),
          }),
        },
        async ({ name }) => {
          const cached = loadedDatasetIds.get(name);
          if (cached) {
            const dataset = getDataset(cached);
            const summary = await summarizeDataset(dataset.id);
            return result(`${dataset.id} (already loaded, ${dataset.rowCount} rows).\n${summary.join("\n")}`, {
              datasetId: dataset.id,
              columns: dataset.columns,
              rowCount: dataset.rowCount,
              summary,
            });
          }

          // The table already exists, fully built, in the attached read-only catalog —
          // this just probes it and mints a datasetId, no data movement.
          const dataset = await loadCatalogDataset(name);
          loadedDatasetIds.set(name, dataset.id);
          const summary = await summarizeDataset(dataset.id);
          return result(`Loaded ${dataset.rowCount} rows as ${dataset.id}.\n${summary.join("\n")}`, {
            datasetId: dataset.id,
            columns: dataset.columns,
            rowCount: dataset.rowCount,
            summary,
          });
        }
      );
    }

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
        // A spatialJoin names a second dataset. getDataset throws listing the loaded ids
        // if it isn't there — the same repair path as an unknown primary datasetId.
        const other = spec.spatialJoin ? getDataset(spec.spatialJoin.datasetId) : undefined;
        const { sql } = compileQuery(source, spec, other);
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
            previewRows: rows.slice(0, QUERY_PREVIEW_ROWS),
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
        const rows = await execSql(`SELECT * FROM ${tableSql(dataset.table)}`);
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
  // on plain node:http they have to be wired in by hand. The allow-lists are localhost
  // only unless MCP_ALLOWED_HOSTS / MCP_ALLOWED_ORIGINS name something else.
  const validateHost = hostHeaderValidation(ALLOWED_HOSTS);
  const validateOrigin = originValidation(ALLOWED_ORIGINS);

  const httpServer = createServer((req, res) => {
    if (!validateHost(req, res) || !validateOrigin(req, res)) return;

    const path = new URL(req.url ?? "/", `http://${HOST}:${PORT}`).pathname;

    if (path === MCP_PATH) {
      // The adapter duck-types the request as `{ method?: string; url?: string }`,
      // which `exactOptionalPropertyTypes` rejects against Node's
      // `string | undefined`. Structurally compatible at runtime.
      void nodeHandler(req as Parameters<typeof nodeHandler>[0], res);
      return;
    }
    if (path === HEALTH_PATH) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          status: "ok",
          skills: SKILLS.map((s) => s.name),
          datasets: DATASET_NAMES,
          prompts: PROMPT_LIBRARY.map((p) => promptNameFor(p)),
        })
      );
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
      await closeEngine();
      process.exit(0);
    })();
  });
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
