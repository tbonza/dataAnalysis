/**
 * Every tunable and shared identifier for this package, in one place.
 *
 * This module imports nothing. Several constants here are read at module-evaluation
 * time inside zod schemas (`MAX_RESULT_ROWS` in query.ts), so an import cycle would
 * surface as an `undefined` bound rather than as an error.
 */

// --- HTTP ---------------------------------------------------------------------

/** Fixed defaults, kept separate from the resolved values so a URL can be derived
 *  without inheriting an unrelated `PORT` from the environment. */
export const DEFAULT_PORT = 3000;
export const DEFAULT_HOST = "127.0.0.1";

export const PORT = Number(process.env["PORT"] ?? DEFAULT_PORT);
export const HOST = DEFAULT_HOST;

/** Where a client reaches this server by default. Mirrored in agent-server's own
 *  `constants.ts` — the two are coupled by deployment, not by code. */
export const DEFAULT_MCP_URL = `http://${DEFAULT_HOST}:${DEFAULT_PORT}/mcp`;

export const MCP_PATH = "/mcp";
export const HEALTH_PATH = "/health";

/** Hostnames the DNS-rebinding guards accept, before anything is added to them. */
const LOCALHOST_NAMES = ["localhost", "127.0.0.1", "[::1]"];

function allowList(value: string | undefined): string[] {
  const extra = (value ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  return [...LOCALHOST_NAMES, ...extra];
}

/**
 * Who may reach `/mcp`. Localhost only by default — the guards exist because a browser
 * on any page can otherwise be made to POST to a local server. Behind a reverse proxy
 * the `Host` and `Origin` headers name the proxy instead, so those hostnames have to be
 * named explicitly rather than the guards being dropped.
 */
export const ALLOWED_HOSTS = allowList(process.env["MCP_ALLOWED_HOSTS"]);
export const ALLOWED_ORIGINS = allowList(process.env["MCP_ALLOWED_ORIGINS"]);

// --- server identity ----------------------------------------------------------

/** The name a client sees. agent-server's `SERVER_NAME` must match this. */
export const MCP_SERVER_NAME = "chart";
export const MCP_SERVER_VERSION = "1.0.0";

// --- data ---------------------------------------------------------------------

/** Ceiling on rows returned to a caller, so a wide result can't embed a whole table
 *  in a spec. Also the cap a `QuerySpec.limit` is clamped to. */
export const MAX_RESULT_ROWS = 5000;

/**
 * Three separate row counts that happen to share a value. They are not the same
 * knob: tuning how many rows an agent inspects should not silently change how many
 * rows it is shown when restyling.
 */
export const DEFAULT_SAMPLE_ROWS = 10;
export const RESTYLE_SAMPLE_ROWS = 10;
export const QUERY_PREVIEW_ROWS = 10;

/** Distinct values sampled per field in a dataset summary, split between both ends. */
export const SUMMARY_SAMPLE_SIZE = 16;

export const DATASET_ID_PREFIX = "ds-";
export const DATASET_ID_LENGTH = 12;

/** Internal SQL table naming. Chosen by us, never by a caller. */
export const TABLE_NAME_PREFIX = "ds_";
export const TABLE_LABEL_MAX_LENGTH = 40;
export const TABLE_SUFFIX_LENGTH = 8;
export const DEFAULT_DATASET_LABEL = "data";

// --- charts -------------------------------------------------------------------

export const CHART_ID_PREFIX = "chart-";
export const CHART_ID_LENGTH = 12;

/** Where an unrecognised chart type lands. flint's own fallback behaviour. */
export const FALLBACK_CHART_TYPE = "Scatter Plot";

// --- skills, datasets and roles ----------------------------------------------

/** Resource URI scheme for skills. Duplicated in agent-server's `constants.ts`,
 *  which parses these URIs back into virtual filesystem paths. */
export const SKILL_URI_PREFIX = "chart://skill/";

/** Fields the Agent Skills specification permits in frontmatter. Anything else is a
 *  compliance bug. */
export const ALLOWED_FRONTMATTER_FIELDS = [
  "name",
  "description",
  "license",
  "compatibility",
  "metadata",
  "allowed-tools",
] as const;

export const SKILLS_DIRNAME = "skills";
export const SKILL_FILENAME = "SKILL.md";
export const REFERENCES_DIRNAME = "references";
export const ASSETS_DIRNAME = "assets";

/** The one skill holding every packaged dataset: parquet sources under `assets/` (and,
 *  optionally, `$PARQUET_DATASETS_DIR`), per-dataset documentation under `references/`. */
export const DATASETS_SKILL_NAME = "datasets";

/** The one skill holding job-role personas and their recommended prompts. */
export const JOB_ROLES_SKILL_NAME = "job-roles";

export const DATASET_PARQUET_EXTENSION = ".parquet";

// --- parquet-backed dataset catalog -------------------------------------------

/** External directory of cached Athena parquet exports, one file = one dataset,
 *  merged with the committed examples under `skills/datasets/assets/` when
 *  `pnpm build-catalog` runs. Unset ⇒ only the committed examples are built. Never
 *  read directly by the live server — only `buildCatalog.ts` touches raw parquet. */
export const PARQUET_DATASETS_DIR = process.env["PARQUET_DATASETS_DIR"];

/** Where `pnpm build-catalog` writes the prebuilt catalog database, and where the
 *  live server ATTACHes it read-only at startup. Bare env read only — the default
 *  absolute path is resolved in paths.ts, the same way skills.ts resolves SKILLS_DIR,
 *  since this module imports nothing. */
export const DATASET_CATALOG_DB_PATH = process.env["DATASET_CATALOG_DB_PATH"];

/** The ATTACHed catalog database's alias — packaged dataset tables are queried as
 *  `catalog.<name>`, never copied into the ephemeral main database. */
export const CATALOG_DATABASE_ALIAS = "catalog";

/** Prefix for the scratch directory `load_data`'s inline-row ingestion writes a real
 *  temp file through — Node Neo has no virtual filesystem the way duckdb-wasm did, so
 *  a real file is unavoidable. This directory is one of the two `allowed_directories`
 *  entries the engine trusts. */
export const INGEST_SCRATCH_DIR_PREFIX = "mcp-server-duckdb-";

/** Marks a registered prompt as part of the recommended-prompt library, so a client
 *  can tell those apart from the per-skill loader prompts. */
export const RECOMMENDED_PROMPT_KIND = "recommended-prompt";
