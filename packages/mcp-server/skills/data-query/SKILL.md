---
name: data-query
description: >-
  How to shape a dataset with the `query` tool's structured spec — filter, group,
  aggregate, derive columns, sort and limit — instead of writing SQL or code. Use
  before charting whenever the data needs reshaping: totals per category, a filtered
  subset, a ratio or per-unit value, a top-N list, or any multi-step transform. Also
  states what the grammar cannot do, so you don't plan around capabilities that
  aren't there.
license: MIT
metadata:
  source: microsoft/data-formulator
  adapted-from: agents/agent_simple.py NL filter spec and data_loader/external_data_loader.py
---

# Shaping data with a query spec

You do not write code or SQL here. You declare what you want as a JSON spec and the
server compiles it to SQL, runs it, and hands back the result as a new dataset.

This is a deliberate substitution. The system this is modelled on gave its analyst a
Python sandbox — pandas, numpy, duckdb, sklearn — and most of what that sandbox was
used for turns out to be work the chart engine already does. What remains is
expressible as a small, checkable grammar, and a grammar cannot read your filesystem
or run for an hour by accident.

The full field-by-field reference is in [references/query-spec.md](references/query-spec.md).
Read it when you need the exact operator list or value shapes. What follows is enough
for most questions.

## The shape

```json
{
  "datasetId": "ds-…",
  "spec": {
    "compute":   [{ "as": "unit_price", "left": "revenue", "op": "/", "right": "units" }],
    "where":     [{ "column": "region", "operator": "IN", "value": ["East", "West"] }],
    "groupBy":   ["region"],
    "aggregate": [{ "op": "sum", "column": "revenue", "as": "total_revenue" }],
    "select":    ["region"],
    "orderBy":   [{ "column": "total_revenue", "direction": "desc" }],
    "limit":     10
  }
}
```

Every part is optional. An empty spec returns the whole dataset.

## Rules that will bite you otherwise

**Only name columns that exist.** Every column reference is checked against the
dataset before anything runs. If you get it wrong the error lists the columns that *do*
exist — read that list rather than guessing again. Call `inspect_dataset` first if you
are unsure.

**With aggregates, you may only select grouped columns.** This is SQL's rule, not
ours. If you group by `region` and sum `revenue`, you cannot also select `product` —
either add `product` to `groupBy` or drop it. The error says which column is the
problem.

**Aggregates need an alias.** `as` names the output column, and that name is what you
encode in a chart. `count` is the only op that may omit `column`.

**`orderBy` can name an alias.** Sorting by an aggregate means naming the alias you
gave it, not repeating the aggregate.

**`compute` is row-level.** It derives a value from other columns *in the same row*,
before grouping. So `revenue / units` per row works, and you can then aggregate that
derived column. A ratio *of two aggregates* — total revenue over total units — is not
one step; see chaining below.

## Chaining: multi-step work

Each result is registered as a new dataset with its own `datasetId`. Query that, and
you have a second step. This is how anything genuinely sequential gets done:

1. `query` — group by region, `sum(revenue) as total_revenue`, `sum(units) as total_units`.
2. `query` on **that result** — `compute` `total_revenue / total_units` as `blended_price`.
3. `create_chart` on the second result.

Reach for chaining whenever you catch yourself wanting an aggregate inside another
expression.

## Let the chart do chart work

Do not pre-compute in a query what the chart engine does better. Doing so produces
wrong bin widths, doubled aggregation, or a chart that refuses to draw:

- **Don't pre-bin** for a histogram — pass the raw numeric column and let it bin.
- **Don't compute a regression** — the `Regression` chart type draws the trend line.
- **Don't pre-compute a cumulative curve** for an ECDF — pass the raw column.
- **Don't sort for a ranked bar table** — the template sorts.
- **Don't aggregate what a chart channel can aggregate** — an encoding can carry
  `aggregate: "sum"` directly. Query-level grouping is for when you need the shaped
  table itself, or need to filter or derive on the aggregate.
- **Don't reshape wide to long** — an encoding accepts an array of columns and folds
  them for you. See chart-author.

## What this cannot do

Say so plainly rather than approximating:

- **No clustering, no forecasting, no statistical modelling.** There is no code
  execution. If a question needs k-means or a projection, explain that and offer the
  descriptive version instead.
- **No joins.** One dataset per query. If an answer needs two tables combined, say so;
  loading a pre-joined table is the way through.
- **No arbitrary expressions.** `compute` is one arithmetic step over columns and
  numbers: `+ - * /`. No functions, no conditionals, no string manipulation. Two steps
  of arithmetic means two queries.
- **No window functions**, running totals, or rank-over-partition.
- **No date arithmetic or string parsing.** If a column needs deriving from a
  timestamp, it has to arrive that way.

## Checks before you send

- Does every column name appear in `inspect_dataset`'s output?
- If there is an `aggregate`, is every selected column also in `groupBy`?
- Does every aggregate have an `as`?
- Does `orderBy` name a real column or an alias you defined?
- Are you asking for an aggregate of an aggregate? Split it into two queries.

## Reading the result

The result includes the `sql` that ran. When a chart looks wrong, read it — it is
usually faster than re-deriving your intent. A `rowCount` of 0 means a filter
excluded everything; charting it yields a blank plot rather than an error, so fix the
filter first.
