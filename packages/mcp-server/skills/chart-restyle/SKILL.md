---
name: chart-restyle
description: >-
  How to change an existing chart's appearance — colours, axis labels, legend
  placement, fonts, gridlines, mark styling — by editing its compiled Vega-Lite spec
  with prepare_restyle and apply_restyle. Use when the user asks to restyle, recolour,
  relabel or otherwise adjust how a chart looks rather than what it shows. Also
  explains when a request is data work instead, and how to offer follow-up tweak
  controls.
license: MIT
metadata:
  source: microsoft/data-formulator
  adapted-from: agents/agent_chart_restyle.py
---

# Restyling a chart

A restyle edits an existing chart's compiled Vega-Lite spec directly. This is the one
place you work at the Vega-Lite level rather than the chart-spec level — and only
*after* a valid chart exists.

## Is this actually a restyle?

**Yes** — colours, colour schemes, axis formats and labels, label angles, legend
position, gridlines, fonts, opacity, corner radius, titles, annotations, reference
lines, sort order, layout polish.

**No** — a different field, a different filter, a different aggregation, a different
chart type. Those change what is measured, so go back to `query` and `create_chart`.
Rebuilding is not a failure; it produces a chart whose layout decisions were made with
the new data in view.

If a request needs data that simply isn't in the chart, say so rather than inventing
it. That refusal is expected and useful — the routing that sent you here is a guess,
and you are the check on it.

## The two steps

**1. `prepare_restyle({ chartId })`** returns:

- `specWithoutData` — the compiled Vega-Lite spec with its `data` block removed.
- `dataSample` — about ten rows of the data the chart actually embeds.

**2. `apply_restyle({ chartId, vlSpec, configUI? })`** takes your edited spec,
re-attaches the rows, and registers the result as a **new chart** with its own
`chartId`. The original stays addressable, so a report can still embed it.

## Rules

**Do not include a `data` block.** The server re-attaches the live rows. If you send
one it is dropped and you get a warning. This is the one hard rule.

**Only reference columns present in the sample.** A `field` pointing at a column that
isn't there renders an empty plot rather than erroring.

**Preserve field-name escaping exactly.** A column whose name contains `.`, `[` or `]`
appears escaped with a backslash — a column literally named `Tomatoes, per lb.` shows
up as:

```json
{ "field": "Tomatoes, per lb\\." }
```

Keep the backslash. Without it Vega-Lite reads the `.` as a nested-object path and the
chart comes back empty.

**Make the smallest edit that achieves the request.** Preserve the encodings, mark
type and transforms unless the user asked for them to change. The spec you were given
already has considered layout, colour and formatting decisions in it; a wholesale
rewrite discards them.

**Read the sample before choosing formats.** The values in `dataSample` are what the
chart embeds after temporal conversion — a year may appear as the string `"1980"`. An
axis format chosen against a different assumption will not match what renders.

## Follow-up controls (`configUI`)

You may return 2–4 small controls that let the user keep adjusting *this* chart
without another model call. A control is a **path** into the spec plus the values
allowed there. There is no code in a control.

```json
[
  { "key": "opacity", "label": "opacity", "path": ["mark", "opacity"],
    "type": "continuous", "min": 0.1, "max": 1, "step": 0.1, "defaultValue": 0.8 },
  { "key": "grid", "label": "gridlines", "path": ["config", "axis", "grid"],
    "type": "binary", "defaultValue": true },
  { "key": "legend", "label": "legend", "path": ["config", "legend", "orient"],
    "type": "discrete",
    "options": [{ "value": "right", "label": "right" }, { "value": "bottom", "label": "bottom" }],
    "defaultValue": "right" }
]
```

| Field | Notes |
|---|---|
| `key` | Short unique id, lowercase, no spaces |
| `label` | Short human label |
| `path` | Array locating the value in the spec. Numbers index arrays: `["layer", 0, "mark", "color"]`. Missing intermediates are created |
| `type` | `continuous`, `binary` or `discrete` |
| `continuous` | needs `min`, `max`, numeric `defaultValue`; `step` optional |
| `binary` | needs a boolean `defaultValue` |
| `discrete` | needs `options` of `{ value, label }`; a `value` may be a scalar *or* a whole object written wholesale |

Two rules make controls behave:

- **`defaultValue` must equal what your returned spec already has at that `path`**, so
  the controls open in sync with the chart the user is looking at.
- **`path` must point at something real in the spec you returned**, or toggling does
  nothing visible.

Choose knobs that matter for the chart you just made — opacity and point size for a
scatter, label angle for crowded categories, colour scheme for a heatmap, corner
radius for bars. Controls with malformed or unsafe paths are dropped, and the response
says how many.

## Worked example

Recolour bars to green and angle crowded labels, leaving the encodings alone:

```json
{
  "mark": { "type": "bar", "color": "#2e7d32" },
  "encoding": {
    "x": { "field": "region", "type": "nominal", "axis": { "labelAngle": -45 } },
    "y": { "field": "total_revenue", "type": "quantitative" }
  }
}
```

with controls:

```json
[
  { "key": "angle", "label": "label angle", "path": ["encoding", "x", "axis", "labelAngle"],
    "type": "continuous", "min": -90, "max": 0, "step": 15, "defaultValue": -45 },
  { "key": "color", "label": "bar colour", "path": ["mark", "color"], "type": "discrete",
    "options": [{ "value": "#2e7d32", "label": "green" }, { "value": "#1565c0", "label": "blue" }],
    "defaultValue": "#2e7d32" }
]
```
