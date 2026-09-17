import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DuckDBInstance } from "@duckdb/node-api";
import { DATASET_PARQUET_EXTENSION } from "./constants.js";
import { convertCsvFiles, csvFilesIn, datasetNameForCsv } from "./csvToParquet.js";
import { isValidDatasetName, referencePathFor } from "./datasets.js";
import { quoteIdent, quoteLiteral, summarizeColumns, type DatasetColumn } from "./duckdb.js";
import { CATALOG_DB_PATH, DATA_CACHE_DIR } from "./paths.js";

/**
 * `pnpm build-catalog`
 *
 * The one standard way a dataset enters this server: reads the local data cache
 * (`$DATA_CACHE_DIR`, one subdirectory per source group), converts any `.csv` that has
 * no parquet beside it yet, loads every `.parquet` into tables inside one persistent
 * DuckDB database file, then regenerates each table's `references/<name>.md` "## Fields"
 * section from the live schema -- mechanically derived, so it can never drift from what
 * `inspect_dataset` shows at runtime -- while preserving any hand-written `description`
 * and other prose.
 *
 * This is a rebuild step, not first-run setup. The live MCP server never reads the cache
 * at all -- it only ATTACHes the database file this script produces, read-only -- so a
 * machine that has the database but no cache is perfectly fine, and running this there
 * is a no-op that leaves the existing database alone.
 */

const FIELDS_HEADING = "## Fields";

function parquetFilesIn(dir: string): Map<string, string> {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return new Map();
  }
  const found = new Map<string, string>();
  for (const entry of entries) {
    if (!entry.endsWith(DATASET_PARQUET_EXTENSION)) continue;
    found.set(entry.slice(0, -DATASET_PARQUET_EXTENSION.length), join(dir, entry));
  }
  return found;
}

/** The cache's source groups -- one subdirectory per origin (`sf-open-data/`,
 *  `mock-sales-data/`, ...). A loose file at the cache root is ignored: a dataset
 *  belongs to a group. A missing cache root yields no groups rather than throwing. */
function groupDirsIn(root: string): string[] {
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(root, entry.name))
      .sort();
  } catch {
    return [];
  }
}

/**
 * Convert any `.csv` in a group directory that has no parquet beside it yet, so the
 * rest of the build sees one uniform parquet shape. Idempotent, which matters because
 * these files can be large -- a CSV already converted is left alone. A conversion that
 * fails is fatal rather than skipped: silently dropping a dataset here would resurface
 * later as a confusing "reference doc has no matching table" error.
 */
async function convertPendingCsv(groupDirs: string[]): Promise<void> {
  const jobs = groupDirs.flatMap((dir) =>
    csvFilesIn(dir)
      .map((entry) => {
        const name = datasetNameForCsv(entry);
        return {
          csvPath: join(dir, entry),
          parquetPath: join(dir, `${name}${DATASET_PARQUET_EXTENSION}`),
          name,
        };
      })
      .filter((job) => !existsSync(job.parquetPath))
  );
  if (jobs.length === 0) return;

  const { converted, failed } = await convertCsvFiles(jobs);
  for (const { csvPath, parquetPath } of converted) {
    console.log(`converted ${csvPath} -> ${parquetPath}`);
  }
  if (failed.length > 0) {
    throw new Error(
      `Could not convert ${failed.length} CSV file(s):\n` +
        failed.map(({ csvPath, error }) => `  ${csvPath}: ${error}`).join("\n")
    );
  }
}

/** Discover source parquet files across every group, name = filename stem, validated
 *  and collision-checked. Groups organise the cache by origin; they do not namespace
 *  the dataset, so the same stem in two groups is ambiguous and refused. */
function discoverSources(groupDirs: string[]): Map<string, string> {
  const all = new Map<string, string>();
  const collisions: string[] = [];
  for (const dir of groupDirs) {
    for (const [name, path] of parquetFilesIn(dir)) {
      if (all.has(name)) collisions.push(name);
      else all.set(name, path);
    }
  }
  if (collisions.length) {
    throw new Error(
      `Dataset name(s) ${collisions.join(", ")} exist as a parquet file in more than one ` +
        `group under ${DATA_CACHE_DIR} -- rename one.`
    );
  }

  const invalid = [...all.keys()].filter((name) => !isValidDatasetName(name));
  if (invalid.length) {
    throw new Error(
      `Invalid dataset name(s) from parquet filename(s): ${invalid.join(", ")}. ` +
        `Use lowercase letters, digits and single hyphens only.`
    );
  }
  return all;
}

interface Section {
  heading: string;
  body: string;
}

function parseBody(body: string): { preamble: string; sections: Section[] } {
  const parts = body.split(/\r?\n(?=## )/);
  const preamble = parts[0] ?? "";
  const sections: Section[] = parts.slice(1).map((part) => {
    const newline = part.indexOf("\n");
    return newline === -1
      ? { heading: part, body: "" }
      : { heading: part.slice(0, newline), body: part.slice(newline + 1) };
  });
  return { preamble, sections };
}

function renderDoc(frontmatterRaw: string, preamble: string, sections: Section[]): string {
  const blocks = [
    preamble.replace(/\s+$/, ""),
    ...sections.map((s) => `${s.heading}\n${s.body.replace(/\s+$/, "")}`),
  ].filter((b) => b.length > 0);
  return `---\n${frontmatterRaw}\n---\n${blocks.join("\n\n")}\n`;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/**
 * Regenerate `references/<name>.md`'s "## Fields" section from `fieldsBullets`.
 * Preserves everything else byte-for-byte: the frontmatter `description` and any other
 * section (e.g. "## What it can answer"). Scaffolds a brand-new doc with TODO
 * placeholders for the prose when none exists yet.
 */
function regenerateReferenceDoc(name: string, fieldsBullets: string): string {
  const path = referencePathFor(name);
  const fieldsSection: Section = { heading: FIELDS_HEADING, body: `\n${fieldsBullets}\n` };

  if (!existsSync(path)) {
    const frontmatterRaw =
      "description: >-\n" +
      "  TODO: describe this dataset in one or two sentences. Use when TODO -- say what\n" +
      "  questions it can answer, so an agent can tell whether it fits before loading it.";
    const preamble =
      `\n# ${name}\n\n` +
      `TODO: describe how this dataset was assembled and any caveats. Load it with ` +
      `\`load_available_dataset({ name: "${name}" })\`.`;
    const whatItAnswers: Section = {
      heading: "## What it can answer",
      body: "\n\nTODO: describe what questions this dataset is (and is not) scoped to answer.\n",
    };
    return renderDoc(frontmatterRaw, preamble, [fieldsSection, whatItAnswers]);
  }

  const existing = readFileSync(path, "utf8");
  const match = FRONTMATTER_RE.exec(existing);
  if (!match) throw new Error(`references/${name}.md is malformed: missing YAML frontmatter.`);
  const [, frontmatterRaw, body] = match;

  const { preamble, sections } = parseBody(body ?? "");
  const existingIndex = sections.findIndex((s) => s.heading.trim() === FIELDS_HEADING);
  const nextSections =
    existingIndex === -1
      ? [fieldsSection, ...sections]
      : sections.map((s, i) => (i === existingIndex ? fieldsSection : s));

  return renderDoc(frontmatterRaw ?? "", preamble, nextSections);
}

async function tableColumns(instance: DuckDBInstance, name: string): Promise<DatasetColumn[]> {
  const conn = await instance.connect();
  try {
    const probe = await conn.run(`SELECT * FROM ${quoteIdent(name)} LIMIT 0`);
    return probe.columnNames().map((n, i) => ({ name: n, type: String(probe.columnType(i)) }));
  } finally {
    conn.disconnectSync();
  }
}

/** A fresh connection per query, mirroring duckdb.ts's withConnection -- summarizeColumns
 *  fires several queries concurrently and a single DuckDBConnection isn't meant for that. */
function queryVia(instance: DuckDBInstance): (sql: string) => Promise<{ rows: Array<Record<string, unknown>> }> {
  return async (sql) => {
    const conn = await instance.connect();
    try {
      const reader = await conn.runAndReadAll(sql);
      return { rows: reader.getRowObjectsJS() as Array<Record<string, unknown>> };
    } finally {
      conn.disconnectSync();
    }
  };
}

async function main(): Promise<void> {
  const groupDirs = groupDirsIn(DATA_CACHE_DIR);
  await convertPendingCsv(groupDirs);

  const sources = discoverSources(groupDirs);
  if (sources.size === 0) {
    console.log(
      `No datasets found under ${DATA_CACHE_DIR} -- expected one subdirectory per ` +
        `source group, each holding .parquet or .csv files. Nothing to build, and any ` +
        `existing catalog database is left exactly as it was.`
    );
    return;
  }

  mkdirSync(dirname(CATALOG_DB_PATH), { recursive: true });
  // Rebuilt from scratch every run -- simpler and safer than diffing an existing file,
  // and this is a build artifact, never hand-edited.
  rmSync(CATALOG_DB_PATH, { force: true });
  rmSync(`${CATALOG_DB_PATH}.wal`, { force: true });

  const instance = await DuckDBInstance.create(CATALOG_DB_PATH);
  try {
    for (const [name, path] of sources) {
      const conn = await instance.connect();
      try {
        await conn.run(
          `CREATE TABLE ${quoteIdent(name)} AS SELECT * FROM read_parquet(${quoteLiteral(path)})`
        );
      } finally {
        conn.disconnectSync();
      }
      console.log(`built table "${name}" from ${path}`);
    }

    for (const name of sources.keys()) {
      const columns = await tableColumns(instance, name);
      const fieldsBullets = (
        await summarizeColumns(queryVia(instance), quoteIdent(name), columns)
      )
        .map((line) => {
          const sep = line.indexOf(" -- ");
          return `- \`${line.slice(0, sep)}\`${line.slice(sep)}`;
        })
        .join("\n");
      const isNew = !existsSync(referencePathFor(name));
      writeFileSync(referencePathFor(name), regenerateReferenceDoc(name, fieldsBullets), "utf8");
      console.log(`${isNew ? "scaffolded" : "updated"} references/${name}.md`);
    }

    // Checkpoint and close cleanly so the live server can later ATTACH this file
    // read-only with no WAL replay needed.
    const conn = await instance.connect();
    try {
      await conn.run("CHECKPOINT");
    } finally {
      conn.disconnectSync();
    }
  } finally {
    instance.closeSync();
  }

  console.log(`\nBuilt ${sources.size} dataset(s) into ${CATALOG_DB_PATH}.`);
  const scaffolded = [...sources.keys()].some((name) => {
    const text = readFileSync(referencePathFor(name), "utf8");
    return text.includes("TODO");
  });
  if (scaffolded) {
    console.log(
      "Some reference docs still have TODO placeholders -- fill in the description " +
        "and \"What it can answer\" sections by hand before relying on them."
    );
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
