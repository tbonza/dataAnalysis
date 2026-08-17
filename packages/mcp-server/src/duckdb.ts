import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import * as duckdb from "@duckdb/duckdb-wasm/blocking";
import {
  DATASET_ID_LENGTH,
  DATASET_ID_PREFIX,
  DEFAULT_DATASET_LABEL,
  DEFAULT_SAMPLE_ROWS,
  SUMMARY_SAMPLE_SIZE,
  TABLE_LABEL_MAX_LENGTH,
  TABLE_NAME_PREFIX,
  TABLE_SUFFIX_LENGTH,
} from "./constants.js";

/** A column as DuckDB reports it back through Arrow. */
export interface DatasetColumn {
  name: string;
  /** Arrow type name, e.g. "Utf8", "Int32", "Double". */
  type: string;
}

export interface Dataset {
  id: string;
  /** Caller-facing label. Not used in SQL. */
  name: string;
  /** Internal table name. Chosen by us, never by a caller. */
  table: string;
  columns: DatasetColumn[];
  rowCount: number;
}

type Connection = ReturnType<duckdb.DuckDBBindings["connect"]>;
type QueryResult = ReturnType<Connection["query"]>;

const require_ = createRequire(import.meta.url);
const datasets = new Map<string, Dataset>();
let enginePromise: Promise<duckdb.DuckDBBindings> | undefined;

/**
 * Instantiate the WASM engine once and reuse it. The `blocking` entry point is
 * synchronous and needs no worker plumbing; the trade is that a long query
 * occupies the event loop.
 */
function getEngine(): Promise<duckdb.DuckDBBindings> {
  enginePromise ??= (async () => {
    const dist = require_
      .resolve("@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs")
      .replace(/[^/]+$/, "");
    const db = await duckdb.createDuckDB(
      {
        mvp: { mainModule: dist + "duckdb-mvp.wasm", mainWorker: dist + "duckdb-node-mvp.worker.cjs" },
        eh: { mainModule: dist + "duckdb-eh.wasm", mainWorker: dist + "duckdb-node-eh.worker.cjs" },
      },
      new duckdb.VoidLogger(),
      duckdb.NODE_RUNTIME
    );
    await db.instantiate(() => {});
    // Int64 columns (any `count`) otherwise arrive as BigInt, which JSON.stringify
    // refuses to serialize on the way out to an MCP client.
    db.open({ query: { castBigIntToDouble: true } });

    // The WASM sandbox does NOT contain filesystem access: this build's Node
    // runtime implements file opens with `fs.openSync`, so `read_csv_auto('/etc/passwd')`
    // would reach the real disk. Disabling external access closes that, and DuckDB
    // refuses to re-enable the setting while the database is running. Ingest is
    // unaffected — `registerFileText` files live in DuckDB's virtual filesystem,
    // which this setting does not govern.
    const conn = db.connect();
    try {
      conn.query("SET enable_external_access=false");
    } finally {
      conn.close();
    }
    return db;
  })();
  return enginePromise;
}

/** Open a connection for one operation and always close it. */
async function withConnection<T>(fn: (conn: Connection, db: duckdb.DuckDBBindings) => T): Promise<T> {
  const db = await getEngine();
  const conn = db.connect();
  try {
    return fn(conn, db);
  } finally {
    conn.close();
  }
}

/** Double any embedded quote so a column name can never break out of its identifier. */
export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * Derive a SQL-safe table name, in the spirit of data-formulator's
 * `sanitize_duckdb_sql_table_name`. The random suffix keeps two datasets with the
 * same label from colliding.
 */
function tableNameFor(label: string): string {
  const base = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, TABLE_LABEL_MAX_LENGTH);
  const suffix = randomUUID().replace(/-/g, "").slice(0, TABLE_SUFFIX_LENGTH);
  return `${TABLE_NAME_PREFIX}${base || DEFAULT_DATASET_LABEL}_${suffix}`;
}

function columnsOf(result: QueryResult): DatasetColumn[] {
  return result.schema.fields.map((f) => ({ name: f.name, type: String(f.type) }));
}

/**
 * DuckDB's wider numeric types (DECIMAL, HUGEINT) arrive as Arrow objects that
 * JSON.stringify mangles into quoted strings. Everything leaving this module is
 * bound for a JSON tool result, so coerce those to plain numbers here; a value
 * that genuinely isn't numeric keeps its string form.
 */
function plainValue(value: unknown): unknown {
  if (typeof value === "bigint") return Number(value);
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(plainValue);
  const text = String(value).replace(/^"|"$/g, "");
  const asNumber = Number(text);
  return text !== "" && Number.isFinite(asNumber) ? asNumber : text;
}

function rowsOf(result: QueryResult): Array<Record<string, unknown>> {
  return result.toArray().map((row) => {
    const value: unknown = row;
    const plain =
      typeof (value as { toJSON?: unknown }).toJSON === "function"
        ? (value as { toJSON: () => Record<string, unknown> }).toJSON()
        : { ...(value as Record<string, unknown>) };
    return Object.fromEntries(Object.entries(plain).map(([k, v]) => [k, plainValue(v)]));
  });
}

/** Load inline rows as a queryable table and return its handle. */
export async function loadDataset(
  rows: Array<Record<string, unknown>>,
  name = DEFAULT_DATASET_LABEL
): Promise<Dataset> {
  if (rows.length === 0) throw new Error("Cannot load an empty dataset: `rows` has no entries.");

  const id = `${DATASET_ID_PREFIX}${randomUUID().replace(/-/g, "").slice(0, DATASET_ID_LENGTH)}`;
  const table = tableNameFor(name);
  const handle = `${table}.json`;

  const dataset = await withConnection((conn, db) => {
    // JSON through the virtual filesystem is the supported path for inline rows;
    // DuckDB infers column types from the values.
    db.registerFileText(handle, JSON.stringify(rows));
    conn.insertJSONFromPath(handle, { name: table });
    const probe = conn.query(`SELECT * FROM ${quoteIdent(table)} LIMIT 0`);
    const count = rowsOf(conn.query(`SELECT count(*) AS n FROM ${quoteIdent(table)}`))[0];
    return {
      id,
      name,
      table,
      columns: columnsOf(probe),
      rowCount: Number(count?.["n"] ?? rows.length),
    } satisfies Dataset;
  });

  datasets.set(id, dataset);
  return dataset;
}

/** Look up a dataset, failing with the ids that *are* available so a caller can retry. */
export function getDataset(id: string): Dataset {
  const found = datasets.get(id);
  if (found) return found;
  const known = [...datasets.keys()];
  throw new Error(
    `Unknown datasetId "${id}". ` +
      (known.length ? `Loaded datasets: ${known.join(", ")}.` : "No datasets have been loaded yet.")
  );
}

export function listDatasets(): Dataset[] {
  return [...datasets.values()];
}

/**
 * Run SQL we built ourselves. Callers never supply SQL text — see query.ts — so
 * the table a statement can reach is decided here, not by the agent.
 */
export async function execSql(sql: string): Promise<{
  rows: Array<Record<string, unknown>>;
  columns: DatasetColumn[];
}> {
  return withConnection((conn) => {
    const result = conn.query(sql);
    return { rows: rowsOf(result), columns: columnsOf(result) };
  });
}

/** Register a query result as a dataset of its own, so results can be charted or queried again. */
export async function registerResult(
  rows: Array<Record<string, unknown>>,
  columns: DatasetColumn[],
  name: string
): Promise<Dataset> {
  const dataset = await loadDataset(rows, name);
  // Trust the originating query's Arrow schema over re-inference from JSON.
  const corrected: Dataset = { ...dataset, columns };
  datasets.set(dataset.id, corrected);
  return corrected;
}

export async function sampleRows(
  id: string,
  limit = 10
): Promise<Array<Record<string, unknown>>> {
  const dataset = getDataset(id);
  const { rows } = await execSql(
    `SELECT * FROM ${quoteIdent(dataset.table)} LIMIT ${Math.max(1, Math.trunc(limit))}`
  );
  return rows;
}

/**
 * Per-field summary lines in the shape data-formulator shows its analyst
 * (`agents/agent_utils.py:492`): the type plus distinct values sampled from both
 * ends, so an agent can sanity-read the values before charting rather than
 * trusting column names. flint's authoring skill asks for exactly this.
 */
export async function summarizeDataset(id: string, sampleSize = 16): Promise<string[]> {
  const dataset = getDataset(id);
  const table = quoteIdent(dataset.table);
  const half = Math.max(1, Math.floor(sampleSize / 2));

  const lines: string[] = [];
  for (const column of dataset.columns) {
    const col = quoteIdent(column.name);
    const distinct = `SELECT DISTINCT ${col} AS v FROM ${table} WHERE ${col} IS NOT NULL`;
    const [{ rows: countRows }, { rows: head }, { rows: tail }] = await Promise.all([
      execSql(`SELECT count(*) AS n FROM (${distinct})`),
      execSql(`${distinct} ORDER BY v ASC LIMIT ${sampleSize}`),
      execSql(`${distinct} ORDER BY v DESC LIMIT ${half}`),
    ]);

    const total = Number(countRows[0]?.["n"] ?? 0);
    const format = (rows: Array<Record<string, unknown>>) => rows.map((r) => String(r["v"]));
    const values =
      total <= sampleSize
        ? format(head)
        : [...format(head).slice(0, sampleSize - half), "...", ...format(tail).reverse()];

    lines.push(
      `${column.name} -- type: ${column.type}, distinct: ${total}, values: ${values.join(", ")}`
    );
  }
  return lines;
}
