import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DuckDBInstance } from "@duckdb/node-api";
import { quoteLiteral } from "./duckdb.js";

/**
 * `pnpm csv-to-parquet <input-dir> <output-dir>`
 *
 * Reusable preprocessing for any dataset that starts life as CSV instead of parquet
 * (e.g. an Athena export that happens to land as CSV). Not part of the dataset catalog
 * itself -- `pnpm build-catalog` is still the one standard way a table enters the
 * server; this just gets a directory of CSVs into the parquet shape that step expects.
 */

const CSV_EXTENSION = ".csv";

function csvFilesIn(dir: string): string[] {
  return readdirSync(dir).filter(
    (entry) => entry.endsWith(CSV_EXTENSION) && !entry.startsWith("._")
  );
}

/** Mechanical, not dataset-name-aware: lowercase, non-alphanumeric runs collapsed to a
 *  single hyphen. The result may not be a valid dataset slug (e.g. it can start with a
 *  digit) -- that's `isValidDatasetName`'s job, enforced later by `build-catalog`, not
 *  this script. Rename the output file first if you want a cleaner final name. */
function slugify(stem: string): string {
  const slug = stem
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : "dataset";
}

export interface ConvertedFile {
  csvPath: string;
  parquetPath: string;
  name: string;
}

export interface FailedFile {
  csvPath: string;
  error: string;
}

/**
 * Convert every `.csv` file directly in `inputDir` (non-recursive, macOS `._*`
 * AppleDouble files skipped) into a same-named `.parquet` file in `outputDir`.
 * `sample_size=-1` forces DuckDB to scan the whole file for type inference rather than
 * its default row sample -- a sampled guess risks a type mismatch partway through the
 * real COPY on a large file. One bad file is reported and skipped rather than aborting
 * the whole batch; a name collision between two inputs is a hard error up front, since
 * silently overwriting one file's output with another's would be worse than failing.
 */
export async function convertCsvDirectory(
  inputDir: string,
  outputDir: string
): Promise<{ converted: ConvertedFile[]; failed: FailedFile[] }> {
  const entries = csvFilesIn(inputDir);
  if (entries.length === 0) {
    throw new Error(`No .csv files found in ${inputDir}.`);
  }

  const nameOf = new Map<string, string>();
  for (const entry of entries) {
    const slug = slugify(basename(entry, extname(entry)));
    const existing = nameOf.get(slug);
    if (existing) {
      throw new Error(
        `"${existing}" and "${entry}" both slugify to "${slug}" -- rename one before converting.`
      );
    }
    nameOf.set(slug, entry);
  }

  mkdirSync(outputDir, { recursive: true });

  const instance = await DuckDBInstance.create(":memory:");
  const converted: ConvertedFile[] = [];
  const failed: FailedFile[] = [];
  try {
    for (const entry of entries) {
      const csvPath = join(inputDir, entry);
      const name = slugify(basename(entry, extname(entry)));
      const parquetPath = join(outputDir, `${name}.parquet`);
      const conn = await instance.connect();
      try {
        await conn.run(
          `COPY (SELECT * FROM read_csv_auto(${quoteLiteral(csvPath)}, sample_size=-1)) ` +
            `TO ${quoteLiteral(parquetPath)} (FORMAT PARQUET)`
        );
        converted.push({ csvPath, parquetPath, name });
      } catch (err) {
        failed.push({ csvPath, error: err instanceof Error ? err.message : String(err) });
      } finally {
        conn.disconnectSync();
      }
    }
  } finally {
    instance.closeSync();
  }

  return { converted, failed };
}

async function main(): Promise<void> {
  const [inputDir, outputDir] = process.argv.slice(2);
  if (!inputDir || !outputDir) {
    throw new Error("Usage: pnpm csv-to-parquet <input-dir> <output-dir>");
  }
  if (!existsSync(inputDir)) {
    throw new Error(`Input directory does not exist: ${inputDir}`);
  }

  const { converted, failed } = await convertCsvDirectory(inputDir, outputDir);

  for (const { csvPath, parquetPath } of converted) {
    console.log(`converted ${csvPath} -> ${parquetPath}`);
  }
  for (const { csvPath, error } of failed) {
    console.error(`failed to convert ${csvPath}: ${error}`);
  }
  console.log(
    `\nConverted ${converted.length} of ${converted.length + failed.length} CSV file(s) into ${outputDir}.`
  );
  if (failed.length > 0) process.exitCode = 1;
}

// Only run the CLI when this file is executed directly -- `csvToParquet.test.ts` imports
// `convertCsvDirectory` from this same module, and that import must not also trigger the
// CLI's own argv parsing.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
