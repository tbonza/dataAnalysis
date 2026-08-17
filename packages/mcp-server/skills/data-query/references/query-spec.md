# Query spec reference

Every field of the `query` tool's `spec`. All fields are optional.

## `select`

`string[]` — output columns, in order.

Defaults to every column, including any added by `compute`. When `aggregate` is
present, `select` may only contain columns that appear in `groupBy`, and it defaults
to `groupBy`.

## `compute`

`{ as, left, op, right }[]` — derived columns, evaluated per row before grouping.

- `as` — the new column's name. Must not collide with an existing column.
- `left`, `right` — a **string** names a column; a **number** is a literal.
- `op` — one of `+`, `-`, `*`, `/`.

One arithmetic step only. Derived columns behave like real ones everywhere else: you
can filter, group, aggregate and sort on them.

```json
{ "compute": [{ "as": "unit_price", "left": "revenue", "op": "/", "right": "units" }] }
{ "compute": [{ "as": "revenue_k",  "left": "revenue", "op": "/", "right": 1000 }] }
```

## `where`

`{ column, operator, value }[]` — filters, combined with `AND`.

| Operator | `value` shape |
|---|---|
| `=` `!=` `>` `<` `>=` `<=` | a single string, number or boolean |
| `LIKE` `NOT LIKE` | a string pattern; `%` matches any run of characters, `_` matches one |
| `IN` `NOT IN` | a non-empty array |
| `BETWEEN` | an array of exactly two values, `[low, high]`, inclusive |
| `IS NULL` `IS NOT NULL` | omit `value` |

Values are always treated as values, never as column names, and are escaped — a
string containing a quote is safe.

```json
{ "where": [
  { "column": "region",  "operator": "IN",      "value": ["East", "West"] },
  { "column": "revenue", "operator": ">",       "value": 100 },
  { "column": "product", "operator": "LIKE",    "value": "Wid%" },
  { "column": "closed",  "operator": "IS NULL" }
] }
```

There is no `OR`. If you need alternatives on one column, use `IN`.

## `groupBy`

`string[]` — columns to group by. Required in practice whenever `aggregate` is used
with a `select`.

## `aggregate`

`{ op, column, as }[]` — aggregate expressions.

| `op` | Meaning | `column` |
|---|---|---|
| `count` | number of rows | optional — omit for `count(*)` |
| `count_distinct` | distinct values | required |
| `sum` | total | required |
| `avg` | mean | required |
| `min` / `max` | extremes | required |
| `median` | middle value | required |

`as` is required and names the output column. Sums of integer columns come back as
plain numbers.

```json
{ "groupBy": ["region"],
  "aggregate": [
    { "op": "sum",   "column": "revenue", "as": "total_revenue" },
    { "op": "count",                      "as": "orders" },
    { "op": "count_distinct", "column": "product", "as": "product_count" }
  ] }
```

## `orderBy`

`{ column, direction }[]` — sort keys, applied in order. `direction` is `asc`
(default) or `desc`. May name a source column, a `compute` alias, or an `aggregate`
alias.

## `limit`

`number` — maximum rows returned. Capped at 5000 regardless of what you ask for; the
cap also applies when you omit it.

For a top-N list, combine `orderBy` with `limit`.

```json
{ "groupBy": ["product"],
  "aggregate": [{ "op": "sum", "column": "revenue", "as": "total" }],
  "orderBy": [{ "column": "total", "direction": "desc" }],
  "limit": 10 }
```

## Result

```
{
  dataset_id        the result, queryable and chartable in its own right
  source_dataset_id what it came from
  columns           name and type per output column
  row_count
  preview_rows      first 10 rows
  sql               the statement that ran
}
```

A `row_count` of 0 means the filters excluded everything — the result is still
registered, and charting it draws an empty plot, so fix the filter instead.

## Errors

Errors name the problem and the alternatives:

- `select references unknown column "profit". Available columns: product, region, revenue, units.`
- `select lists "product" alongside aggregates, but only grouped columns can be selected. Add them to groupBy or drop them from select.`
- `Operator "IN" on "region" needs a non-empty array of values.`
- `Operator "BETWEEN" on "revenue" needs exactly two values [low, high].`
- `compute alias "revenue" collides with an existing column.`

A rejected spec changes nothing, so correcting and resending is always safe.
