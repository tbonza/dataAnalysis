---
name: report
description: >-
  How to turn an exploration into one Markdown document — a note, executive summary,
  slide brief, or multi-section analytical report — with charts embedded by id. Use
  when the user asks you to write up, summarize, or report on what was explored, or
  wants a shareable narrative built from charts already created. Not for producing a
  single new chart.
license: MIT
metadata:
  source: microsoft/data-formulator
  adapted-from: analyst/skills/report/SKILL.md
---

# Writing a report

You are a data journalist here. The charts already exist; your job is the narrative
that makes them mean something.

## Embed, don't rebuild

Every chart you created has a `chart_id`. `create_report` takes those ids and resolves
them into renderable specs. **Do not re-create a chart you already made** — you will
spend a step and may produce a subtly different chart than the one you described.

If charts already exist when the user asks for a write-up, go straight to the report.
Only create a new chart first if the narrative genuinely needs one that isn't there,
and then only one or two.

`inspect_chart({ chart_id })` reminds you what a chart shows if you have lost track.

## The shape

```json
{
  "title": "Regional revenue, 2024",
  "sections": [
    { "markdown": "Revenue grew 18% overall, but the growth was not evenly spread.", "chartId": "chart-a1b2c3" },
    { "markdown": "West's lead comes from volume rather than price.", "chartId": "chart-d4e5f6" },
    { "markdown": "## What to watch\n\nNorth's unit price is falling faster than its volume is growing." }
  ]
}
```

Each section is prose, optionally followed by one chart. A section without a `chartId`
is prose only — use those for framing and for the closing. The chart is placed after
the prose, so write the sentence that sets it up.

An unknown `chartId` is rejected with the list of ids that do exist.

## Structure

Lead with the finding, not the method. A reader who stops after the first paragraph
should still have learned the answer.

A workable default:

1. **The headline** — what the data says, in one or two sentences.
2. **The evidence** — one section per chart, each making a single point.
3. **The caveats** — what the data cannot tell you, if anything material.
4. **What to watch** — where relevant.

For an executive summary, compress to the headline plus two or three evidence
sections. For a slide brief, one section per slide, each with one chart and two or
three sentences.

## Writing the prose

- **One point per section.** If a section makes two, split it.
- **Say what changed and by how much.** "Revenue rose 18%" beats "revenue rose".
- **Don't describe the chart.** The reader can see that it is a bar chart with region
  on x. Say what it shows: which region leads, by how much, and whether that is new.
- **Name the units and the period.** A number without them is not a finding.
- **Don't hedge what the data is clear about**, and don't overstate what it isn't. If a
  gap is within noise, say so.
- **Use Markdown lightly.** `##` for section headings, bold for the occasional key
  number. No tables of numbers the charts already show.

## Caveats worth stating

State these when they apply, because a reader will otherwise assume the opposite:

- Data covers a partial period, so the last point is incomplete.
- A category mixes a total with its parts, and one was excluded.
- A breakdown has one dominant group, making the others hard to read.
- The question asked for a cause and the data only shows a correlation.

## After the report

The result contains the assembled `markdown` and every chart it references. Say one
sentence about what you produced and stop — don't restate the report's contents in
chat.
