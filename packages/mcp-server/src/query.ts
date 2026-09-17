import * as z from "zod/v4";
import {
  Query,
  avg,
  count,
  desc,
  eq,
  gt,
  gte,
  isBetween,
  isIn,
  isNotNull,
  isNull,
  literal,
  lt,
  lte,
  max,
  median,
  min,
  neq,
  not,
  parseTableRef,
  sql,
  verbatim,
  add,
  sub,
  mul,
  div,
} from "@uwdata/mosaic-sql";
import { MAX_RESULT_ROWS, MAX_SPATIAL_JOIN_PAIRS } from "./constants.js";
import { quoteIdent, tableSql, type Dataset } from "./duckdb.js";

/**
 * The operator allowlist is data-formulator's, ported verbatim from
 * `build_where_clause` (data_loader/external_data_loader.py:107).
 */
export const COMPARISON_OPERATORS = [
  "=",
  "!=",
  ">",
  "<",
  ">=",
  "<=",
  "LIKE",
  "NOT LIKE",
  "IN",
  "NOT IN",
  "BETWEEN",
  "IS NULL",
  "IS NOT NULL",
] as const;

export const AGGREGATE_OPS = ["count", "count_distinct", "sum", "avg", "min", "max", "median"] as const;
export const COMPUTE_OPS = ["+", "-", "*", "/"] as const;

const ScalarValue = z.union([z.string(), z.number(), z.boolean()]);

const Condition = z.object({
  column: z.string(),
  operator: z.enum(COMPARISON_OPERATORS),
  value: z.union([ScalarValue, z.array(ScalarValue)]).optional(),
});

/**
 * A single arithmetic step. A string operand names a column; a number is a
 * literal. Deliberately not a recursive expression language — one step covers
 * ratios, per-unit values, and rescaling, and anything deeper is a second query
 * over the first one's result.
 */
const Compute = z.object({
  as: z.string(),
  left: z.union([z.string(), z.number()]),
  op: z.enum(COMPUTE_OPS),
  right: z.union([z.string(), z.number()]),
});

const Aggregate = z.object({
  op: z.enum(AGGREGATE_OPS),
  /** Required for every op except `count`. */
  column: z.string().optional(),
  as: z.string(),
});

const OrderBy = z.object({
  column: z.string(),
  direction: z.enum(["asc", "desc"]).default("asc"),
});

/**
 * Join a second dataset on geographic proximity. The only way to relate two
 * datasets in one query — everything else here operates on a single table.
 *
 * The other dataset's columns arrive prefixed `other_`, and the pair's great-circle
 * separation arrives as `distance_meters`; all three are ordinary columns to
 * everything downstream, so select/where/groupBy/aggregate/orderBy work on them
 * unchanged.
 */
const SpatialJoin = z.object({
  /** The other loaded dataset. May be this same dataset, to find clusters within it. */
  datasetId: z.string(),
  lonColumn: z.string(),
  latColumn: z.string(),
  otherLonColumn: z.string(),
  otherLatColumn: z.string(),
  withinMeters: z.number().positive(),
});

export const QuerySpec = z.object({
  select: z.array(z.string()).optional(),
  compute: z.array(Compute).optional(),
  where: z.array(Condition).optional(),
  groupBy: z.array(z.string()).optional(),
  aggregate: z.array(Aggregate).optional(),
  orderBy: z.array(OrderBy).optional(),
  limit: z.number().int().positive().max(MAX_RESULT_ROWS).optional(),
  spatialJoin: SpatialJoin.optional(),
});

export type QuerySpec = z.infer<typeof QuerySpec>;
export type Condition = z.infer<typeof Condition>;

export interface CompiledQuery {
  sql: string;
  /** The columns the result will have, in order. */
  outputColumns: string[];
}

/**
 * Reject an unknown column by name and say what *is* available. The caller is an
 * agent, so the list is what lets it repair the spec — this mirrors
 * data-formulator's `agent.fieldsNotFound` error (analyst/agent.py:1060-1074).
 *
 * Upstream's own builder silently skips conditions it can't resolve; we refuse
 * instead, because a dropped filter yields a chart that is quietly wrong.
 */
function unknownColumn(where: string, name: string, available: readonly string[]): never {
  throw new Error(
    `${where} references unknown column "${name}". Available columns: ${available.join(", ")}.`
  );
}

/** Values must be wrapped: mosaic-sql reads a bare string as a column reference. */
function value(raw: unknown) {
  return literal(raw as string | number | boolean | null);
}

function condition(cond: Condition, known: readonly string[]) {
  const { column, operator, value: raw } = cond;
  if (!known.includes(column)) unknownColumn("where", column, known);

  const requireScalar = (): string | number | boolean => {
    if (raw === undefined || Array.isArray(raw)) {
      throw new Error(`Operator "${operator}" on "${column}" needs a single value.`);
    }
    return raw;
  };
  const requireList = (): Array<string | number | boolean> => {
    if (!Array.isArray(raw) || raw.length === 0) {
      throw new Error(`Operator "${operator}" on "${column}" needs a non-empty array of values.`);
    }
    return raw;
  };

  switch (operator) {
    case "IS NULL":
      return isNull(column);
    case "IS NOT NULL":
      return isNotNull(column);
    case "=":
      return eq(column, value(requireScalar()));
    case "!=":
      return neq(column, value(requireScalar()));
    case ">":
      return gt(column, value(requireScalar()));
    case "<":
      return lt(column, value(requireScalar()));
    case ">=":
      return gte(column, value(requireScalar()));
    case "<=":
      return lte(column, value(requireScalar()));
    case "IN":
      return isIn(column, requireList().map(value));
    case "NOT IN":
      return not(isIn(column, requireList().map(value)));
    case "BETWEEN": {
      const bounds = requireList();
      if (bounds.length !== 2) {
        throw new Error(`Operator "BETWEEN" on "${column}" needs exactly two values [low, high].`);
      }
      return isBetween(column, [value(bounds[0]), value(bounds[1])]);
    }
    // mosaic-sql has no LIKE helper. The identifier is quoted by us and was
    // checked against the dataset's columns above; the pattern is a bound literal.
    case "LIKE":
      return sql`${quoteIdent(column)} LIKE ${value(requireScalar())}`;
    case "NOT LIKE":
      return sql`${quoteIdent(column)} NOT LIKE ${value(requireScalar())}`;
  }
}

function operand(side: string | number, sourceColumns: readonly string[]) {
  if (typeof side === "number") return side;
  if (!sourceColumns.includes(side)) unknownColumn("compute", side, sourceColumns);
  return side;
}

function aggregateExpr(spec: z.infer<typeof Aggregate>, known: readonly string[]) {
  if (spec.op === "count" && spec.column === undefined) return count();
  const column = spec.column;
  if (column === undefined) {
    throw new Error(`Aggregate "${spec.op}" as "${spec.as}" needs a column.`);
  }
  if (!known.includes(column)) unknownColumn(`aggregate "${spec.as}"`, column, known);

  switch (spec.op) {
    case "count":
      return count(column);
    case "count_distinct":
      return count(sql`DISTINCT ${quoteIdent(column)}`);
    // DuckDB widens SUM over an integer column to DECIMAL(38,0), which Arrow hands
    // back as an object rather than a number and so cannot be serialized to JSON.
    // Casting keeps the result a plain number for the caller.
    case "sum":
      return sql`sum(${quoteIdent(column)})::DOUBLE`;
    case "avg":
      return avg(column);
    case "min":
      return min(column);
    case "max":
      return max(column);
    case "median":
      return median(column);
  }
}

function computeExpr(spec: z.infer<typeof Compute>, sourceColumns: readonly string[]) {
  const left = operand(spec.left, sourceColumns);
  const right = operand(spec.right, sourceColumns);
  switch (spec.op) {
    case "+":
      return add(left, right);
    case "-":
      return sub(left, right);
    case "*":
      return mul(left, right);
    case "/":
      return div(left, right);
  }
}

/** Mean Earth radius in metres — the sphere the Haversine formula assumes. */
const EARTH_RADIUS_M = 6_371_000;

/** Metres per degree of latitude. Near enough constant everywhere, which is what makes
 *  the latitude prefilter below safe; the longitude equivalent is not, since a degree of
 *  longitude shrinks by cos(latitude). */
const METRES_PER_DEGREE_LAT = 111_320;

/** Columns from the joined dataset arrive under this prefix. */
const JOIN_COLUMN_PREFIX = "other_";

/** The pair separation a spatial join always projects. */
const DISTANCE_COLUMN = "distance_meters";

/**
 * Great-circle distance in metres between two lon/lat pairs, as a SQL expression.
 *
 * Haversine over core DuckDB maths rather than the `spatial` extension: the extension
 * would cost an INSTALL step, network access to fetch it, and a LOAD ordered ahead of
 * the engine's own lockdown — all to compute one distance. Assuming a sphere rather
 * than an ellipsoid costs well under a metre at city scale.
 */
function haversineMetres(aLon: string, aLat: string, bLon: string, bLat: string): string {
  return (
    `2 * ${EARTH_RADIUS_M} * asin(sqrt(` +
    `pow(sin(radians(${bLat} - ${aLat}) / 2), 2) + ` +
    `cos(radians(${aLat})) * cos(radians(${bLat})) * ` +
    `pow(sin(radians(${bLon} - ${aLon}) / 2), 2)` +
    `))`
  );
}

/**
 * Build the joined row set a `spatialJoin` queries over, as a subquery.
 *
 * Returned as a FROM source rather than a bespoke query shape so that everything
 * downstream — select, where, groupBy, aggregate, orderBy, and even `compute`'s own
 * wrapping subquery — operates on it unchanged. mosaic-sql has no join builder, but it
 * accepts a verbatim fragment as a table source, which is all this needs.
 */
function spatialJoinFrom(
  dataset: Dataset,
  other: Dataset,
  join: z.infer<typeof SpatialJoin>
): { from: ReturnType<typeof verbatim>; columns: string[] } {
  const sourceColumns = dataset.columns.map((c) => c.name);
  const otherColumns = other.columns.map((c) => c.name);

  const require = (where: string, column: string, available: readonly string[]) => {
    if (!available.includes(column)) unknownColumn(where, column, available);
  };
  require("spatialJoin.lonColumn", join.lonColumn, sourceColumns);
  require("spatialJoin.latColumn", join.latColumn, sourceColumns);
  require("spatialJoin.otherLonColumn", join.otherLonColumn, otherColumns);
  require("spatialJoin.otherLatColumn", join.otherLatColumn, otherColumns);

  const pairs = dataset.rowCount * other.rowCount;
  if (pairs > MAX_SPATIAL_JOIN_PAIRS) {
    throw new Error(
      `A spatial join of ${dataset.rowCount.toLocaleString()} x ${other.rowCount.toLocaleString()} rows is ` +
        `${pairs.toLocaleString()} pair comparisons, past the ${MAX_SPATIAL_JOIN_PAIRS.toLocaleString()} ceiling. ` +
        `Narrow one side with a query first — filter or aggregate it — then spatial-join that result.`
    );
  }

  const prefixed = otherColumns.map((name) => `${JOIN_COLUMN_PREFIX}${name}`);
  const taken = new Set(sourceColumns);
  const collisions = [...prefixed, DISTANCE_COLUMN].filter((name) => taken.has(name));
  if (collisions.length > 0) {
    throw new Error(
      `spatialJoin would produce ${collisions.map((c) => `"${c}"`).join(", ")}, which ` +
        `${collisions.length === 1 ? "collides" : "collide"} with a column already on this dataset. ` +
        `Select a narrower set of columns with a query first, then spatial-join that result.`
    );
  }

  const a = "spatial_left";
  const b = "spatial_right";
  const aLon = `${a}.${quoteIdent(join.lonColumn)}`;
  const aLat = `${a}.${quoteIdent(join.latColumn)}`;
  const bLon = `${b}.${quoteIdent(join.otherLonColumn)}`;
  const bLat = `${b}.${quoteIdent(join.otherLatColumn)}`;
  const distance = haversineMetres(aLon, aLat, bLon, bLat);

  const projection = [
    ...sourceColumns.map((name) => `${a}.${quoteIdent(name)}`),
    ...otherColumns.map(
      (name) => `${b}.${quoteIdent(name)} AS ${quoteIdent(`${JOIN_COLUMN_PREFIX}${name}`)}`
    ),
    `${distance} AS ${quoteIdent(DISTANCE_COLUMN)}`,
  ].join(", ");

  // The latitude band prunes nearly every pair before the trigonometry runs. It is
  // deliberately the only prefilter: a fixed longitude band would be wrong, because a
  // degree of longitude covers less ground the further you are from the equator, so a
  // band wide enough at the equator silently drops true matches anywhere else.
  const latBand = join.withinMeters / METRES_PER_DEGREE_LAT;

  const text =
    `(SELECT ${projection} ` +
    `FROM ${tableSql(dataset.table)} AS ${a} ` +
    `JOIN ${tableSql(other.table)} AS ${b} ` +
    `ON abs(${aLat} - ${bLat}) <= ${latBand} AND ${distance} <= ${join.withinMeters})`;

  return { from: verbatim(text), columns: [...sourceColumns, ...prefixed, DISTANCE_COLUMN] };
}

/**
 * Turn a validated QuerySpec into SQL against one dataset.
 *
 * Computed columns are projected in an inner subquery so they behave like real
 * columns everywhere else — filterable, groupable, aggregatable, sortable —
 * rather than being confined to the output projection.
 *
 * Note that `compute` is row-level. A ratio *of aggregates* is a second query
 * over this one's result; each result registers as its own dataset for that
 * purpose.
 */
export function compileQuery(
  dataset: Dataset,
  spec: QuerySpec,
  /** The dataset named by `spec.spatialJoin`, resolved by the caller. */
  otherDataset?: Dataset
): CompiledQuery {
  let joined: { from: ReturnType<typeof verbatim>; columns: string[] } | undefined;
  if (spec.spatialJoin) {
    if (!otherDataset) {
      throw new Error(
        `spatialJoin names dataset "${spec.spatialJoin.datasetId}", which was not resolved.`
      );
    }
    joined = spatialJoinFrom(dataset, otherDataset, spec.spatialJoin);
  }

  const sourceColumns = joined ? joined.columns : dataset.columns.map((c) => c.name);

  const computed = spec.compute ?? [];
  for (const c of computed) {
    if (sourceColumns.includes(c.as)) {
      throw new Error(`compute alias "${c.as}" collides with an existing column.`);
    }
  }
  const computedNames = computed.map((c) => c.as);
  if (new Set(computedNames).size !== computedNames.length) {
    throw new Error("compute aliases must be unique.");
  }

  /** Everything nameable by where/groupBy/aggregate/select. */
  const known = [...sourceColumns, ...computedNames];

  // mosaic-sql quotes identifiers itself — pass a table ref, not a pre-quoted string.
  // dataset.table may be dot-qualified (e.g. "catalog.regional_sales" for a packaged
  // dataset); parseTableRef splits on "." itself, so it handles both that and a bare
  // ephemeral table name identically.
  // A spatial join supplies its own joined row set as the source; otherwise it's the
  // dataset's own table. Either way `compute` wraps it the same.
  const base = joined ? joined.from : parseTableRef(dataset.table);

  const from = computed.length
    ? Query.from(base).select(
        "*",
        Object.fromEntries(computed.map((c) => [c.as, computeExpr(c, sourceColumns)]))
      )
    : base;

  const query = Query.from(from);

  const groupBy = spec.groupBy ?? [];
  for (const column of groupBy) {
    if (!known.includes(column)) unknownColumn("groupBy", column, known);
  }

  const aggregates = spec.aggregate ?? [];
  const aggregateNames = aggregates.map((a) => a.as);

  // With aggregates present, SQL only permits grouped columns in the projection.
  let projected: string[];
  if (aggregates.length > 0) {
    projected = spec.select ?? groupBy;
    const notGrouped = projected.filter((c) => !groupBy.includes(c));
    if (notGrouped.length > 0) {
      throw new Error(
        `select lists ${notGrouped.map((c) => `"${c}"`).join(", ")} alongside aggregates, ` +
          `but only grouped columns can be selected. Add them to groupBy or drop them from select.`
      );
    }
  } else {
    projected = spec.select ?? known;
  }
  for (const column of projected) {
    if (!known.includes(column)) unknownColumn("select", column, known);
  }

  if (aggregates.length > 0) {
    query.select(
      ...projected,
      Object.fromEntries(aggregates.map((a) => [a.as, aggregateExpr(a, known)]))
    );
  } else {
    query.select(...projected);
  }

  for (const cond of spec.where ?? []) query.where(condition(cond, known));
  if (groupBy.length > 0) query.groupby(...groupBy);

  // ORDER BY may also name an output alias, which is how you sort by an aggregate.
  const sortable = [...known, ...aggregateNames];
  for (const order of spec.orderBy ?? []) {
    if (!sortable.includes(order.column)) unknownColumn("orderBy", order.column, sortable);
    query.orderby(order.direction === "desc" ? desc(order.column) : order.column);
  }

  query.limit(Math.min(spec.limit ?? MAX_RESULT_ROWS, MAX_RESULT_ROWS));

  return {
    sql: String(query),
    outputColumns: [...projected, ...aggregateNames],
  };
}
