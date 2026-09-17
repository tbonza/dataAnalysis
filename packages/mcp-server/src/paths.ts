import { fileURLToPath } from "node:url";
import { DATASET_CATALOG_DB_PATH, PARQUET_DATASETS_DIR as RAW_PARQUET_DATASETS_DIR } from "./constants.js";

/**
 * Absolute paths resolved relative to this package, not the process cwd — the same
 * pattern `skills.ts` uses for `SKILLS_DIR`. Lives in its own module (rather than
 * `duckdb.ts` or `datasets.ts`) so both can import it without a circular dependency:
 * `datasets.ts` needs a live connection from `duckdb.ts` to introspect the catalog,
 * and `duckdb.ts` needs this path to ATTACH it.
 */

/** Where `pnpm build-catalog` writes the prebuilt catalog database, and where the
 *  live server ATTACHes it read-only at startup. */
export const CATALOG_DB_PATH =
  DATASET_CATALOG_DB_PATH ?? fileURLToPath(new URL("../data/catalog.db", import.meta.url));

/** Defaults to this repo's own example_data/parquet (populated by `pnpm
 *  csv-to-parquet` from example_data/sf-open-data/*.csv, itself gitignored), so a bare
 *  `pnpm build-catalog` picks up every locally-available dataset with no env var
 *  required. A missing directory (default or overridden) is not an error --
 *  `discoverSources()` in buildCatalog.ts already treats a missing dir as "no external
 *  files", so it falls back to the committed examples exactly as before. Override
 *  PARQUET_DATASETS_DIR to point at a different external cache instead. */
export const PARQUET_DATASETS_DIR =
  RAW_PARQUET_DATASETS_DIR ?? fileURLToPath(new URL("../../../example_data/parquet", import.meta.url));
