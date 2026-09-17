import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { execSql, loadDataset, summarizeDataset, type Dataset } from "./duckdb.js";
import { QuerySpec, compileQuery } from "./query.js";

const ROWS = [
  { region: "East", product: "A", revenue: 120, units: 10 },
  { region: "East", product: "B", revenue: 80, units: 5 },
  { region: "West", product: "A", revenue: 200, units: 25 },
  { region: "West", product: "B", revenue: 50, units: 2 },
];

let sales: Dataset;

before(async () => {
  sales = await loadDataset(ROWS, "sales");
});

/** Compile and run in one step, the way the `query` tool does. */
async function run(spec: unknown) {
  const compiled = compileQuery(sales, QuerySpec.parse(spec));
  const { rows } = await execSql(compiled.sql);
  return { ...compiled, rows };
}

describe("dataset loading", () => {
  it("infers columns and row count from inline rows", () => {
    assert.equal(sales.rowCount, 4);
    assert.deepEqual(
      sales.columns.map((c) => c.name).sort(),
      ["product", "region", "revenue", "units"]
    );
  });

  it("summarizes each field with its distinct values", async () => {
    const lines = await summarizeDataset(sales.id);
    const region = lines.find((l) => l.startsWith("region "));
    assert.ok(region, "expected a summary line for `region`");
    assert.match(region, /distinct: 2/);
    assert.match(region, /East/);
  });
});

describe("query compilation", () => {
  it("groups, aggregates, aliases and sorts", async () => {
    const { sql, outputColumns, rows } = await run({
      groupBy: ["region"],
      aggregate: [
        { op: "sum", column: "revenue", as: "total" },
        { op: "count", as: "n" },
      ],
      orderBy: [{ column: "total", direction: "desc" }],
    });

    assert.deepEqual(outputColumns, ["region", "total", "n"]);
    assert.match(sql, /GROUP BY "region"/);
    assert.match(sql, /ORDER BY "total" DESC/);
    assert.deepEqual(rows, [
      { region: "West", total: 250, n: 2 },
      { region: "East", total: 200, n: 2 },
    ]);
  });

  it("keeps summed integers as numbers, not Arrow decimals", async () => {
    // DuckDB widens SUM over an integer column to DECIMAL(38,0), which Arrow
    // returns as an object that JSON.stringify turns into a quoted string.
    const { rows } = await run({
      groupBy: ["region"],
      aggregate: [{ op: "sum", column: "revenue", as: "total" }],
    });
    for (const row of rows) assert.equal(typeof row["total"], "number");
  });

  it("projects a computed column and filters on the source", async () => {
    const { sql, rows } = await run({
      compute: [{ as: "price", left: "revenue", op: "/", right: "units" }],
      select: ["product", "price"],
      where: [{ column: "revenue", operator: ">", value: 60 }],
      orderBy: [{ column: "price", direction: "desc" }],
    });

    assert.match(sql, /\("revenue" \/ "units"\) AS "price"/);
    assert.deepEqual(rows, [
      { product: "B", price: 16 },
      { product: "A", price: 12 },
      { product: "A", price: 8 },
    ]);
  });

  it("aggregates over a computed column, since compute lands in a subquery", async () => {
    // No orderBy -- see the note on the LIKE/count_distinct test below on why the
    // rows need sorting before comparison.
    const { rows } = await run({
      compute: [{ as: "price", left: "revenue", op: "/", right: "units" }],
      groupBy: ["region"],
      aggregate: [{ op: "avg", column: "price", as: "avg_price" }],
    });
    assert.deepEqual(
      [...rows].sort((a, b) => String(a["region"]).localeCompare(String(b["region"]))),
      [
        { region: "East", avg_price: 14 },
        { region: "West", avg_price: 16.5 },
      ]
    );
  });

  it("quotes IN values as literals rather than column references", async () => {
    const { sql, rows } = await run({
      where: [{ column: "region", operator: "IN", value: ["East"] }],
      select: ["product"],
    });
    assert.match(sql, /IN \('East'\)/);
    assert.equal(rows.length, 2);
  });

  it("supports LIKE and count_distinct", async () => {
    // No orderBy in the spec, so row order is whatever the engine's own GROUP BY
    // execution happens to produce -- not guaranteed by SQL, and no longer
    // incidentally stable now that the native engine can parallelize the aggregate.
    // Sort before comparing; only the per-group values are the actual invariant.
    const { rows } = await run({
      where: [{ column: "product", operator: "LIKE", value: "A%" }],
      groupBy: ["region"],
      aggregate: [{ op: "count_distinct", column: "product", as: "products" }],
    });
    assert.deepEqual(
      [...rows].sort((a, b) => String(a["region"]).localeCompare(String(b["region"]))),
      [
        { region: "East", products: 1 },
        { region: "West", products: 1 },
      ]
    );
  });

  it("escapes string literals rather than letting them break the statement", async () => {
    const quirky = await loadDataset([{ name: "O'Brien", n: 1 }, { name: "Smith", n: 2 }], "people");
    const compiled = compileQuery(
      quirky,
      QuerySpec.parse({ where: [{ column: "name", operator: "=", value: "O'Brien" }], select: ["n"] })
    );
    const { rows } = await execSql(compiled.sql);
    assert.deepEqual(rows, [{ n: 1 }]);
  });

  it("caps the row limit", async () => {
    const { sql } = await run({ select: ["region"], limit: 3 });
    assert.match(sql, /LIMIT 3/);
  });
});

describe("query validation", () => {
  const rejects = (spec: unknown, pattern: RegExp) =>
    assert.throws(() => compileQuery(sales, QuerySpec.parse(spec)), pattern);

  it("names the available columns when one is unknown", () => {
    // Column order reflects the engine's own schema inference (insertion order on
    // Node Neo's read_json_auto, not necessarily alphabetical) -- the set of names is
    // the invariant that matters for an agent repairing its own spec, not the order.
    assert.throws(
      () => compileQuery(sales, QuerySpec.parse({ select: ["revenue", "profit"] })),
      (err: unknown) => {
        const message = (err as Error).message;
        assert.match(message, /unknown column "profit"/);
        assert.deepEqual(
          message.match(/Available columns: (.+)\./)?.[1]?.split(", ").sort(),
          ["product", "region", "revenue", "units"]
        );
        return true;
      }
    );
  });

  it("rejects an ungrouped column beside an aggregate", () => {
    rejects(
      {
        select: ["region", "product"],
        groupBy: ["region"],
        aggregate: [{ op: "sum", column: "revenue", as: "t" }],
      },
      /only grouped columns can be selected/
    );
  });

  it("rejects an unknown column in where, groupBy and orderBy alike", () => {
    rejects({ where: [{ column: "nope", operator: "=", value: 1 }] }, /where references unknown column/);
    rejects({ groupBy: ["nope"] }, /groupBy references unknown column/);
    rejects({ orderBy: [{ column: "nope" }] }, /orderBy references unknown column/);
  });

  it("requires the right value shape per operator", () => {
    rejects({ where: [{ column: "region", operator: "IN", value: "East" }] }, /non-empty array/);
    rejects({ where: [{ column: "revenue", operator: "BETWEEN", value: [1] }] }, /exactly two values/);
    rejects({ where: [{ column: "revenue", operator: ">" }] }, /needs a single value/);
  });

  it("requires a column for every aggregate except count", () => {
    rejects({ aggregate: [{ op: "sum", as: "t" }] }, /needs a column/);
  });

  it("refuses a compute alias that shadows a real column", () => {
    rejects(
      { compute: [{ as: "revenue", left: "revenue", op: "*", right: 2 }] },
      /collides with an existing column/
    );
  });

  it("rejects an unknown column inside a compute operand", () => {
    rejects(
      { compute: [{ as: "x", left: "nope", op: "*", right: 2 }] },
      /compute references unknown column "nope"/
    );
  });

  it("rejects an operator outside the allowlist at parse time", () => {
    assert.throws(() => QuerySpec.parse({ where: [{ column: "region", operator: "; DROP TABLE t --", value: 1 }] }));
  });
});

describe("engine lockdown", () => {
  // @duckdb/node-api is a native binding with real filesystem access (unlike
  // duckdb-wasm's sandboxed Node shim), so `enable_external_access=false` plus a
  // narrow `allowed_directories` allowlist (the ingest scratch dir and the catalog
  // database's own directory, both server-decided) is the DB-level guard. That is
  // defense in depth, not the primary guarantee: no SQL text or path this engine ever
  // executes comes from the agent (query.ts only emits compiled QuerySpec SQL, and
  // datasets.ts builds every path server-side from a validated slug).

  it("cannot read host files through a table function", async () => {
    await assert.rejects(
      () => execSql("SELECT * FROM read_csv_auto('/etc/hosts')"),
      /disabled by configuration|Permission Error/
    );
  });

  it("cannot ATTACH a database file outside the allowlist either", async () => {
    // enable_external_access gates ATTACH exactly like read_csv_auto/read_parquet —
    // this is the same guard the catalog database's own read-only ATTACH relies on.
    await assert.rejects(
      () => execSql("ATTACH '/etc/hosts' AS not_allowed (READ_ONLY)"),
      /disabled by configuration|Permission Error/
    );
  });

  it("can query the attached, read-only catalog database", async () => {
    // Proves the startup ATTACH (built by `pnpm build-catalog`) actually works end to
    // end, not just that arbitrary paths are blocked.
    const { rows } = await execSql('SELECT count(*) AS n FROM "catalog"."regional-sales"');
    assert.equal(rows[0]?.["n"], 32);
  });
});

describe("spatial join", () => {
  // Real San Francisco landmarks, so the distances are checkable against the world.
  const LANDMARKS = [
    { name: "City Hall", lon: -122.4194, lat: 37.7749 },
    { name: "Golden Gate Bridge", lon: -122.4783, lat: 37.8199 },
  ];
  // First two sit essentially on top of a landmark; the third is ~7km from either.
  const VENDORS = [
    { vendor: "Cart A", lon: -122.4195, lat: 37.775 },
    { vendor: "Cart B", lon: -122.4784, lat: 37.82 },
    { vendor: "Far Cart", lon: -122.39, lat: 37.71 },
  ];

  let landmarks: Dataset;
  let vendors: Dataset;

  before(async () => {
    landmarks = await loadDataset(LANDMARKS, "landmarks");
    vendors = await loadDataset(VENDORS, "vendors");
  });

  const joinTo = (other: Dataset, withinMeters: number) => ({
    datasetId: other.id,
    lonColumn: "lon",
    latColumn: "lat",
    otherLonColumn: "lon",
    otherLatColumn: "lat",
    withinMeters,
  });

  /** Compile and run a spatial join, the way the `query` tool does. */
  async function runJoin(primary: Dataset, other: Dataset, spec: Record<string, unknown>) {
    const compiled = compileQuery(primary, QuerySpec.parse(spec), other);
    const { rows } = await execSql(compiled.sql);
    return { ...compiled, rows };
  }

  it("pairs rows within the radius and measures the gap in metres", async () => {
    const { rows } = await runJoin(landmarks, vendors, {
      spatialJoin: joinTo(vendors, 100),
      select: ["name", "other_vendor", "distance_meters"],
      orderBy: [{ column: "name" }],
    });

    assert.deepEqual(
      rows.map((r) => [r["name"], r["other_vendor"]]),
      [
        ["City Hall", "Cart A"],
        ["Golden Gate Bridge", "Cart B"],
      ],
      "only the co-located pairs are within 100m"
    );
    for (const row of rows) {
      const metres = Number(row["distance_meters"]);
      assert.ok(metres > 0 && metres < 20, `expected a few metres, got ${metres}`);
    }
  });

  it("measures a known real-world distance correctly", async () => {
    // City Hall to the Golden Gate Bridge is ~7.2km on the ground, and 7198.6m by
    // haversine on a 6371km sphere. Worth pinning tightly: it is the one assertion
    // that would catch a transposed lat/lon or a degrees/radians slip, both of which
    // produce plausible-looking numbers rather than obvious nonsense.
    //
    // Note DuckDB's own ST_Distance_Sphere answers 7078.3m here, which implies a
    // 6264km radius and disagrees with both the ground truth and a flat-earth
    // approximation (7206.7m). We are not matching that function.
    const { rows } = await runJoin(landmarks, landmarks, {
      spatialJoin: joinTo(landmarks, 20000),
      select: ["name", "other_name", "distance_meters"],
      where: [{ column: "distance_meters", operator: ">", value: 0 }],
      limit: 1,
    });
    const metres = Number(rows[0]?.["distance_meters"]);
    assert.ok(
      Math.abs(metres - 7198.6) < 1,
      `expected ~7198.6m between the two landmarks, got ${metres}`
    );
  });

  it("widens the radius to catch more pairs", async () => {
    const { rows } = await runJoin(landmarks, vendors, {
      spatialJoin: joinTo(vendors, 20000),
      aggregate: [{ op: "count", as: "pairs" }],
    });
    assert.equal(rows[0]?.["pairs"], 6, "every landmark/vendor pair is within 20km");
  });

  it("self-joins to find clusters, including the zero-distance self-pair", async () => {
    const { rows } = await runJoin(landmarks, landmarks, {
      spatialJoin: joinTo(landmarks, 20000),
      aggregate: [{ op: "count", as: "pairs" }],
    });
    // 2x2: each landmark with itself at distance 0, plus both mirrored pairings.
    assert.equal(rows[0]?.["pairs"], 4);
  });

  it("lets the joined columns be grouped and aggregated like any others", async () => {
    const { rows } = await runJoin(landmarks, vendors, {
      spatialJoin: joinTo(vendors, 20000),
      groupBy: ["name"],
      aggregate: [{ op: "min", column: "distance_meters", as: "nearest" }],
      orderBy: [{ column: "name" }],
    });
    assert.equal(rows.length, 2);
    for (const row of rows) assert.ok(Number(row["nearest"]) < 20);
  });

  it("rejects a coordinate column that does not exist", () => {
    assert.throws(
      () =>
        compileQuery(
          landmarks,
          QuerySpec.parse({ spatialJoin: { ...joinTo(vendors, 100), lonColumn: "nope" } }),
          vendors
        ),
      /spatialJoin.lonColumn references unknown column "nope".*Available columns/s
    );
  });

  it("refuses a join too large to run, naming the way out", () => {
    const huge = (id: string, rowCount: number): Dataset => ({
      id,
      name: id,
      table: id,
      columns: [
        { name: "lon", type: "DOUBLE" },
        { name: "lat", type: "DOUBLE" },
      ],
      rowCount,
    });
    assert.throws(
      () =>
        compileQuery(
          huge("a", 366_909),
          QuerySpec.parse({
            spatialJoin: {
              datasetId: "b",
              lonColumn: "lon",
              latColumn: "lat",
              otherLonColumn: "lon",
              otherLatColumn: "lat",
              withinMeters: 150,
            },
          }),
          huge("b", 2_214)
        ),
      /pair comparisons, past the .* ceiling.*Narrow one side with a query first/s
    );
  });

  it("refuses a join whose prefixed columns would collide", () => {
    const withPrefixedColumn: Dataset = {
      id: "ds-collide",
      name: "collide",
      table: "collide",
      columns: [
        { name: "lon", type: "DOUBLE" },
        { name: "lat", type: "DOUBLE" },
        { name: "other_lon", type: "DOUBLE" },
      ],
      rowCount: 1,
    };
    assert.throws(
      () =>
        compileQuery(
          withPrefixedColumn,
          QuerySpec.parse({
            spatialJoin: {
              datasetId: "ds-other",
              lonColumn: "lon",
              latColumn: "lat",
              otherLonColumn: "lon",
              otherLatColumn: "lat",
              withinMeters: 150,
            },
          }),
          withPrefixedColumn
        ),
      /"other_lon", which collides with a column already on this dataset/
    );
  });
});

after(() => {
  // The blocking engine holds the process open otherwise.
  setTimeout(() => process.exit(0), 0).unref();
});
