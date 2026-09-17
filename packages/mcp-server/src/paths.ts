import { fileURLToPath } from "node:url";
import { DATASET_CATALOG_DB_PATH } from "./constants.js";

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
  DATASET_CATALOG_DB_PATH ?? fileURLToPath(new URL("../data/catalog.duckdb", import.meta.url));
