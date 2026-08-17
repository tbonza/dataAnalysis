# Chart types

`chartType` must be one of these names, spelled and capitalised exactly. Where a row
lists several, pick by the *when to use* hint. `list_chart_types` returns the same
catalog machine-readably, with each type's channels.

**Prefer simple, escalate when it fits.** Reach for the everyday set first — it
answers most questions and is the most legible. Move to a specialized type when its
condition is genuinely met, not for variety.

## Everyday — reach for these first

| chartType | encodings | chartProperties | when to use |
|---|---|---|---|
| Scatter Plot | x, y, color, size, facet | opacity (0.1–1.0) | Relationship between two quantitative fields |
| Regression | x, y, color, size, facet | regressionMethod (`linear`, `log`, `exp`, `pow`, `quad`, `poly`), polyOrder (2–10) | Trend line over a scatter; one line per colour group |
| Bar Chart / Stacked Bar Chart / Lollipop Chart / Waterfall Chart | x, y, color, facet | — | Bar: categorical comparison, auto-stacks when `color` is set. Stacked Bar: explicit stacked totals, colour is the stack. Lollipop: cleaner for ranked or sparse categories. Waterfall: cumulative gain/loss, each bar starting where the last ended |
| Grouped Bar Chart | x, y, group, facet | — | Side-by-side bars across a second categorical dimension |
| Line Chart | x, y, color, strokeDash, facet | interpolate (`linear`, `monotone`, `step`) | Trend over an ordered, usually temporal, x |
| Area Chart | x, y, color, facet | — | Magnitude over ordered x; auto-stacks when `color` is set |
| Histogram / Density Plot | x, color, facet | — | Distribution of one quantitative field. Histogram bins discretely; Density Plot draws a smooth curve |
| Boxplot | x, y, color, facet | — | Distribution summary — median, quartiles, outliers — by category |
| Pie Chart | size, color, facet | innerRadius (0–100; 0 is a pie, above 0 a donut) | Part-of-whole with 7 or fewer categories. **The wedge value goes on `size`, not `theta`** |
| Heatmap | x, y, color, facet | colorScheme | Matrix or 2D density; colour encodes the cell value |

## Specialized — use when the data fits the condition

| chartType | encodings | when to use |
|---|---|---|
| Connected Scatter Plot | x, y, order, color, facet | Two quantitative fields traced in sequence — needs `order` (usually time) so points join in order, not by x |
| Ranged Dot Plot | x, y, color, facet | A min–max range, or a two-point comparison, per category |
| Violin Plot | x, y, color, facet | Distribution *shape* by category; better than a boxplot when the data is multimodal |
| Strip Plot | x, y, color, size, facet | Every individual point by category, jittered; for small to medium n where raw values matter |
| ECDF Plot | x, color, facet | Cumulative distribution of one quantitative field. **Pass the raw field on `x`** — do not pre-compute the curve |
| Bump Chart | x, y, color, facet | How *rankings* change over ordered x; y is rank, colour is the entity. Long-form data |
| Slope Chart | x, y, color, facet | Change between exactly two points, before and after, per entity |
| Streamgraph | x, y, color, facet | Several series' magnitude over ordered x, stacked around a centre baseline |
| Range Area Chart | x, y, y2, color, facet | A shaded band between a lower (`y`) and upper (`y2`) bound — a min–max or confidence interval |
| Rose Chart | x, y, color, facet | Cyclical or categorical magnitude as angular wedges (polar bars) |
| Pyramid Chart | x, y, color, facet | Back-to-back bars split by a binary group, e.g. population by age and sex |
| Radar Chart | x, y, color, facet | Multi-metric profile; x is the metric name, colour the entity. Long-form data |
| Bar Table | x, y, color, facet | Ranked table with inline bars, one row per category. y is the category, x the value |
| KPI Card | metric, value, goal | "Big number" tiles, one row per tile. `value` must be pre-aggregated; `goal` optional |
| Candlestick Chart | x, open, high, low, close, facet | OHLC financial data |
| Map | longitude, latitude, color, size | Geographic points or bubbles. chartProperties: projection (`mercator`, `equalEarth`, `naturalEarth1`, `orthographic`, `albersUsa`), projectionCenter |
| Choropleth | id, color, facet | Filled regions shaded by value. `id` is the region key, `color` the value. chartProperties: region (`world`, `usa`, …) |
| Calendar Heatmap | x, y, color | Daily values laid out as a calendar |
| Sparkline | x, y | A tiny inline trend, no axes — for a table cell or a tile |

## Per-type rules worth knowing

These are the ones that most often produce a wrong or empty chart.

- **Scatter Plot** — for dense data set `chartProperties.opacity` (0.1–1.0) rather
  than encoding opacity.
- **Regression** — the trend line is automatic; do **not** compute coefficients or
  predictions. Use `color` for a separate line per group.
- **Bar Chart** — x categorical, y quantitative for vertical bars; swap for
  horizontal. Rows sharing an x auto-stack when `color` is set.
- **Grouped Bar Chart** — use the `group` channel, not `color`, for side-by-side bars.
- **Histogram** — pass the **raw** quantitative field on `x`. Pre-binning gives wrong
  bin widths.
- **Line Chart** — `strokeDash` distinguishes line styles, e.g. actual versus forecast.
- **Pie Chart** — the wedge value goes on `size`, not `theta`. Avoid above 7–8
  categories.
- **Radar Chart** — needs long-form data, one row per (entity, metric, value). From a
  wide table, use the array form on the measure channel to fold it.
- **Heatmap** — choose `colorScheme` by meaning. Sequential (`viridis`, `blues`,
  `reds`, `oranges`, `greens`) for one-directional magnitude; diverging
  (`blueorange`, `redblue`) only when values read away from a meaningful centre.
- **Bar Table** — y is the category to rank, x the value driving bar length. Don't
  sort first; the template sorts.
- **KPI Card** — channels are `metric`, `value`, `goal`, not x/y. One row per tile,
  and `value` must already hold the final number.
- **Candlestick Chart** — requires `open`, `high`, `low`, `close`.
- **Connected Scatter Plot** — supply `order` so points join in sequence.
- **ECDF Plot** — pass the raw field; the chart computes the curve.
- **Range Area Chart** — `y` is the lower bound, `y2` the upper.
- **Bump / Slope Chart** — long-form, one row per (entity, x), `color` is the entity.
  A Slope Chart's x has exactly two categories.
- **Violin Plot** — like a boxplot but showing the full shape; x category, y value.
- **Map / Choropleth** — `Map` plots points via `longitude`/`latitude` (use projection
  `albersUsa` for the US); `Choropleth` fills regions, with the region key on `id` and
  the value on `color`, never on x/y.
- **facet** — available on nearly every type. Use a low-cardinality categorical field.

## Statistical work

- **Regression** — use the chart type; it fits the line. Configure with
  `regressionMethod`, and `polyOrder` for `poly`.
- **Forecasting, clustering, and other modelling** — not available. There is no code
  execution here (see the data-query skill). Say so and offer the descriptive chart
  instead.
