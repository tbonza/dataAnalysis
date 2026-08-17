---
name: chart-author
description: >-
  How to author a chart spec for the `create_chart` tool — picking a chart type,
  mapping fields to encoding channels, annotating semantic types, and setting
  chart-level properties. Use whenever you are about to create or fix a chart, or
  when a chart came back with warnings or looked wrong. Covers Vega-Lite output
  compiled by Flint; includes a chart-type chooser and a semantic-type reference.
license: MIT
metadata:
  source: microsoft/flint-chart, microsoft/data-formulator
  adapted-from: agent-skills/flint-chart-author/SKILL.md and analyst/skills/core/SKILL.md
---

# Authoring a chart

You produce a **chart spec** — a compact, semantic description of what to draw. The
server compiles it into Vega-Lite with layout, colour, formatting and axis decisions
made for you, and returns the spec as JSON for the client to render.

You do **not** write Vega-Lite. Naming a chart type and mapping fields to channels
gets you a chart that is already well laid out; hand-writing Vega-Lite gets you one
that isn't.

Two references hold the detail:

- [references/chart-types.md](references/chart-types.md) — every chart type, its
  channels, and when to use it.
- [references/semantic-types.md](references/semantic-types.md) — the semantic type
  vocabulary.

## The shape

```json
{
  "dataset_id": "ds-…",
  "chart_spec": {
    "chartType": "Bar Chart",
    "title": "West leads on revenue",
    "subtitle": "Revenue by region, all products, 2024, USD",
    "encodings": { "x": "region", "y": "total_revenue" },
    "chartProperties": {}
  },
  "semantic_types": { "region": "Region", "total_revenue": "Amount" }
}
```

## Step 1 — pick the chart type

Reach for the **everyday** set first: Bar, Line, Scatter, Area, Histogram, Boxplot,
Pie, Heatmap. They answer most questions and are the most legible.

Escalate to a **specialized** type when its condition is genuinely met — a
distribution's shape, a cumulative curve, a rank race, a before-and-after, a
geographic pattern. A well-matched specialized chart beats a forced generic one, but
don't pick one for novelty.

`references/chart-types.md` lists each type with a *when to use* line. `list_chart_types`
returns the machine-readable catalog with each type's channels.

Short names work: `bar`, `line`, `scatter`, `pie`, `heatmap`, `histogram`, `boxplot`,
`area`, `regression`, `grouped_bar`, `lollipop`, `waterfall`, `candlestick`,
`world_map`, `us_map`. An unrecognised name silently becomes a scatter plot, so check
the returned `chart_type` if you used something unusual.

## Step 2 — map fields to channels

`encodings` maps a channel to a column name:

```json
{ "x": "region", "y": "revenue", "color": "product" }
```

Only channels the chart type actually has are accepted; the error lists them if you
miss. Typically two or three channels is right — `x`, `y`, and one of `color`/`size`.
More channels rarely means more insight.

Three forms are accepted per channel:

| Form | Use |
|---|---|
| `"revenue"` | the common case — just the column name |
| `{ "field": "revenue", "aggregate": "sum" }` | aggregate on the channel, so no query grouping needed |
| `["sales", "profit"]` | **static series** — several measure columns folded into one series automatically |

That third form is how a wide table gets charted without reshaping it: give an array
of measure columns and they become one series with a legend, no query step required.

Channel-level `aggregate` accepts `count`, `sum`, `average`, `mean`. Use it for a
plain group-by; use the `query` tool when you need the aggregated table itself, or to
filter or derive on the aggregate.

`facet` is accepted as a synonym for the `column` channel. Facet on a
**low-cardinality** categorical field — a dozen panels is already a lot.

## Step 3 — annotate semantic types

`semantic_types` maps a column to what it *means*, not to a data type:

```json
{ "revenue": "Amount", "month": "Month", "country": "Country", "score": "Score" }
```

This is what drives currency formatting, colour scheme choice, whether an axis
includes zero, and tick behaviour. These are **not** Vega-Lite types — don't write
`quantitative` or `nominal`; those are derived for you.

Annotate the fields you encode; skip the rest. Pick the most specific type that fits.
The common confusions:

- **Amount** for summed money, **Price** for per-unit money, **Profit** for money
  that can go negative.
- **Year** for a `2024`-style column, not `Number` — otherwise it is drawn as a
  measure.
- **Percentage** only when you know the scale; check whether values are `0–1` or
  `0–100` first.
- **Temperature** rather than `Quantity`, because it diverges around a meaningful
  point.

When a type alone understates what you know, use the annotation form:

```json
{ "rating": { "semanticType": "Score", "intrinsicDomain": [1, 5] },
  "revenue": { "semanticType": "Amount", "unit": "USD" } }
```

Full list in `references/semantic-types.md`.

## Write a headline

Set `title` to the **finding, as a sentence**, and `subtitle` to what is measured, of
whom, when, and in what units.

```
title:    "West leads on revenue despite a lower unit price"
subtitle: "Revenue by region, all products, 2024, USD"
```

`Jan`, `Cairo` and `Widget` name their own kind; `26`, `5,300` and `0.42` do not, and
the headline is where they get named. Leave it out only where the chart isn't read on
its own, like a sparkline in a cell — and note that without a headline the compiler
keeps the axis titles instead, which is a worse use of the space.

Don't put the chart type in the title. "Revenue by region" — not "Bar chart of
revenue by region".

## Chart-level properties

`chartProperties` carries per-type options: `innerRadius` for a donut, `opacity` for a
dense scatter, `interpolate` for a line, `colorScheme` for a heatmap,
`regressionMethod` for a trend line. The per-type table in
`references/chart-types.md` lists which ones apply where. Omit it when you have no
specific need — the defaults are chosen deliberately.

For a heatmap, pick `colorScheme` by meaning: a **sequential** scheme (`viridis`,
`blues`, `reds`) for magnitudes where higher is simply more, and a **diverging**
scheme (`blueorange`, `redblue`) only when values read away from a meaningful centre —
profit around zero, change against a baseline.

## Let the engine do its job

These are the mistakes that most often produce a wrong chart:

- **Don't pre-bin a histogram.** Pass the raw numeric column on `x`.
- **Don't compute regression values.** Use the `Regression` chart type.
- **Don't pre-compute an ECDF.** Pass the raw column.
- **Don't sort for a Bar Table.** The template sorts.
- **Don't reshape wide to long.** Use the array form on the measure channel.
- **Don't aggregate twice.** If the query already grouped, don't also set `aggregate`
  on the channel.

## Validation checklist

Before sending:

- Does every field in `encodings` exist in the dataset? (`inspect_dataset` if unsure.)
- Are all the channels ones this chart type has?
- Is there a `title` stating the finding?
- Are the encoded fields annotated in `semantic_types`?
- If the query already aggregated, are the channels free of `aggregate`?

After sending, read the response: `valid`, `errors`, and `warnings`. An error names
what was wrong and what was available — fix and resend. Advisory warnings are worth
reading but do not mean the chart failed.

## Worked examples

**Revenue by region, already aggregated by a query:**

```json
{ "chartType": "Bar Chart",
  "title": "West leads on revenue",
  "subtitle": "Revenue by region, all products, 2024, USD",
  "encodings": { "x": "region", "y": "total_revenue" } }
```
with `semantic_types` `{ "region": "Region", "total_revenue": "Amount" }`.

**Aggregating on the channel instead of in a query:**

```json
{ "chartType": "Bar Chart",
  "title": "Widgets outsell gadgets everywhere",
  "encodings": { "x": "product", "y": { "field": "revenue", "aggregate": "sum" }, "color": "region" } }
```

**Two measures over time from a wide table, no reshaping:**

```json
{ "chartType": "Line Chart",
  "title": "Profit tracked revenue until Q3",
  "encodings": { "x": "month", "y": ["revenue", "profit"] } }
```
with `semantic_types` `{ "month": "Month", "revenue": "Amount", "profit": "Profit" }`.

**A donut, where the wedge value goes on `size`:**

```json
{ "chartType": "Pie Chart",
  "title": "Widgets are over half of revenue",
  "encodings": { "color": "product", "size": "total_revenue" },
  "chartProperties": { "innerRadius": 50 } }
```

**A dense scatter with a trend line per group:**

```json
{ "chartType": "Regression",
  "title": "Unit price falls as volume rises",
  "encodings": { "x": "units", "y": "unit_price", "color": "region" },
  "chartProperties": { "regressionMethod": "linear", "opacity": 0.4 } }
```
