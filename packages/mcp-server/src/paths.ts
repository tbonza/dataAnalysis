import { fileURLToPath } from "node:url";
import { DATA_CACHE_DIR as RAW_DATA_CACHE_DIR, DATASET_CATALOG_DB_PATH } from "./constants.js";

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

/** Defaults to this repo's own `.cache/example-data`, gitignored and unpacked from the
 *  data archive, so a bare `pnpm build-catalog` picks up every locally-available
 *  dataset with no env var required. A missing directory is not an error --
 *  `discoverSources()` in buildCatalog.ts treats it as "no datasets", and build-catalog
 *  then leaves any existing catalog database untouched, so a machine that has only the
 *  prebuilt database still works. Override DATA_CACHE_DIR to point somewhere else. */
export const DATA_CACHE_DIR =
  RAW_DATA_CACHE_DIR ?? fileURLToPath(new URL("../../../.cache/example-data", import.meta.url));
