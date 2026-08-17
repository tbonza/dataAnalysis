---
name: data-analysis
description: >-
  How to explore tabular data and answer questions with charts: inspect a dataset
  before charting it, calibrate how many charts a question deserves, and stop when
  the question is answered. Use when the user asks a question about data, wants a
  chart, wants to explore or analyse a table, or asks why a number moved. Read this
  first; it points at data-query for shaping data and chart-author for building
  charts.
license: MIT
metadata:
  source: microsoft/data-formulator
  adapted-from: analyst/agent.py SYSTEM_PROMPT and analyst/skills/core/SKILL.md
---

# Data analysis

You answer questions about tabular data by shaping it and charting it. This skill is
the loop; two others hold the detail:

- **data-query** — the query grammar for filtering, grouping, aggregating and deriving.
- **chart-author** — choosing a chart type and mapping fields to channels.

Read the one you need when you need it, not up front.

## The loop

Work in rounds: gather what you need, take one committing step, read its result, then
decide again.

**Inspection is free.** `inspect_dataset`, `list_chart_types`, `inspect_chart` and
reading a skill commit nothing and are independent of each other. Call as many as you
need, in as many rounds as you need, before acting.

**Committing steps are sequential.** `create_chart`, `apply_restyle` and
`create_report` each produce something the user sees. Take **one at a time and read
the result before the next**. The chart you would draw second depends on what the
first one reveals, so deciding both at once makes the second a guess.

**Finish in plain prose.** When the question is answered, say so in a sentence or two
and stop. Don't narrate what you are about to do, and don't recap a chart's axes —
the chart shows them.

## Before you chart: read the values

`load_data` and `inspect_dataset` both return a per-field summary with distinct
values. Read it. Column names hide problems that make a chart quietly wrong:

- **Embedded totals.** A category column may mix an aggregate level with its parts —
  an `All regions` row beside `East`/`West`, or a `Total` product. Charting both
  double-counts and flattens the parts. Filter one out.
- **Units.** A rate may be a fraction (`0.42`) or already a percentage (`42`). Check
  before you label it a percentage, or it gets scaled twice.
- **One real value.** If the column you meant to break down by has a single distinct
  value, the chart collapses to one mark and the breakdown you wanted is a different
  column.
- **Nulls and sentinels.** Watch for `-1`, `9999`, or empty strings standing in for
  missing data; they wreck an axis.

If the data is straightforward and the summary already told you what you need, go
straight to charting.

## How much effort the question deserves

Classify the question silently, then match the effort. Spending five charts on a
one-chart question is as wrong as spending one on an exploration.

| Question | What to do |
|---|---|
| **Conceptual** — what a field means, what's in the table, no chart needed | Answer in prose. No chart. |
| **Ambiguous** — you genuinely cannot tell what is being asked | Ask the user one short question rather than guessing. |
| **Concrete** — one specific answer ("what were sales by region?") | **1 chart**, then the answer in prose. |
| **Progressive** — one question that unfolds ("why did revenue drop?") | **2–3 charts**, each answering a gap the previous one raised, then a closing answer tying them together. |
| **Open-ended** — explicit exploration ("what's interesting here?") | **3–5 charts**, each a *distinct* analytical angle, then a synthesis. |
| **Write-up** — "summarize this", "write a report" | Read the **report** skill and assemble the charts that already exist. Don't rebuild them. |

For concrete and progressive questions, add another chart only when the previous one
raised a gap. For open-ended exploration the opposite applies: each chart should open
a **new** angle — temporal, distributional, comparative, relational, part-to-whole —
rather than restate the last one with different axes. Never repeat a chart you have
already made.

Treat five charts as a ceiling, not a target.

## Styling versus data

A request to change a chart's **appearance** — colours, labels, ordering, a theme —
is a restyle: use **chart-restyle** on the existing `chart_id`. Do not rebuild the
chart from data.

A request that changes **what is measured or shown** — a different field, a filter, a
different aggregation — is data work: query and chart again.

When it is unclear which one is being asked for, treat it as data work. That path can
express anything; a restyle cannot.

## Working with results

Every `query` result becomes a dataset in its own right, with its own `dataset_id`.
That is how multi-step work happens: query, then query the result, then chart it. Use
the returned `sql` to check that the spec you wrote says what you meant.

Every `create_chart` result has a `chart_id`. Keep the ids — restyling and reporting
both take them, and rebuilding a chart you already have wastes a step and risks
producing a different one.

## When you cannot answer

Say so plainly, and say what would be needed. Two limits are worth knowing up front:

- This server shapes and charts data; it does not run arbitrary code. No clustering,
  forecasting, or custom statistics. See data-query for what the grammar does cover.
- It works on the data it has been given. If the answer needs a table nobody loaded,
  ask for it rather than approximating from what's there.
