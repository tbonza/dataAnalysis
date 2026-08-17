---
name: theme-author
description: >-
  How to give charts a consistent visual identity with create_chart's themeSpec —
  choosing one of the shipped presets, or extending a preset with a small set of
  overrides drawn from brand guidelines. Use when the user asks for a particular look,
  mentions a house style or brand, wants charts to match a deck or publication, or
  wants a set of charts to look like one another.
license: MIT
metadata:
  source: microsoft/flint-chart
  adapted-from: agent-skills/flint-theme-author/SKILL.md
---

# Theming charts

`themeSpec` on `create_chart` sets the visual system: ink, type, structure, mark
styling, legend and label policy. It is stated without naming any channel or field, so
the same theme applies to every chart and the same chart accepts any theme.

Two forms, in order of preference.

## 1. Use a preset

Almost always the right answer. Call `list_themes` for ids and descriptions, then pass
the id:

```json
{ "datasetId": "ds-…", "chartSpec": { … }, "themeSpec": "economist" }
```

The shipped presets are publication and product visual systems rather than colour
swaps — each carries its own typography, structure and label policy:

| id | Looks like |
|---|---|
| `nyt` | New York Times editorial |
| `economist` | The Economist: compact, flat headline over a deck naming the measure |
| `swiss` | International Typographic Style: modular grid, one signal-red accent |
| `nature` | Journal figure: small panel, axis titles with units |
| `mckinsey` | Consulting deck: wide bands, every value printed |
| `datawrapper` | Embedded web chart: narrow column, plain headline |
| `powerbi` / `powerbi-light` | Dashboard tile: compact, legend right |
| `pop` | High-saturation, high-contrast |
| `cartoon` | Hand-drawn feel |

**Pick by the situation, not by taste.** A slide deck wants `mckinsey` or `powerbi`; a
report or article wants `economist`, `nyt` or `datawrapper`; a scientific figure wants
`nature`.

**Use the same theme for every chart in one deliverable.** Consistency across a set is
most of what a theme is for — a report whose charts each look different reads as
unfinished regardless of how good each one is.

## 2. Extend a preset

When the user gives brand colours or a specific adjustment, start from the closest
preset and override only what they specified:

```json
{
  "themeSpec": {
    "extends": "datawrapper",
    "id": "acme",
    "label": "Acme",
    "ink": { "accent": "#0b7285", "series": ["#0b7285", "#e8590c", "#5f3dc4"] },
    "type": { "family": "Inter" }
  }
}
```

- `extends` names the preset to inherit from; everything you don't override is kept.
- Always include a kebab-case `id` and a human-readable `label`.
- **Override only what the source material actually specifies.** Every guessed field is
  a decision made worse than the preset's, which was designed as a whole.
- Do **not** invent field names. A requested decision that `ThemeSpec` cannot express
  should be omitted, and mentioned in prose if the user asked why.

The top-level groups available are `ink`, `type`, `structure`, `marks`, `labels`,
`legend`, `dataLabels`, `annotation`, `furniture`, `facets`, `layout`,
`chartDefaults`, `compileDefaults`, `interaction`, and `variants`.

For the exhaustive field list and allowed values, the TypeScript contract is
authoritative:
<https://github.com/microsoft/flint-chart/blob/main/packages/flint-js/src/core/theme/types.ts>,
with the guide at
<https://github.com/microsoft/flint-chart/blob/main/docs/theme-spec.md>.

## Reading brand material

When translating a brand into a theme:

- **Colours** — find the primary accent and a categorical series. A brand palette is
  usually not a good series palette: check that adjacent series colours are
  distinguishable, and don't use more than about six.
- **Type** — one family is usually enough. Match the family, not every weight and size.
- **Structure** — note whether the reference shows gridlines, axis lines, or neither;
  that single decision does more visible work than colour.
- **Labels** — note whether values are printed on the marks. A consulting style prints
  them; an editorial style usually does not.

Anything you cannot ground in the material, leave to the preset.

## Theme versus restyle

A theme is the **system**: it applies to every chart and survives regeneration. A
restyle is a **one-off** edit to a single chart's compiled output.

Use `themeSpec` when the user wants a look for their charts. Use the **chart-restyle**
skill when they want this particular chart adjusted. If you find yourself restyling
several charts the same way, that is a theme.
