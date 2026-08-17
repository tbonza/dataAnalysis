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
  sql,
  sum,
  add,
  sub,
  mul,
  div,
} from "@uwdata/mosaic-sql";
import { MAX_RESULT_ROWS } from "./constants.js";
import { quoteIdent, type Dataset } from "./duckdb.js";

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

export const QuerySpec = z.object({
  select: z.array(z.string()).optional(),
  compute: z.array(Compute).optional(),
  where: z.array(Condition).optional(),
  groupBy: z.array(z.string()).optional(),
  aggregate: z.array(Aggregate).optional(),
  orderBy: z.array(OrderBy).optional(),
  limit: z.number().int().positive().max(MAX_RESULT_ROWS).optional(),
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
export function compileQuery(dataset: Dataset, spec: QuerySpec): CompiledQuery {
  const sourceColumns = dataset.columns.map((c) => c.name);

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

  // mosaic-sql quotes identifiers itself — pass the bare name, not a quoted one.
  const from = computed.length
    ? Query.from(dataset.table).select(
        "*",
        Object.fromEntries(computed.map((c) => [c.as, computeExpr(c, sourceColumns)]))
      )
    : dataset.table;

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
