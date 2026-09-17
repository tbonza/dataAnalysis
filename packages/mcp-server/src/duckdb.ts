import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DuckDBConnection, DuckDBInstance } from "@duckdb/node-api";
import {
  CATALOG_DATABASE_ALIAS,
  DATASET_ID_LENGTH,
  DATASET_ID_PREFIX,
  DEFAULT_DATASET_LABEL,
  DEFAULT_SAMPLE_ROWS,
  INGEST_SCRATCH_DIR_PREFIX,
  SUMMARY_SAMPLE_SIZE,
  TABLE_LABEL_MAX_LENGTH,
  TABLE_NAME_PREFIX,
  TABLE_SUFFIX_LENGTH,
} from "./constants.js";
import { CATALOG_DB_PATH } from "./paths.js";

/** A column as DuckDB reports it back. */
export interface DatasetColumn {
  name: string;
  /** DuckDB's own SQL type name, e.g. "VARCHAR", "BIGINT", "DOUBLE", "DECIMAL(18,3)". */
  type: string;
}

export interface Dataset {
  id: string;
  /** Caller-facing label. Not used in SQL. */
  name: string;
  /** Internal table reference: a bare name for an ephemeral in-memory table, or
   *  "catalog.<name>" for one already built into the attached, read-only catalog
   *  database. Quote with tableSql(), never quoteIdent() -- a dotted name needs each
   *  segment quoted separately. */
  table: string;
  columns: DatasetColumn[];
  rowCount: number;
}

const datasets = new Map<string, Dataset>();
let enginePromise: Promise<DuckDBInstance> | undefined;
let scratchDir: string | undefined;

/** Real temp directory `load_data`'s inline-row ingestion writes through. Node Neo has
 *  no virtual filesystem the way duckdb-wasm did, so a real file is unavoidable; this
 *  directory is one of the two `allowed_directories` entries the engine trusts. */
function ingestScratchDir(): string {
  scratchDir ??= mkdtempSync(join(tmpdir(), INGEST_SCRATCH_DIR_PREFIX));
  return scratchDir;
}

/**
 * Instantiate the engine once and reuse it: an in-memory main database for ephemeral
 * session data (pasted rows, query-chaining results — "nothing persists" stays true
 * for these), with the prebuilt, read-only catalog database ATTACHed alongside it so
 * packaged datasets are queryable as `catalog.<name>` with no data copied at load time.
 *
 * `@duckdb/node-api` is a native binding with real filesystem access — unlike
 * duckdb-wasm's Node shim, there is no sandbox to rely on by default. DuckDB's own
 * documented pattern is "closed, with a named exception": `enable_external_access =
 * false` plus a narrow `allowed_directories` allowlist covering only the ingest
 * scratch directory and the catalog database's own directory, both server-decided,
 * never agent input. That is defense in depth, not the primary guarantee — the
 * primary guarantee is that no path or SQL text this engine ever executes comes from
 * the agent: SQL is always compiled server-side (see query.ts), and the catalog
 * database's path is fixed at startup, not chosen by a request.
 */
function getEngine(): Promise<DuckDBInstance> {
  enginePromise ??= (async () => {
    const instance = await DuckDBInstance.create(":memory:");
    const conn = await instance.connect();
    try {
      const allowedDirectories = [ingestScratchDir(), dirname(CATALOG_DB_PATH)]
        .map(quoteLiteral)
        .join(", ");
      await conn.run(`SET allowed_directories = [${allowedDirectories}]`);
      await conn.run("SET enable_external_access = false");
      await conn.run("SET autoload_known_extensions = false");
      await conn.run("SET autoinstall_known_extensions = false");

      if (!existsSync(CATALOG_DB_PATH)) {
        throw new Error(
          `No catalog database at ${CATALOG_DB_PATH}. Run "pnpm build-catalog" first -- it builds this ` +
            `file from the parquet files under skills/datasets/assets/ (and $PARQUET_DATASETS_DIR, if set).`
        );
      }
      await conn.run(
        `ATTACH ${quoteLiteral(CATALOG_DB_PATH)} AS ${quoteIdent(CATALOG_DATABASE_ALIAS)} (READ_ONLY)`
      );
      await conn.run("SET lock_configuration = true");
    } finally {
      conn.disconnectSync();
    }
    return instance;
  })();
  return enginePromise;
}

/** Open a connection for one operation and always close it. Safe for concurrent
 *  callers: each gets its own connection handle into the same shared instance. */
async function withConnection<T>(fn: (conn: DuckDBConnection) => Promise<T> | T): Promise<T> {
  const instance = await getEngine();
  const conn = await instance.connect();
  try {
    return await fn(conn);
  } finally {
    conn.disconnectSync();
  }
}

/** Closes the engine, if one was ever created. Best-effort, for a clean SIGINT. */
export async function closeEngine(): Promise<void> {
  if (!enginePromise) return;
  const instance = await enginePromise.catch(() => undefined);
  instance?.closeSync();
}

/** Double any embedded quote so a column or database/table name can never break out
 *  of its identifier. */
export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** Escape a string for use as a SQL string literal -- always a file path this server
 *  constructed itself, never agent-supplied text. Needed because read_parquet,
 *  read_json_auto and ATTACH all require a *constant* filename argument; DuckDB
 *  rejects a bound `$1` parameter there. */
export function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** Quote a table reference that may be dot-qualified (e.g. "catalog.regional_sales")
 *  so each segment is quoted separately -- a single quoteIdent() call would treat the
 *  whole dotted string as one malformed identifier. */
export function tableSql(table: string): string {
  return table.split(".").map(quoteIdent).join(".");
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

interface Columnar {
  columnNames(): string[];
  columnType(index: number): { toString(): string };
}

function columnsOf(result: Columnar): DatasetColumn[] {
  return result.columnNames().map((name, i) => ({ name, type: String(result.columnType(i)) }));
}

/**
 * Node Neo's `getRowObjectsJS()` already converts DECIMAL to a real `number` and
 * dates to a `Date` -- only BIGINT-family values (real JS `bigint`s) and nested
 * struct/list/map values need a further pass before this is JSON-safe.
 */
function plainValue(value: unknown): unknown {
  if (typeof value === "bigint") return Number(value);
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Uint8Array) return Array.from(value);
  if (Array.isArray(value)) return value.map(plainValue);
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, plainValue(v)])
  );
}

interface RowSource extends Columnar {
  getRowObjectsJS(): Record<string, unknown>[];
}

function rowsOf(reader: RowSource): Array<Record<string, unknown>> {
  return reader.getRowObjectsJS().map((row) =>
    Object.fromEntries(Object.entries(row).map(([k, v]) => [k, plainValue(v)]))
  );
}

/** Load inline rows as a queryable table and return its handle. Used by the `load_data`
 *  tool for rows pasted into a session -- unrelated to the packaged-dataset catalog. */
export async function loadDataset(
  rows: Array<Record<string, unknown>>,
  name = DEFAULT_DATASET_LABEL
): Promise<Dataset> {
  if (rows.length === 0) throw new Error("Cannot load an empty dataset: `rows` has no entries.");

  const id = `${DATASET_ID_PREFIX}${randomUUID().replace(/-/g, "").slice(0, DATASET_ID_LENGTH)}`;
  const table = tableNameFor(name);
  const scratchPath = join(ingestScratchDir(), `${table}.json`);
  writeFileSync(scratchPath, JSON.stringify(rows), "utf8");

  const dataset = await withConnection(async (conn) => {
    try {
      await conn.run(
        `CREATE TABLE ${quoteIdent(table)} AS SELECT * FROM read_json_auto(${quoteLiteral(scratchPath)})`
      );
    } finally {
      try {
        unlinkSync(scratchPath);
      } catch {
        // Best-effort: a transient scratch file, not a persisted asset.
      }
    }
    const probe = await conn.run(`SELECT * FROM ${quoteIdent(table)} LIMIT 0`);
    const countReader = await conn.runAndReadAll(`SELECT count(*) AS n FROM ${quoteIdent(table)}`);
    const count = rowsOf(countReader)[0];
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

/**
 * Register an already-built table from the attached, read-only catalog database as a
 * queryable Dataset. No data movement and no parquet touched here -- `pnpm
 * build-catalog` already created the table before this server process started; this
 * just probes its schema/row count and mints (or the caller reuses) a datasetId.
 */
export async function loadCatalogDataset(name: string): Promise<Dataset> {
  const id = `${DATASET_ID_PREFIX}${randomUUID().replace(/-/g, "").slice(0, DATASET_ID_LENGTH)}`;
  const table = `${CATALOG_DATABASE_ALIAS}.${name}`;

  const dataset = await withConnection(async (conn) => {
    const probe = await conn.run(`SELECT * FROM ${tableSql(table)} LIMIT 0`);
    const countReader = await conn.runAndReadAll(`SELECT count(*) AS n FROM ${tableSql(table)}`);
    const count = rowsOf(countReader)[0];
    return {
      id,
      name,
      table,
      columns: columnsOf(probe),
      rowCount: Number(count?.["n"] ?? 0),
    } satisfies Dataset;
  });

  datasets.set(id, dataset);
  return dataset;
}

/** Table names actually present in the attached, read-only catalog database -- what
 *  `pnpm build-catalog` actually built. `datasets.ts` cross-checks this 1:1 against
 *  the datasets skill's reference docs. */
export async function listCatalogTableNames(): Promise<string[]> {
  const { rows } = await execSql(
    `SELECT table_name FROM information_schema.tables ` +
      `WHERE table_catalog = ${quoteLiteral(CATALOG_DATABASE_ALIAS)} ORDER BY table_name`
  );
  return rows.map((r) => String(r["table_name"]));
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

export function listLoadedDatasets(): Dataset[] {
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
  return withConnection(async (conn) => {
    const reader = await conn.runAndReadAll(sql);
    return { rows: rowsOf(reader), columns: columnsOf(reader) };
  });
}

/** Register a query result as a dataset of its own, so results can be charted or queried again. */
export async function registerResult(
  rows: Array<Record<string, unknown>>,
  columns: DatasetColumn[],
  name: string
): Promise<Dataset> {
  const dataset = await loadDataset(rows, name);
  // Trust the originating query's own schema over re-inference from JSON.
  const corrected: Dataset = { ...dataset, columns };
  datasets.set(dataset.id, corrected);
  return corrected;
}

export async function sampleRows(
  id: string,
  limit = DEFAULT_SAMPLE_ROWS
): Promise<Array<Record<string, unknown>>> {
  const dataset = getDataset(id);
  const { rows } = await execSql(
    `SELECT * FROM ${tableSql(dataset.table)} LIMIT ${Math.max(1, Math.trunc(limit))}`
  );
  return rows;
}

/** DuckDB type names covered by the numeric range branch in summarizeColumns(). */
const NUMERIC_TYPE_RE =
  /^(TINYINT|SMALLINT|INTEGER|BIGINT|HUGEINT|UTINYINT|USMALLINT|UINTEGER|UBIGINT|UHUGEINT|FLOAT|DOUBLE|DECIMAL)/;

/**
 * Per-field summary lines: a distinct-value sample for most columns (the type plus
 * values sampled from both ends, so an agent can sanity-read the values before
 * charting rather than trusting column names — data-formulator shows its analyst
 * exactly this, `agents/agent_utils.py:492`), or a min/max range for a numeric column,
 * since a continuous measure's range is more useful for judging fit than a sampled
 * dump of its distinct values.
 *
 * `query` is injected rather than this module's own `execSql` because two very
 * different callers need byte-identical output: the live `summarizeDataset()` below
 * (against this module's shared engine) and `buildCatalog.ts`'s offline reference-doc
 * generation (against its own separate, throwaway DuckDB instance). One formatting
 * source keeps a built doc from ever drifting from what `inspect_dataset` shows at
 * runtime.
 */
export async function summarizeColumns(
  query: (sql: string) => Promise<{ rows: Array<Record<string, unknown>> }>,
  table: string,
  columns: DatasetColumn[],
  sampleSize = SUMMARY_SAMPLE_SIZE
): Promise<string[]> {
  const half = Math.max(1, Math.floor(sampleSize / 2));
  const lines: string[] = [];

  for (const column of columns) {
    const col = quoteIdent(column.name);

    if (NUMERIC_TYPE_RE.test(column.type)) {
      const { rows } = await query(
        `SELECT min(${col}) AS lo, max(${col}) AS hi FROM ${table} WHERE ${col} IS NOT NULL`
      );
      const lo = rows[0]?.["lo"];
      const hi = rows[0]?.["hi"];
      lines.push(
        lo === undefined || lo === null
          ? `${column.name} -- type: ${column.type}, range: (all null)`
          : `${column.name} -- type: ${column.type}, range: ${lo} – ${hi}`
      );
      continue;
    }

    const distinct = `SELECT DISTINCT ${col} AS v FROM ${table} WHERE ${col} IS NOT NULL`;
    const [{ rows: countRows }, { rows: head }, { rows: tail }] = await Promise.all([
      query(`SELECT count(*) AS n FROM (${distinct})`),
      query(`${distinct} ORDER BY v ASC LIMIT ${sampleSize}`),
      query(`${distinct} ORDER BY v DESC LIMIT ${half}`),
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

export async function summarizeDataset(
  id: string,
  sampleSize = SUMMARY_SAMPLE_SIZE
): Promise<string[]> {
  const dataset = getDataset(id);
  return summarizeColumns(execSql, tableSql(dataset.table), dataset.columns, sampleSize);
}
