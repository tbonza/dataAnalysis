import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildChart, encodedFields, getChart, listChartTypes, resolveChartType } from "./chart.js";
import { validateChart } from "./validate.js";
import { ChartSpec } from "./schemas.js";

const ROWS = [
  { region: "East", revenue: 200 },
  { region: "West", revenue: 250 },
  { region: "North", revenue: 90 },
];
const SEMANTICS = { region: "Region", revenue: "Amount" };
const COLUMNS = ["region", "revenue"];

describe("resolveChartType", () => {
  it("maps an agent short name to a flint template", () => {
    assert.equal(resolveChartType("bar"), "Bar Chart");
    assert.equal(resolveChartType("scatter"), "Scatter Plot");
  });

  it("honours the legacy aliases upstream still carries", () => {
    assert.equal(resolveChartType("point"), "Scatter Plot");
    assert.equal(resolveChartType("group_bar"), "Grouped Bar Chart");
  });

  it("passes through a real template name", () => {
    assert.equal(resolveChartType("Violin Plot"), "Violin Plot");
  });

  it("falls back rather than failing on nonsense", () => {
    assert.equal(resolveChartType("interpretive dance"), "Scatter Plot");
    assert.equal(resolveChartType(undefined), "Scatter Plot");
  });
});

describe("listChartTypes", () => {
  it("is generated from flint, so it cannot drift", () => {
    const types = listChartTypes();
    assert.ok(types.length > 20, `expected flint's full catalog, got ${types.length}`);
    const bar = types.find((t) => t.chartType === "Bar Chart");
    assert.ok(bar);
    assert.ok(bar.channels.includes("x") && bar.channels.includes("y"));
  });
});

describe("buildChart", () => {
  it("compiles a spec to Vega-Lite and registers it by id", () => {
    const chart = buildChart({
      datasetId: "ds-test",
      rows: ROWS,
      chartSpec: ChartSpec.parse({
        chartType: "bar",
        title: "West leads on revenue",
        encodings: { x: "region", y: "revenue" },
      }),
      semanticTypes: SEMANTICS,
    });

    assert.equal(chart.chartType, "Bar Chart");
    assert.equal(chart.vlSpec["mark"], "bar");
    assert.deepEqual(chart.warnings.filter((w) => w.severity === "error"), []);
    assert.equal(getChart(chart.id).id, chart.id);
  });

  it("embeds the data, since the client renders and the server does not", () => {
    const chart = buildChart({
      datasetId: "ds-test",
      rows: ROWS,
      chartSpec: ChartSpec.parse({ chartType: "bar", encodings: { x: "region", y: "revenue" } }),
    });
    const data = chart.vlSpec["data"] as { values?: unknown[] };
    assert.equal(data.values?.length, ROWS.length);
  });

  it("recommends encodings via flint when none are given", () => {
    const chart = buildChart({
      datasetId: "ds-test",
      rows: ROWS,
      chartSpec: ChartSpec.parse({ chartType: "Bar Chart", encodings: {} }),
      semanticTypes: SEMANTICS,
    });
    assert.deepEqual(Object.keys(chart.chartSpec.encodings).sort(), ["x", "y"]);
  });

  it("renames the agent-facing `facet` channel to flint's `column`", () => {
    const chart = buildChart({
      datasetId: "ds-test",
      rows: ROWS,
      chartSpec: ChartSpec.parse({
        chartType: "Bar Chart",
        encodings: { x: "region", y: "revenue", facet: "region" },
      }),
    });
    assert.ok("column" in chart.chartSpec.encodings);
    assert.ok(!("facet" in chart.chartSpec.encodings));
  });

  it("throws with a known id when a chart is missing", () => {
    assert.throws(() => getChart("chart-nope"), /Unknown chart_id "chart-nope"/);
  });
});

describe("encodedFields", () => {
  it("reads flint's shorthand, object and static-series forms", () => {
    assert.deepEqual(
      encodedFields({ x: "a", y: { field: "b" }, color: ["c", { field: "d" }] }).sort(),
      ["a", "b", "c", "d"]
    );
  });
});

describe("validateChart", () => {
  const spec = (over: Partial<ChartSpec>) =>
    ChartSpec.parse({ chartType: "Bar Chart", encodings: { x: "region", y: "revenue" }, ...over });

  it("accepts a well-formed spec", () => {
    const result = validateChart({ chartSpec: spec({}), columns: COLUMNS });
    assert.equal(result.valid, true);
    assert.deepEqual(result.errors, []);
  });

  it("names the available columns when a field is missing", () => {
    const result = validateChart({
      chartSpec: spec({ encodings: { x: "region", y: "profit" } }),
      columns: COLUMNS,
    });
    assert.equal(result.valid, false);
    assert.match(result.errors.join(" "), /"profit".*Available columns: region, revenue/s);
  });

  it("rejects a channel the chart type does not have, and lists the real ones", () => {
    const result = validateChart({
      chartSpec: spec({ encodings: { x: "region", longitude: "revenue" } }),
      columns: COLUMNS,
    });
    assert.equal(result.valid, false);
    assert.match(result.errors.join(" "), /no channel "longitude"/);
  });

  it("rejects an unknown chart type before flint can throw", () => {
    const result = validateChart({
      chartSpec: { chartType: "Pretty Picture", encodings: { x: "region" } },
      columns: COLUMNS,
    });
    assert.equal(result.valid, false);
    assert.match(result.errors.join(" "), /Unknown chartType.*list_chart_types/s);
  });

  it("treats flint's error warnings as failures but keeps advisory ones", () => {
    const withWarnings = validateChart({
      chartSpec: spec({}),
      columns: COLUMNS,
      warnings: [
        { severity: "info", code: "fyi", message: "just so you know" },
        { severity: "error", code: "bad_encoding", message: "cannot encode that" },
      ],
    });
    assert.equal(withWarnings.valid, false);
    assert.match(withWarnings.errors.join(" "), /bad_encoding/);
    assert.equal(withWarnings.warnings.length, 2);
  });
});
