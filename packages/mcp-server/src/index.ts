/**
 * Library surface, for using the analysis and charting pieces without MCP.
 * The MCP server (server.ts) is a thin wrapper over exactly these functions.
 */

export {
  execSql,
  getDataset,
  listLoadedDatasets,
  loadCatalogDataset,
  loadDataset,
  registerResult,
  sampleRows,
  summarizeColumns,
  summarizeDataset,
  quoteIdent,
  quoteLiteral,
  tableSql,
  type Dataset,
  type DatasetColumn,
} from "./duckdb.js";

export { MAX_RESULT_ROWS, ALLOWED_FRONTMATTER_FIELDS, SKILL_URI_PREFIX } from "./constants.js";

export {
  AGGREGATE_OPS,
  COMPARISON_OPERATORS,
  COMPUTE_OPS,
  QuerySpec,
  compileQuery,
  type CompiledQuery,
} from "./query.js";

export {
  buildChart,
  encodedFields,
  getChart,
  listChartTypes,
  putChart,
  resolveChartType,
  warningsOf,
  type Chart,
} from "./chart.js";

export { validateChart } from "./validate.js";
export { applyConfigUI, sanitizeConfigUI } from "./configUI.js";
export { applyRestyle, prepareRestyle, type RestyleResult } from "./restyle.js";
export { createReport, ReportRequest, type ReportResult } from "./report.js";

export { loadSkills, parseSkillFile, skillsDirectory, type Skill } from "./skills.js";

export {
  ChartSpec,
  ChartWarning,
  ConfigControl,
  DataRow,
  DatasetColumnSchema,
  SemanticTypeMap,
  ValidationResult,
  VegaLiteSpec,
} from "./schemas.js";
