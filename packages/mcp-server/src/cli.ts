import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

/**
 * Smoke test for the MCP server, driven without any model.
 *
 * That it works with no LLM and no credentials is the point: everything an agent
 * needs to drive this server is in the tool schemas and the skill resources.
 */

const URL_ = process.env.MCP_URL ?? "http://127.0.0.1:3000/mcp";

const ROWS = [
  { region: "East", product: "Widget", revenue: 120, units: 10 },
  { region: "East", product: "Gadget", revenue: 80, units: 5 },
  { region: "West", product: "Widget", revenue: 200, units: 25 },
  { region: "West", product: "Gadget", revenue: 50, units: 2 },
  { region: "North", product: "Widget", revenue: 90, units: 9 },
];

/** Pull the structured payload out of a tool result, falling back to text blocks. */
function resultOf(result: { structuredContent?: unknown; content: unknown[] }): unknown {
  if (result.structuredContent !== undefined) return result.structuredContent;
  return result.content
    .filter((b): b is { type: "text"; text: string } => (b as { type?: string }).type === "text")
    .map((b) => b.text)
    .join("\n");
}

function section(title: string): void {
  console.log(`\n${"─".repeat(64)}\n${title}\n`);
}

async function main(): Promise<void> {
  const client = new Client({ name: "chart-cli", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(URL_)));

  try {
    section("Capabilities");
    const { tools } = await client.listTools();
    console.log("tools:    ", tools.map((t) => t.name).join(", "));
    const { resources } = await client.listResources();
    console.log("resources:", resources.map((r) => r.uri).join(", ") || "(none)");
    const { prompts } = await client.listPrompts();
    console.log("prompts:  ", prompts.map((p) => p.name).join(", ") || "(none)");

    const call = async (name: string, args: Record<string, unknown>) => {
      const raw = await client.callTool({ name, arguments: args });
      const value = resultOf(raw as { structuredContent?: unknown; content: unknown[] });
      if ((raw as { isError?: boolean }).isError) throw new Error(`${name} failed: ${JSON.stringify(value)}`);
      return value as Record<string, unknown>;
    };

    section("1. load_data");
    const loaded = await call("load_data", { rows: ROWS, name: "sales" });
    const datasetId = String(loaded["dataset_id"]);
    console.log(`${datasetId} — ${String(loaded["row_count"])} rows`);
    for (const line of loaded["summary"] as string[]) console.log(`  ${line}`);

    section("2. query — revenue per region, plus a computed unit price");
    const queried = await call("query", {
      dataset_id: datasetId,
      spec: {
        compute: [{ as: "unit_price", left: "revenue", op: "/", right: "units" }],
        groupBy: ["region"],
        aggregate: [
          { op: "sum", column: "revenue", as: "total_revenue" },
          { op: "avg", column: "unit_price", as: "avg_unit_price" },
        ],
        orderBy: [{ column: "total_revenue", direction: "desc" }],
      },
    });
    console.log("SQL:", queried["sql"]);
    console.log("rows:", JSON.stringify(queried["preview_rows"]));

    section("3. create_chart on the query result");
    const chart = await call("create_chart", {
      dataset_id: queried["dataset_id"],
      chart_spec: {
        chartType: "bar",
        title: "West leads on total revenue",
        subtitle: "Revenue by region, all products, USD",
        encodings: { x: "region", y: "total_revenue" },
      },
      semantic_types: { region: "Region", total_revenue: "Amount" },
    });
    const chartId = String(chart["chart_id"]);
    console.log(`${chartId} — ${String(chart["chart_type"])}, valid=${String(chart["valid"])}`);
    const vlSpec = chart["vl_spec"] as Record<string, unknown>;
    console.log("mark:", JSON.stringify(vlSpec["mark"]), "encoding:", Object.keys((vlSpec["encoding"] ?? {}) as object).join(","));

    section("4. prepare_restyle / apply_restyle");
    const prepared = await call("prepare_restyle", { chart_id: chartId });
    const stripped = prepared["spec_without_data"] as Record<string, unknown>;
    console.log("data stripped:", !("data" in stripped));
    console.log("sample:", JSON.stringify((prepared["data_sample"] as unknown[]).slice(0, 2)));

    // Stand in for what a model would author: recolour without touching the encodings.
    const edited = { ...stripped, mark: { type: "bar", color: "green" } };
    const restyled = await call("apply_restyle", {
      chart_id: chartId,
      vl_spec: edited,
      config_ui: [
        { key: "opacity", label: "opacity", path: ["mark", "opacity"], type: "continuous", min: 0.1, max: 1, step: 0.1, defaultValue: 1 },
        { key: "bad", label: "unsafe", path: ["__proto__", "x"], type: "binary", defaultValue: true },
      ],
    });
    console.log(`variant ${String(restyled["chart_id"])}`);
    console.log("controls kept:", JSON.stringify((restyled["config_ui"] as Array<{ key: string }>).map((c) => c.key)));
    console.log("warnings:", JSON.stringify(restyled["warnings"]));
    console.log("data re-attached:", "data" in (restyled["vl_spec"] as Record<string, unknown>));

    section("5. create_report embedding the chart by id");
    const report = await call("create_report", {
      title: "Regional revenue",
      sections: [
        { markdown: "West leads on revenue despite a lower unit price.", chartId },
      ],
    });
    console.log(report["markdown"]);

    section("6. Repairable errors (what a consuming agent relies on)");
    for (const [label, args] of [
      ["unknown column", { dataset_id: datasetId, spec: { select: ["revenue", "profit"] } }],
      ["ungrouped select", { dataset_id: datasetId, spec: { select: ["region", "product"], groupBy: ["region"], aggregate: [{ op: "sum", column: "revenue", as: "t" }] } }],
    ] as const) {
      try {
        await call("query", args as Record<string, unknown>);
        console.log(`${label}: UNEXPECTEDLY SUCCEEDED`);
      } catch (err) {
        console.log(`${label}: ${String((err as Error).message).slice(0, 160)}`);
      }
    }

    section("Done");
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
